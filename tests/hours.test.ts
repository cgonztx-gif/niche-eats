import test from 'node:test';
import assert from 'node:assert/strict';
import { transformHours } from '../supabase/functions/_shared/hours.ts';

const pt = (day: number, hour: number, minute = 0) => ({ day, hour, minute });

test('normal single-day range lands on its weekday', () => {
  const hours = transformHours({
    periods: [{ open: pt(1, 11), close: pt(1, 22) }],
  });
  assert.deepEqual(hours.Monday, [['11:00', '22:00']]);
  assert.deepEqual(hours.Tuesday, []);
});

test('pads hours and minutes to HH:MM', () => {
  const hours = transformHours({
    periods: [{ open: pt(2, 9, 5), close: pt(2, 17, 30) }],
  });
  assert.deepEqual(hours.Tuesday, [['09:05', '17:30']]);
});

test('overnight range stays on the opening day', () => {
  // Friday 22:00 -> Saturday 02:00
  const hours = transformHours({
    periods: [{ open: pt(5, 22), close: pt(6, 2) }],
  });
  assert.deepEqual(hours.Friday, [['22:00', '02:00']]);
  assert.deepEqual(hours.Saturday, [], 'must not leak onto the closing day');
});

test('open with no close means 24/7 across every day', () => {
  const hours = transformHours({ periods: [{ open: pt(0, 0) }] });
  for (const day of Object.keys(hours)) {
    assert.deepEqual(hours[day as keyof typeof hours], [['00:00', '24:00']], day);
  }
});

test('split shifts on one day are both kept, in open order', () => {
  const hours = transformHours({
    periods: [
      { open: pt(3, 17), close: pt(3, 21) },
      { open: pt(3, 11), close: pt(3, 14) },
    ],
  });
  assert.deepEqual(hours.Wednesday, [
    ['11:00', '14:00'],
    ['17:00', '21:00'],
  ]);
});

test('days with no period are closed', () => {
  const hours = transformHours({
    periods: [{ open: pt(6, 10), close: pt(6, 16) }],
  });
  assert.deepEqual(hours.Sunday, []);
  assert.deepEqual(hours.Monday, []);
  assert.deepEqual(hours.Saturday, [['10:00', '16:00']]);
});

test('missing or empty opening hours yields a fully-closed week', () => {
  for (const input of [null, undefined, {}, { periods: [] }]) {
    const hours = transformHours(input as never);
    assert.equal(Object.keys(hours).length, 7);
    assert.ok(Object.values(hours).every((r) => r.length === 0));
  }
});

test('malformed periods are skipped rather than throwing', () => {
  const hours = transformHours({
    periods: [
      { open: pt(9, 11), close: pt(9, 22) } as never, // day out of range
      { open: pt(1, 11), close: pt(1, 22) },
    ],
  });
  assert.deepEqual(hours.Monday, [['11:00', '22:00']]);
});
