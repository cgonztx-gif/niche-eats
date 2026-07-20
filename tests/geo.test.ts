import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineMiles } from '../supabase/functions/_shared/geo.ts';

test('known distance: Austin Capitol -> Zilker Park is ~2.1 mi', () => {
  const miles = haversineMiles(
    { lat: 30.2747, lng: -97.7404 },
    { lat: 30.2669, lng: -97.7729 },
  );
  assert.ok(miles > 1.8 && miles < 2.4, `got ${miles}`);
});

test('zero for identical points', () => {
  const p = { lat: 30.2747, lng: -97.7404 };
  assert.equal(haversineMiles(p, p), 0);
});

test('a far reference exceeds the 60-mile gate', () => {
  // Austin -> Seattle is well over 60 miles.
  const miles = haversineMiles(
    { lat: 30.2849, lng: -97.7341 },
    { lat: 47.6097, lng: -122.3422 },
  );
  assert.ok(miles > 60, `got ${miles}`);
});
