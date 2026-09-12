import type {
  CategoryGender,
  Discipline,
  EligibilityStatus,
  EntryFormat,
  Gender,
  Stream,
} from '@bagantkd/domain';
import { compareStrings, deterministicUuid, fingerprint, sortedBy, type Fingerprint } from '@bagantkd/shared';

import type { IntakeEntry, Person } from './types.js';

/**
 * The immutable input of a draw (instruction 5): exactly what the engine sees, nothing more.
 * No names, no NIK, no full birth dates — birth year only. Person and entry ids are derived from
 * registration row ids, never from personal data.
 */
export interface SnapshotMember {
  readonly athleteId: string;
  readonly gender: Gender | null;
  readonly birthYear: number | null;
  readonly beltCode: string | null;
  /** Usable registered height (null when missing, implausible, swapped or conflicting). */
  readonly heightMm: number | null;
  readonly weightG: number | null;
}

export interface SnapshotEntry {
  readonly entryId: string;
  readonly externalRef: string;
  readonly contingentKey: string;
  readonly stream: Stream;
  readonly discipline: Discipline;
  readonly format: EntryFormat;
  readonly ageDivisionCode: string;
  readonly categoryKey: string | null;
  readonly categoryGender: CategoryGender | null;
  readonly weightClassCode: string | null;
  readonly seedNo: number | null;
  readonly eligibility: EligibilityStatus;
  readonly blockingReasons: readonly string[];
  readonly members: readonly SnapshotMember[];
}

export interface IntakeSnapshot {
  readonly schemaVersion: 1;
  readonly adapter: string;
  readonly tournamentCode: string;
  readonly ruleSetCode: string;
  readonly ruleSetFingerprint: Fingerprint;
  readonly source: { readonly name: string; readonly fingerprint: Fingerprint; readonly rows: number };
  readonly entries: readonly SnapshotEntry[];
  /** Entries or rows that cannot be represented for the engine, with reasons. */
  readonly excluded: readonly { readonly ref: string; readonly reasons: readonly string[] }[];
}

export function buildSnapshot(args: {
  adapter: string;
  tournamentCode: string;
  ruleSetCode: string;
  ruleSetFingerprint: Fingerprint;
  source: { name: string; fingerprint: Fingerprint; rows: number };
  entries: readonly IntakeEntry[];
  persons: readonly Person[];
  unresolvedRows: readonly string[];
}): { snapshot: IntakeSnapshot; fingerprint: Fingerprint } {
  const personOfRow = new Map<string, Person>();
  for (const p of args.persons) for (const r of p.rowRefs) personOfRow.set(r, p);
  const athleteId = (p: Person) => deterministicUuid('bagantkd/person', `${args.tournamentCode}|${p.ref}`);

  const entries: SnapshotEntry[] = [];
  const excluded: { ref: string; reasons: string[] }[] = args.unresolvedRows.map((ref) => ({
    ref: `ROW:${ref}`,
    reasons: ['ENTRY_GROUP_UNRESOLVED'],
  }));
  for (const e of args.entries) {
    if (e.stream === null || e.discipline === null || e.divisionCode === null) {
      excluded.push({ ref: e.ref, reasons: [...e.blockingReasons] });
      continue;
    }
    entries.push({
      entryId: deterministicUuid('bagantkd/entry', `${args.tournamentCode}|${e.ref}`),
      externalRef: e.ref,
      contingentKey: e.contingent,
      stream: e.stream,
      discipline: e.discipline,
      format: e.format,
      ageDivisionCode: e.divisionCode,
      categoryKey: e.categoryKey,
      categoryGender: e.categoryGender,
      weightClassCode: e.weightClass,
      seedNo: null,
      eligibility: e.eligibility,
      blockingReasons: e.blockingReasons,
      members: e.memberRows.map((ref) => {
        const p = personOfRow.get(ref);
        return {
          athleteId: p
            ? athleteId(p)
            : deterministicUuid('bagantkd/person', `${args.tournamentCode}|ROW:${ref}`),
          gender: p?.gender ?? null,
          birthYear: p?.birthYear ?? null,
          beltCode: p?.beltCode ?? null,
          heightMm: p?.heightMm ?? null,
          weightG: p?.weightG ?? null,
        };
      }),
    });
  }
  const snapshot: IntakeSnapshot = {
    schemaVersion: 1,
    adapter: args.adapter,
    tournamentCode: args.tournamentCode,
    ruleSetCode: args.ruleSetCode,
    ruleSetFingerprint: args.ruleSetFingerprint,
    source: args.source,
    entries: sortedBy(entries, (a, b) => compareStrings(a.externalRef, b.externalRef)),
    excluded: sortedBy(excluded, (a, b) => compareStrings(a.ref, b.ref)),
  };
  return { snapshot, fingerprint: fingerprint(snapshot) };
}
