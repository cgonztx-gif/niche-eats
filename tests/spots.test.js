import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOpenAt,
  haversineMiles,
  formatDistance,
  mapsUrl,
  partitionSpots,
  isDessert,
  statusLine,
} from '../public/js/spots.js';

/** Local-time Date. Month is 0-indexed. 2026-07-20 is a Monday. */
const at = (day, hour, minute = 0) => new Date(2026, 6, day, hour, minute);

const MON = 20, FRI = 24, SAT = 25;

const weekdayLunch = { Monday: [['11:00', '14:00']] };
const fridayLate = { Friday: [['22:00', '02:00']] };
const allDay = {
  Sunday: [['00:00', '24:00']], Monday: [['00:00', '24:00']],
  Tuesday: [['00:00', '24:00']], Wednesday: [['00:00', '24:00']],
  Thursday: [['00:00', '24:00']], Friday: [['00:00', '24:00']],
  Saturday: [['00:00', '24:00']],
};

test('open inside a normal range, closed outside it', () => {
  assert.equal(isOpenAt(weekdayLunch, at(MON, 12)), true);
  assert.equal(isOpenAt(weekdayLunch, at(MON, 10, 59)), false);
  assert.equal(isOpenAt(weekdayLunch, at(MON, 15)), false);
});

test('boundaries: open time is inclusive, close time is exclusive', () => {
  assert.equal(isOpenAt(weekdayLunch, at(MON, 11, 0)), true);
  assert.equal(isOpenAt(weekdayLunch, at(MON, 13, 59)), true);
  assert.equal(isOpenAt(weekdayLunch, at(MON, 14, 0)), false);
});

test('closed on a day with no ranges', () => {
  assert.equal(isOpenAt(weekdayLunch, at(MON + 1, 12)), false);
});

test('overnight range is open before midnight on its own day', () => {
  assert.equal(isOpenAt(fridayLate, at(FRI, 23, 30)), true);
});

test('overnight range is still open after midnight, on the NEXT day', () => {
  // The decisive case: Saturday 00:30 must resolve via Friday's entry.
  assert.equal(isOpenAt(fridayLate, at(SAT, 0, 30)), true);
  assert.equal(isOpenAt(fridayLate, at(SAT, 1, 59)), true);
});

test('overnight range closes at its close time the next morning', () => {
  assert.equal(isOpenAt(fridayLate, at(SAT, 2, 0)), false);
  assert.equal(isOpenAt(fridayLate, at(SAT, 9, 0)), false);
});

test('overnight range is closed earlier on its own day', () => {
  assert.equal(isOpenAt(fridayLate, at(FRI, 12)), false);
});

test('24-hour venue is open at every hour, including midnight', () => {
  assert.equal(isOpenAt(allDay, at(MON, 0, 0)), true);
  assert.equal(isOpenAt(allDay, at(MON, 12)), true);
  assert.equal(isOpenAt(allDay, at(MON, 23, 59)), true);
});

test('a 24h day does not spill an extra open window into the next day', () => {
  // ["00:00","24:00"] closes exactly at end of day; Tuesday has no hours here.
  const mondayOnly = { Monday: [['00:00', '24:00']] };
  assert.equal(isOpenAt(mondayOnly, at(MON + 1, 0, 30)), false);
});

test('empty and missing hours are closed, not open', () => {
  assert.equal(isOpenAt({}, at(MON, 12)), false);
  assert.equal(isOpenAt(null, at(MON, 12)), false);
  assert.equal(isOpenAt({ Monday: [] }, at(MON, 12)), false);
});

test('haversine matches a known distance', () => {
  // Austin State Capitol -> Zilker Park, ~2.1 mi straight line.
  const miles = haversineMiles(
    { lat: 30.2747, lng: -97.7404 },
    { lat: 30.2669, lng: -97.7729 },
  );
  assert.ok(miles > 1.8 && miles < 2.4, `got ${miles}`);
});

test('haversine is zero for identical points', () => {
  const p = { lat: 30.2747, lng: -97.7404 };
  assert.equal(haversineMiles(p, p), 0);
});

test('distance formatting', () => {
  assert.equal(formatDistance(0.42), '0.4 mi');
  assert.equal(formatDistance(12.35), '12.3 mi');
  assert.equal(formatDistance(0.05), 'nearby');
});

test('isDessert matches sweets categories, case-insensitive', () => {
  assert.equal(isDessert({ category: 'Ice Cream Shop' }), true);
  assert.equal(isDessert({ category: 'Dessert Restaurant' }), true);
  assert.equal(isDessert({ category: 'Chocolate Shop' }), true);
  assert.equal(isDessert({ category: 'BAKERY' }), true);
  assert.equal(isDessert({ category: 'Gelato Shop' }), true);
});

test('isDessert is false for savory and missing categories', () => {
  assert.equal(isDessert({ category: 'Taco Restaurant' }), false);
  assert.equal(isDessert({ category: 'Barbecue Restaurant' }), false);
  assert.equal(isDessert({ category: null }), false);
  assert.equal(isDessert({}), false);
});

test('statusLine: open spot reports its closing time', () => {
  assert.equal(statusLine(weekdayLunch, at(MON, 12)), 'Closes 2 PM');
});

test('statusLine: 24-hour venue reads "Open 24 hrs"', () => {
  assert.equal(statusLine(allDay, at(MON, 3)), 'Open 24 hrs');
});

test('statusLine: overnight range still open past midnight reports next-morning close', () => {
  assert.equal(statusLine(fridayLate, at(SAT, 0, 30)), 'Closes 2 AM');
});

test('statusLine: closed earlier in the day shows the upcoming open time', () => {
  assert.equal(statusLine(weekdayLunch, at(MON, 9)), 'Opens 11 AM');
});

test('statusLine: closed for the day points at the next open day', () => {
  // Monday-lunch spot, asked on Monday evening -> nothing until next Monday.
  assert.equal(statusLine(weekdayLunch, at(MON, 20)), 'Opens Mon 11 AM');
});

test('statusLine: minutes shown only when non-zero', () => {
  assert.equal(statusLine({ Monday: [['08:30', '16:45']] }, at(MON, 10)), 'Closes 4:45 PM');
  assert.equal(statusLine({ Monday: [['08:30', '16:45']] }, at(MON, 7)), 'Opens 8:30 AM');
});

test('statusLine: unknown or empty hours yield an empty string', () => {
  assert.equal(statusLine(null, at(MON, 12)), '');
  assert.equal(statusLine({}, at(MON, 12)), '');
});

test('maps deep links target the right native app', () => {
  const spot = { lat: 30.27, lng: -97.74 };
  assert.equal(mapsUrl(spot, true), 'https://maps.apple.com/?daddr=30.27,-97.74');
  assert.equal(
    mapsUrl(spot, false),
    'https://www.google.com/maps/dir/?api=1&destination=30.27,-97.74',
  );
});

// Austin coordinates; `here` is downtown.
const here = { lat: 30.2672, lng: -97.7431 };
const spotAt = (name, lat, lng, hours) => ({ name, lat, lng, hours });

const FIXTURES = [
  spotAt('Far Open', 30.4, -97.9, { Monday: [['00:00', '24:00']] }),
  spotAt('Near Open', 30.269, -97.744, { Monday: [['00:00', '24:00']] }),
  spotAt('Near Closed', 30.268, -97.743, { Tuesday: [['11:00', '14:00']] }),
  spotAt('Far Closed', 30.5, -98.0, { Tuesday: [['11:00', '14:00']] }),
];

test('partition splits open from closed', () => {
  const { open, closed } = partitionSpots(FIXTURES, here, at(MON, 12));
  assert.deepEqual(open.map((s) => s.name), ['Near Open', 'Far Open']);
  assert.deepEqual(closed.map((s) => s.name), ['Near Closed', 'Far Closed']);
});

test('each bucket is sorted nearest-first', () => {
  const { open } = partitionSpots(FIXTURES, here, at(MON, 12));
  assert.ok(open[0].distance < open[1].distance);
});

test('distance is attached to each spot', () => {
  const { open } = partitionSpots(FIXTURES, here, at(MON, 12));
  assert.equal(typeof open[0].distance, 'number');
});

test('without location the list still renders, sorted by name', () => {
  // The permission prompt must not leave the user staring at an empty screen.
  const { open, closed } = partitionSpots(FIXTURES, null, at(MON, 12));
  assert.deepEqual(open.map((s) => s.name), ['Far Open', 'Near Open']);
  assert.deepEqual(closed.map((s) => s.name), ['Far Closed', 'Near Closed']);
  assert.equal(open[0].distance, null);
});

test('partition tolerates an empty or missing list', () => {
  assert.deepEqual(partitionSpots([], here), { open: [], closed: [] });
  assert.deepEqual(partitionSpots(null, here), { open: [], closed: [] });
});
