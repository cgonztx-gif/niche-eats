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

/** `0.42` -> `"0.4 mi"`. Sub-tenth distances read as "nearby". */
export function formatDistance(miles) {
  if (miles < 0.1) return 'nearby';
  return `${miles.toFixed(1)} mi`;
}

// Keyword match against Google's category (primaryTypeDisplayName). The card no
// longer shows the category, but the dessert filter still reads it, so it stays
// in the fetched data.
const DESSERT_KEYWORDS = [
  'dessert', 'ice cream', 'gelato', 'frozen yogurt', 'froyo', 'creamery',
  'custard', 'bakery', 'pastry', 'cake', 'cupcake', 'cookie', 'donut',
  'doughnut', 'chocolate', 'candy', 'sweets', 'pie',
];

/** True when a spot's category reads as a dessert/sweets place. */
export function isDessert(spot) {
  const category = (spot?.category ?? '').toLowerCase();
  if (!category) return false;
  return DESSERT_KEYWORDS.some((kw) => category.includes(kw));
}

/** `"22:00"` -> `"10 PM"`, `"09:30"` -> `"9:30 AM"`. Minutes shown only when set. */
function formatTime12(time) {
  const [hh, mm] = time.split(':').map(Number);
  const period = hh >= 12 && hh < 24 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === 0 ? `${hour12} ${period}` : `${hour12}:${String(mm).padStart(2, '0')} ${period}`;
}

/**
 * A one-line time detail for a card: when an open spot closes, or when a closed
 * spot next opens. Returns '' when hours are unknown or nothing is upcoming.
 *
 * Reuses the same range structure and overnight semantics as isOpenAt:
 * `close <= open` spans midnight, `"24:00"` is end of day.
 *
 * @param {Record<string, [string,string][]>} hours
 * @param {Date} now
 */
export function statusLine(hours, now = new Date()) {
  if (!hours) return '';

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayIndex = now.getDay();
  const yesterdayIndex = (todayIndex + 6) % 7;

  // If open now, report the close time of the active range.
  for (const range of hours[WEEKDAYS[todayIndex]] ?? []) {
    const [open, close] = range;
    if (open === '00:00' && close === '24:00') return 'Open 24 hrs';
    const openMin = toMinutes(open);
    if (isOvernight(range)) {
      if (nowMinutes >= openMin) return `Closes ${formatTime12(close)}`;
    } else if (nowMinutes >= openMin && nowMinutes < toMinutes(close)) {
      return `Closes ${formatTime12(close)}`;
    }
  }
  // Still open from an overnight range that started yesterday.
  for (const range of hours[WEEKDAYS[yesterdayIndex]] ?? []) {
    if (!isOvernight(range)) continue;
    if (toMinutes(range[1]) >= MINUTES_PER_DAY) continue;
    if (nowMinutes < toMinutes(range[1])) return `Closes ${formatTime12(range[1])}`;
  }

  // Closed now — find the next opening within the coming week. Scans through
  // ahead === 7 so a spot open only on today's weekday still resolves to its
  // next occurrence a week out rather than coming back empty.
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const dayIndex = (todayIndex + ahead) % 7;
    for (const [open] of hours[WEEKDAYS[dayIndex]] ?? []) {
      // Today's ranges only count if they haven't opened yet.
      if (ahead === 0 && toMinutes(open) <= nowMinutes) continue;
      const when = formatTime12(open);
      if (ahead === 0) return `Opens ${when}`;
      if (ahead === 1) return `Opens tomorrow ${when}`;
      return `Opens ${WEEKDAYS[dayIndex].slice(0, 3)} ${when}`;
    }
  }

  return '';
}

/**
 * Deep link into the native maps app. Apple Maps on iOS, Google Maps elsewhere —
 * no embedded tiles, which is the one thing that would bill per view.
 */
export function mapsUrl(spot, useAppleMaps) {
  const dest = `${spot.lat},${spot.lng}`;
  return useAppleMaps
    ? `https://maps.apple.com/?daddr=${dest}`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

/**
 * Split spots into open/closed buckets, each sorted nearest-first.
 *
 * `origin` is null until the user grants location. The list still renders in
 * that case — distance just isn't known, so it falls back to alphabetical
 * rather than showing an empty screen behind a permission prompt.
 *
 * @param {Array} spots
 * @param {{lat:number,lng:number}|null} origin
 * @param {Date} now
 */
export function partitionSpots(spots, origin, now = new Date()) {
  const decorated = (spots ?? []).map((spot) => ({
    ...spot,
    distance: origin ? haversineMiles(origin, spot) : null,
    isOpen: isOpenAt(spot.hours, now),
  }));

  const byDistanceThenName = (a, b) => {
    if (a.distance !== null && b.distance !== null && a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return (a.name ?? '').localeCompare(b.name ?? '');
  };

  return {
    open: decorated.filter((s) => s.isOpen).sort(byDistanceThenName),
    closed: decorated.filter((s) => !s.isOpen).sort(byDistanceThenName),
  };
}
