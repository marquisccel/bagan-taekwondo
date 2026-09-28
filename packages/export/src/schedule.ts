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
 * Every category of `categories` that this ONE arena/day slot schedules, in the slot's own row
 * order (matching the committee's own "Jadwal FIX" sheet) -- a full day/arena bracket document
 * covers every category fought there, not just one weight class. A schedule row with no matching
 * category (not yet drawn, or excluded from this export's scope) is silently skipped, never
 * fabricated; a category is never listed twice even if the schedule mentions it more than once.
 */
export function categoriesForSlot(
  categories: readonly ExportCategory[],
  slot: ScheduleSlot,
): readonly ExportCategory[] {
  const seen = new Set<string>();
  const out: ExportCategory[] = [];
  for (const key of slot.categories) {
    const category = categories.find((c) => !seen.has(c.id) && matches(key, c));
    if (category) {
      seen.add(category.id);
      out.push(category);
    }
  }
  return out;
}
