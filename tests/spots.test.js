import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpenAt, haversineMiles, formatDistance } from '../public/js/spots.js';

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
  assert.equal(formatDistance(0.42), '0.4 mi away');
  assert.equal(formatDistance(12.35), '12.3 mi away');
  assert.equal(formatDistance(0.05), 'nearby');
});
