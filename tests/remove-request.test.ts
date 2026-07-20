import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoveRequest } from '../supabase/functions/_shared/remove-request.ts';

test('accepts a valid place_id', () => {
  const result = parseRemoveRequest({ place_id: 'ChIJiVvNKZi0RIYRZHOC01aytYs' });
  assert.deepEqual(result, { placeId: 'ChIJiVvNKZi0RIYRZHOC01aytYs' });
});

test('trims surrounding whitespace', () => {
  const result = parseRemoveRequest({ place_id: '  ChIJabc  ' });
  assert.deepEqual(result, { placeId: 'ChIJabc' });
});

test('rejects an empty string', () => {
  assert.ok('error' in parseRemoveRequest({ place_id: '' }));
});

test('rejects a whitespace-only string', () => {
  assert.ok('error' in parseRemoveRequest({ place_id: '   ' }));
});

test('rejects a missing place_id', () => {
  assert.ok('error' in parseRemoveRequest({}));
});

test('rejects a null body', () => {
  assert.ok('error' in parseRemoveRequest(null));
});

test('rejects an array body', () => {
  // An array is typeof 'object'; the Array.isArray guard must catch it.
  assert.ok('error' in parseRemoveRequest(['ChIJabc']));
});

test('rejects a non-string place_id', () => {
  assert.ok('error' in parseRemoveRequest({ place_id: 123 }));
});

test('rejects an over-length place_id', () => {
  assert.ok('error' in parseRemoveRequest({ place_id: 'x'.repeat(256) }));
});

test('never returns a placeId together with an error', () => {
  // Guarantees index.ts can branch on `'error' in result` unambiguously.
  for (const input of [{ place_id: 'ok' }, { place_id: '' }, null, [], { place_id: 5 }]) {
    const result = parseRemoveRequest(input as never);
    assert.equal('error' in result && 'placeId' in result, false);
  }
});
