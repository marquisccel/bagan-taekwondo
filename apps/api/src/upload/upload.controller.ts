import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { nikKeysFromEnv, persistSpsUpload, type Db, type SpsUploadResult } from '@bagantkd/db';
import {
  extractParticipantCsv,
  extractTournamentTitle,
  listWorkbookSheetNames,
  parseJadwalFixSheet,
  readWorkbookSheet,
  resolveSpsSheetNames,
  runIntake,
  type ScheduleParseIssue,
  type ScheduleRow,
} from '@bagantkd/intake';
import type { RuleSet } from '@bagantkd/rules';
import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { ActorGuard } from '../auth/actor.guard';
import { ActorScope } from '../auth/tournament-scope.decorator';
import { DB } from '../db/db.module';
import { ApiError } from '../errors/api-error';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The one rule set this upload flow bootstraps every tournament with -- calibrated on, and this
 * session verified against, the committee's own real 2026 registration data. Building a rule-set
 * editor is a separate, larger task; this keeps the upload flow usable today. */
const RULE_SET_FIXTURE = join(
  __dirname,
  '../../../../fixtures/rulesets/piala-gubernur-2026.provisional.json',
);

export interface SpsUploadResponse extends SpsUploadResult {
  readonly scheduleIssues: readonly { readonly sheetRow: number; readonly message: string }[];
}

export interface SpsUploadPreview {
  /** False when at least one blocker below means this file cannot be committed as-is. */
  readonly ok: boolean;
  /** Human-readable, specific reasons committing would fail -- never a guess at a fix, always
   * exactly what a real commit attempt would also refuse, just surfaced before anything is written. */
  readonly blockers: readonly string[];
  readonly tournamentName: string;
  readonly jadwalSheet: string | null;
  readonly participantSheet: string | null;
  readonly eventStart: string | null;
  readonly eventEnd: string | null;
  readonly arenaCodes: readonly string[];
  readonly scheduleRowCount: number;
  readonly scheduleIssues: readonly { readonly sheetRow: number; readonly message: string }[];
  readonly participantCount: number;
  readonly categoryCount: number;
  /** Counts across every participant-data issue `runIntake` found -- the same issues a "Perbaiki
   * Data Peserta" dialog would later show, just totalled here before anything is committed. */
  readonly participantIssueCounts: {
    readonly error: number;
    readonly warning: number;
    readonly info: number;
  };
}

/** Parses everything up to (never including) a database write: which tabs are the schedule/roster,
 * the schedule rows, and the participant CSV -- shared by the preview and commit endpoints so they
 * can never disagree about what a given file contains. Never throws; every failure becomes a
 * `blockers` entry instead, so a caller can show ALL of them at once rather than one at a time. */
function parseSpsWorkbook(bytes: Uint8Array): {
  readonly ruleSet: RuleSet;
  /** The event's own name, read from the "Jadwal FIX" tab's own title banner when the committee's
   * template has one (extractTournamentTitle); falls back to the shared rule-set fixture's name
   * (which is the same for every upload) only when the sheet has no such banner. */
  readonly tournamentName: string;
  readonly jadwalSheet: string | null;
  readonly participantSheet: string | null;
  readonly scheduleRows: readonly ScheduleRow[];
  readonly scheduleIssues: readonly ScheduleParseIssue[];
  readonly participantCsv: string | null;
  readonly blockers: string[];
} {
  const ruleSet = JSON.parse(readFileSync(RULE_SET_FIXTURE, 'utf-8')) as RuleSet;
  const blockers: string[] = [];

  let sheetNames: readonly string[];
  try {
    sheetNames = listWorkbookSheetNames(bytes);
  } catch {
    blockers.push('File ini tidak bisa dibaca sebagai workbook .xlsx.');
    return {
      ruleSet,
      tournamentName: ruleSet.tournament.name,
      jadwalSheet: null,
      participantSheet: null,
      scheduleRows: [],
      scheduleIssues: [],
      participantCsv: null,
      blockers,
    };
  }

  let jadwalSheet: string | null = null;
  let participantSheet: string | null = null;
  try {
    ({ jadwalSheet, participantSheet } = resolveSpsSheetNames(sheetNames));
  } catch (e) {
    blockers.push(
      e instanceof Error ? e.message : 'Tidak bisa menemukan tab jadwal/peserta yang dibutuhkan.',
    );
    return {
      ruleSet,
      tournamentName: ruleSet.tournament.name,
      jadwalSheet,
      participantSheet,
      scheduleRows: [],
      scheduleIssues: [],
      participantCsv: null,
      blockers,
    };
  }

  const jadwalMatrix = readWorkbookSheet(bytes, jadwalSheet);
  const { rows: scheduleRows, issues: scheduleIssues } = parseJadwalFixSheet(jadwalMatrix, ruleSet);
  if (scheduleRows.length === 0) {
    blockers.push(`Tab "${jadwalSheet}" tidak menghasilkan satu pun baris jadwal yang bisa dibaca.`);
  }
  const tournamentName = extractTournamentTitle(jadwalMatrix) ?? ruleSet.tournament.name;

  let participantCsv: string | null = null;
  try {
    participantCsv = extractParticipantCsv(readWorkbookSheet(bytes, participantSheet));
  } catch (e) {
    blockers.push(e instanceof Error ? e.message : `Tidak bisa membaca tab "${participantSheet}".`);
  }

  return {
    ruleSet,
    tournamentName,
    jadwalSheet,
    participantSheet,
    scheduleRows,
    scheduleIssues,
    participantCsv,
    blockers,
  };
}

/** Same (day, arena) facts `persistSpsUpload` itself derives from the schedule rows -- computed here
 * too so the preview can show them without ever calling that function (no DB write). */
function scheduleFacts(scheduleRows: readonly ScheduleRow[]): {
  readonly eventStart: string | null;
  readonly eventEnd: string | null;
  readonly arenaCodes: readonly string[];
} {
  if (scheduleRows.length === 0) return { eventStart: null, eventEnd: null, arenaCodes: [] };
  const dates = [...new Set(scheduleRows.map((r) => r.date))].sort();
  return {
    eventStart: dates[0] ?? null,
    eventEnd: dates[dates.length - 1] ?? null,
    arenaCodes: [...new Set(scheduleRows.map((r) => r.arenaCode))].sort(),
  };
}

/**
 * `POST /uploads/sps` (multipart, field "file"): the committee's SPS spreadsheet in, a brand-new
 * tournament (arenas, rule set, arena/day schedule, participant roster) out. Unscoped to any
 * existing tournament -- there isn't one yet -- so it only requires an identified caller
 * (`ActorScope`), matching `GET /tournaments`'s pattern.
 */
@Controller('uploads')
@UseGuards(ActorGuard)
@ActorScope()
export class UploadController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * `POST /uploads/sps/preview`: reads the same file as `POST /uploads/sps` and reports exactly
   * what a commit would do -- tabs matched, participant/schedule counts, every issue found -- without
   * writing anything. Lets the committee catch a wrong file, a renamed tab, or dirty data BEFORE a
   * tournament exists for it, instead of only after a hard failure (or worse, a "succeeded but
   * wrong" import) partway through committing.
   */
  @Post('sps/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  previewSps(@UploadedFile() file: Express.Multer.File | undefined): SpsUploadPreview {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    const bytes = new Uint8Array(file.buffer);
    const {
      ruleSet,
      tournamentName,
      jadwalSheet,
      participantSheet,
      scheduleRows,
      scheduleIssues,
      participantCsv,
      blockers,
    } = parseSpsWorkbook(bytes);

    let participantCount = 0;
    let categoryCount = 0;
    const participantIssueCounts = { error: 0, warning: 0, info: 0 };
    if (participantCsv !== null) {
      const intake = runIntake({
        sourceName: file.originalname || 'sps-upload.xlsx',
        bytes: new TextEncoder().encode(participantCsv),
        ruleSet,
      });
      if (intake.fatal) {
        blockers.push(`Tab "${participantSheet}" tidak bisa diproses (${intake.fatal.code}).`);
      } else {
        participantCount = intake.entries.length;
        categoryCount = intake.categories.length;
        for (const issue of intake.issues) {
          if (issue.severity === 'ERROR') participantIssueCounts.error += 1;
          else if (issue.severity === 'WARNING') participantIssueCounts.warning += 1;
          else participantIssueCounts.info += 1;
        }
      }
    }

    return {
      ok: blockers.length === 0,
      blockers,
      tournamentName,
      jadwalSheet,
      participantSheet,
      ...scheduleFacts(scheduleRows),
      scheduleRowCount: scheduleRows.length,
      scheduleIssues,
      participantCount,
      categoryCount,
      participantIssueCounts,
    };
  }

  @Post('sps')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadSps(@UploadedFile() file: Express.Multer.File | undefined): Promise<SpsUploadResponse> {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    const bytes = new Uint8Array(file.buffer);
    const { ruleSet, tournamentName, scheduleRows, scheduleIssues, participantCsv, blockers } =
      parseSpsWorkbook(bytes);
    if (blockers.length > 0) throw new BadRequestException(blockers.join(' '));
    // `parseSpsWorkbook` only pushes to `blockers` when `participantCsv` ends up null, so this is
    // unreachable once the check above passes -- kept explicit rather than a non-null assertion.
    if (participantCsv === null) throw new BadRequestException('could not read the participant sheet');

    let nikKeys;
    try {
      nikKeys = nikKeysFromEnv(process.env);
    } catch {
      throw new ApiError('NIK_KEY_MISSING', 'server is missing NIK_ENCRYPTION_KEY/NIK_BLIND_INDEX_KEY');
    }

    // A random suffix keeps `tournament.code` unique (it has a UNIQUE constraint) across multiple
    // uploads on the same day -- the date alone collided the moment a second SPS was uploaded today.
    // The tournament's real name (the SPS's own title banner, e.g. "INDONESIA SUPER FIGHT 4", falling
    // back to the shared rule-set fixture's name only when the sheet has none) is used instead of a
    // generic "Turnamen <date>" label, since the team reads this name everywhere in the UI.
    const tag = new Date().toISOString().slice(0, 10);
    const suffix = randomBytes(3).toString('hex');
    const result = await persistSpsUpload(this.db, {
      tournamentName,
      tournamentCode: `T${tag.replaceAll('-', '')}-${suffix}`,
      ruleSet,
      scheduleRows,
      participantCsv: new TextEncoder().encode(participantCsv),
      nikKeys,
    });
    return { ...result, scheduleIssues };
  }
}
