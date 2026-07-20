/**
 * Transforms Google Places `regularOpeningHours` into the app's `hours` schema.
 *
 * Runtime-agnostic on purpose: no Deno or Node globals, so it deploys to the
 * Edge Function runtime and runs under the Node test runner unchanged.
 */

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** `["11:00", "22:00"]` — an open/close pair. Close may be <= open (overnight). */
export type Range = [string, string];

/** `[]` for a day the venue is closed. */
export type Hours = Record<Weekday, Range[]>;

interface GooglePoint {
  day: number; // 0 = Sunday … 6 = Saturday
  hour: number;
  minute: number;
}

interface GooglePeriod {
  open: GooglePoint;
  close?: GooglePoint; // absent => open 24/7
}

interface GoogleOpeningHours {
  periods?: GooglePeriod[];
}

const ALL_DAY: Range = ["00:00", "24:00"];

function emptyHours(): Hours {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, []])) as Hours;
}

function formatTime(point: GooglePoint): string {
  const hh = String(point.hour).padStart(2, "0");
  const mm = String(point.minute ?? 0).padStart(2, "0");
  return `${hh}:${mm}`;
}

function isValidPoint(point: unknown): point is GooglePoint {
  if (!point || typeof point !== "object") return false;
  const p = point as GooglePoint;
  return (
    Number.isInteger(p.day) && p.day >= 0 && p.day <= 6 &&
    Number.isInteger(p.hour) && p.hour >= 0 && p.hour <= 23
  );
}

/**
 * Google's periods are grouped under their **open** day, so a Friday-night
 * 22:00–02:00 range stays on Friday as `["22:00", "02:00"]` rather than being
 * split across Friday and Saturday. The open-status check is what interprets
 * `close <= open` as spanning midnight.
 *
 * A single period with no `close` is Google's encoding for open 24/7, which
 * expands to every weekday.
 */
export function transformHours(
  openingHours: GoogleOpeningHours | null | undefined,
): Hours {
  const hours = emptyHours();
  const periods = openingHours?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return hours;

  for (const period of periods) {
    if (!isValidPoint(period?.open)) continue;

    // No close => open 24/7, which applies to the whole week regardless of
    // which day the period nominally opens on.
    if (period.close === undefined) {
      for (const day of WEEKDAYS) hours[day] = [[...ALL_DAY] as Range];
      return hours;
    }

    if (!isValidPoint(period.close)) continue;

    hours[WEEKDAYS[period.open.day]].push([
      formatTime(period.open),
      formatTime(period.close),
    ]);
  }

  // Stable ordering makes the rendered output and tests predictable.
  for (const day of WEEKDAYS) {
    hours[day].sort((a, b) => a[0].localeCompare(b[0]));
  }

  return hours;
}
