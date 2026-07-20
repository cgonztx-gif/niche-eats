/**
 * Client-side spot logic: open-status, distance, formatting.
 * Pure functions — no DOM, no network — so they're testable in isolation.
 */

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const MINUTES_PER_DAY = 1440;

/** `"22:00"` -> 1320. `"24:00"` -> 1440 (end of day). */
function toMinutes(time) {
  const [hh, mm] = time.split(':');
  return Number(hh) * 60 + Number(mm);
}

/**
 * A range is overnight when it closes at or before it opens — `["22:00","02:00"]`
 * spans midnight into the following day. Naive string comparison of the two
 * endpoints gets this wrong, which is why every check routes through here.
 */
function isOvernight([open, close]) {
  return toMinutes(close) <= toMinutes(open);
}

/**
 * Is the venue open at `now`?
 *
 * Checks two days, not one: today's ranges, plus yesterday's overnight ranges
 * that are still running past midnight. A spot open Friday `["22:00","02:00"]`
 * is open at 00:30 on Saturday, and that hit comes from Friday's entry.
 *
 * @param {Record<string, [string,string][]>} hours
 * @param {Date} now
 * @returns {boolean}
 */
export function isOpenAt(hours, now = new Date()) {
  if (!hours) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayIndex = now.getDay();
  const yesterdayIndex = (todayIndex + 6) % 7;

  const today = hours[WEEKDAYS[todayIndex]] ?? [];
  const yesterday = hours[WEEKDAYS[yesterdayIndex]] ?? [];

  // Ranges that started today.
  for (const range of today) {
    const [open, close] = range;
    const openMin = toMinutes(open);
    if (isOvernight(range)) {
      // Runs until tomorrow; open from `open` through end of day.
      if (nowMinutes >= openMin) return true;
    } else if (nowMinutes >= openMin && nowMinutes < toMinutes(close)) {
      return true;
    }
  }

  // Ranges that started yesterday and are still running.
  for (const range of yesterday) {
    if (!isOvernight(range)) continue;
    // `["00:00","24:00"]` is 24h, not overnight spillover — it closes exactly
    // at end of day, so it contributes nothing to today.
    if (toMinutes(range[1]) >= MINUTES_PER_DAY) continue;
    if (nowMinutes < toMinutes(range[1])) return true;
  }

  return false;
}

const EARTH_RADIUS_MILES = 3958.8;

const toRadians = (deg) => (deg * Math.PI) / 180;

/**
 * Straight-line distance in miles. Deliberately not routing distance —
 * see the non-goals in the brief.
 */
export function haversineMiles(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/** `0.42` -> `"0.4 mi away"`. Sub-tenth distances read as "nearby". */
export function formatDistance(miles) {
  if (miles < 0.1) return 'nearby';
  return `${miles.toFixed(1)} mi away`;
}
