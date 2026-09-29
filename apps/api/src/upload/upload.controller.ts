import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { nikKeysFromEnv, persistSpsUpload, type Db, type SpsUploadResult } from '@bagantkd/db';
import {
  extractParticipantCsv,
  listWorkbookSheetNames,
  parseJadwalFixSheet,
  readWorkbookSheet,
  resolveSpsSheetNames,
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

  @Post('sps')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadSps(@UploadedFile() file: Express.Multer.File | undefined): Promise<SpsUploadResponse> {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    const bytes = new Uint8Array(file.buffer);

    let sheetNames: readonly string[];
    try {
      sheetNames = listWorkbookSheetNames(bytes);
    } catch {
      throw new BadRequestException('could not read this file as an .xlsx workbook');
    }
    let jadwalSheet: string;
    let participantSheet: string;
    try {
      ({ jadwalSheet, participantSheet } = resolveSpsSheetNames(sheetNames));
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : 'could not identify the required sheets',
      );
    }

    const ruleSet = JSON.parse(readFileSync(RULE_SET_FIXTURE, 'utf-8')) as RuleSet;
    const { rows: scheduleRows, issues: scheduleIssues } = parseJadwalFixSheet(
      readWorkbookSheet(bytes, jadwalSheet),
      ruleSet,
    );
    if (scheduleRows.length === 0) {
      throw new BadRequestException(`"${jadwalSheet}" produced no recognizable schedule rows`);
    }
    let participantCsv: string;
    try {
      participantCsv = extractParticipantCsv(readWorkbookSheet(bytes, participantSheet));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : `could not read "${participantSheet}"`);
    }

    let nikKeys;
    try {
      nikKeys = nikKeysFromEnv(process.env);
    } catch {
      throw new ApiError('NIK_KEY_MISSING', 'server is missing NIK_ENCRYPTION_KEY/NIK_BLIND_INDEX_KEY');
    }

    // A random suffix keeps `tournament.code` unique (it has a UNIQUE constraint) across multiple
    // uploads on the same day -- the date alone collided the moment a second SPS was uploaded today.
    // The tournament's real name (from the rule set, e.g. "Piala Gubernur ... 2026") is used instead
    // of a generic "Turnamen <date>" label, since the team reads this name everywhere in the UI.
    const tag = new Date().toISOString().slice(0, 10);
    const suffix = randomBytes(3).toString('hex');
    const result = await persistSpsUpload(this.db, {
      tournamentName: ruleSet.tournament.name,
      tournamentCode: `T${tag.replaceAll('-', '')}-${suffix}`,
      ruleSet,
      scheduleRows,
      participantCsv: new TextEncoder().encode(participantCsv),
      nikKeys,
    });
    return { ...result, scheduleIssues };
  }
}
