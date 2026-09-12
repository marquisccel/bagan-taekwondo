import { canonicalJson, compareStrings, sortedBy } from '@bagantkd/shared';

import type { IntakeSnapshot, SnapshotEntry } from './snapshot.js';

/**
 * What changed between two intake snapshots (a re-import, or the same batch under another rule
 * set). Entries are matched by their registration reference. Pure and read-only: both snapshots
 * stay as they are; applying a diff to live entries is a separate, reviewed command (Phase 4).
 */
export interface IntakeDiff {
  readonly sourceChanged: boolean;
  readonly ruleSetChanged: boolean;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly { readonly externalRef: string; readonly fields: readonly string[] }[];
  readonly unchanged: number;
  readonly excludedAdded: readonly string[];
  readonly excludedRemoved: readonly string[];
}

const FIELDS: readonly (keyof SnapshotEntry)[] = [
  'contingentKey',
  'stream',
  'discipline',
  'format',
  'ageDivisionCode',
  'categoryKey',
  'categoryGender',
  'weightClassCode',
  'seedNo',
  'eligibility',
  'blockingReasons',
  'members',
];

export function diffIntake(previous: IntakeSnapshot, next: IntakeSnapshot): IntakeDiff {
  const prev = new Map(previous.entries.map((e) => [e.externalRef, e]));
  const curr = new Map(next.entries.map((e) => [e.externalRef, e]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: { externalRef: string; fields: string[] }[] = [];
  let unchanged = 0;

  for (const [ref, e] of curr) {
    const p = prev.get(ref);
    if (!p) {
      added.push(ref);
      continue;
    }
    const fields = FIELDS.filter((f) => canonicalJson(p[f]) !== canonicalJson(e[f])).map(String);
    if (fields.length > 0) changed.push({ externalRef: ref, fields });
    else unchanged += 1;
  }
  for (const ref of prev.keys()) if (!curr.has(ref)) removed.push(ref);

  const prevExcluded = new Set(previous.excluded.map((x) => x.ref));
  const nextExcluded = new Set(next.excluded.map((x) => x.ref));
  return {
    sourceChanged: previous.source.fingerprint !== next.source.fingerprint,
    ruleSetChanged: previous.ruleSetFingerprint !== next.ruleSetFingerprint,
    added: sortedBy(added, compareStrings),
    removed: sortedBy(removed, compareStrings),
    changed: sortedBy(changed, (a, b) => compareStrings(a.externalRef, b.externalRef)),
    unchanged,
    excludedAdded: sortedBy(
      [...nextExcluded].filter((r) => !prevExcluded.has(r)),
      compareStrings,
    ),
    excludedRemoved: sortedBy(
      [...prevExcluded].filter((r) => !nextExcluded.has(r)),
      compareStrings,
    ),
  };
}
