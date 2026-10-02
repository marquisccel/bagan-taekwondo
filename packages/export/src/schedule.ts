import type { ExportCategory } from './model.js';

/**
 * The committee's own arena/day assignment (mirrors the "Jadwal FIX" spreadsheet tab: one block per
 * arena+day, listing the categories fought there in order by discipline/gender/age division/weight
 * class). This is NOT read from any file here -- there is no import pipeline yet (a separate, larger
 * task) -- it is plain structured data the caller supplies, so the FINAL/OFFICIAL bracket sheet can
 * show which arena and day a category is scheduled for once that data exists. Absent entirely, the
 * document falls back to its generic title rather than fabricating a session.
 */
export interface ScheduleCategoryKey {
  readonly discipline: string;
  readonly gender: string;
  readonly ageDivisionCode: string | null;
  readonly weightClassCode: string | null;
}

export interface ScheduleSlot {
  /** 1-based day number, exactly as the committee's own "DAY 1"/"DAY 2" heading reads. */
  readonly dayNumber: number;
  /** e.g. "Jumat, 18 September 2026" -- weekday and date combined, exactly as the committee wrote it. */
  readonly dayLabel: string;
  /** e.g. "ARENA A". */
  readonly arena: string;
  /** The categories fought in this arena/day slot, in the committee's own order. */
  readonly categories: readonly ScheduleCategoryKey[];
}

export type Schedule = readonly ScheduleSlot[];

const matches = (a: ScheduleCategoryKey, c: ExportCategory): boolean =>
  a.discipline === c.discipline &&
  a.gender === c.gender &&
  a.ageDivisionCode === c.ageDivisionCode &&
  a.weightClassCode === c.weightClassCode;

/**
 * The arena/day slot a category is scheduled in, or `null` when the schedule doesn't mention it (an
 * unscheduled or not-yet-scheduled category -- never guessed). The first matching slot wins; a
 * category should appear in exactly one slot, but this never throws on a data inconsistency, since a
 * document is still safe to render without a session label.
 */
export function findScheduleSlot(schedule: Schedule, category: ExportCategory): ScheduleSlot | null {
  for (const slot of schedule) {
    if (slot.categories.some((k) => matches(k, category))) return slot;
  }
  return null;
}

/**
 * Every category of `categories` that this ONE arena/day slot schedules -- a full day/arena bracket
 * document covers every category fought there, not just one weight class. A schedule row with no
 * matching category (not yet drawn, or excluded from this export's scope) is silently skipped, never
 * fabricated; a category is never listed twice even if the schedule mentions it more than once.
 *
 * Kept in `categories`' OWN given order (gender then weight ascending -- see
 * `compareCategoriesByWeightClass`, the exact order `buildExportModel` already sorted it into), not
 * the schedule's own row order: that order is also what every match's printed number was resolved
 * over (match-numbering.ts), so printing the slot's categories out of that order made an unedited
 * match's number jump around the page unpredictably -- correct on its own, but unrecognizable as
 * "starting from 1" the way the web session view reads. The team asked for the printed page to look
 * exactly like the web view, filtered down to one slot, not reshuffled into the committee's own
 * schedule-sheet row order.
 */
export function categoriesForSlot(
  categories: readonly ExportCategory[],
  slot: ScheduleSlot,
): readonly ExportCategory[] {
  return categories.filter((c) => slot.categories.some((key) => matches(key, c)));
}
