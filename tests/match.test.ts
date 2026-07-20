import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreMatch,
  classifyCandidates,
  tokenize,
} from '../supabase/functions/_shared/match.ts';

const c = (name: string, id = name) => ({ id, displayName: { text: name } });

test('tokenize strips punctuation, case, and accents', () => {
  assert.deepEqual([...tokenize('Veracruz All-Natural')], ['veracruz', 'all', 'natural']);
  assert.deepEqual([...tokenize('Café Möka')], ['cafe', 'moka']);
});

test('exact name match scores 1', () => {
  assert.equal(scoreMatch('Franklin Barbecue', 'Franklin Barbecue'), 1);
});

test('trailing city hints do not sink a real match', () => {
  // Real case: the brief tells users to append a city to disambiguate.
  assert.equal(scoreMatch('Franklin Barbecue Austin TX', 'Franklin Barbecue'), 1);
});

test('a typed prefix still matches the fuller official name', () => {
  // Real case: "Spicy Boys" vs the full registered name.
  assert.equal(scoreMatch('Spicy Boys', 'Spicy Boys Fried Chicken - South Austin'), 1);
});

test('unrelated names score at or near zero', () => {
  // Real case: this is what Google returned for a nonsense query.
  assert.equal(scoreMatch('asdkjhqwe nonexistent restaurant zzz', 'SXSE Food Co'), 0);
});

test('single strong candidate resolves', () => {
  const result = classifyCandidates('Franklin Barbecue Austin TX', [c('Franklin Barbecue')]);
  assert.equal(result.status, 'resolved');
  assert.equal(result.match?.displayName?.text, 'Franklin Barbecue');
});

test('junk results are not_found even though Google returned plenty', () => {
  // The failure this whole module exists to prevent.
  const result = classifyCandidates('asdkjhqwe nonexistent restaurant zzz', [
    c('SXSE Food Co'),
    c('Taco Joint'),
    c('Pizza Place'),
  ]);
  assert.equal(result.status, 'not_found');
  assert.equal(result.match, undefined);
});

test('empty candidate list is not_found', () => {
  assert.equal(classifyCandidates('anything', []).status, 'not_found');
});

test('multiple equally-good branches are ambiguous, not silently picked', () => {
  const result = classifyCandidates('Spicy Boys', [
    c('Spicy Boys Fried Chicken - South Austin'),
    c('Spicy Boys Fried Chicken - East 6th'),
    c('Spicy Boys Fried Chicken - Springdale'),
  ]);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.options?.length, 3);
  assert.equal(result.match, undefined, 'must not write on ambiguity');
});

test('a clear leader wins over weak also-rans', () => {
  const result = classifyCandidates('Franklin Barbecue Austin TX', [
    c('Franklin Barbecue'),
    c('Terry Blacks Barbecue'),
    c('Stiles Switch BBQ'),
  ]);
  assert.equal(result.status, 'resolved');
  assert.equal(result.match?.displayName?.text, 'Franklin Barbecue');
});

test('specific enough query picks one branch out of several', () => {
  const result = classifyCandidates('Spicy Boys Fried Chicken - East 6th Austin TX', [
    c('Spicy Boys Fried Chicken - East 6th'),
    c('Spicy Boys Fried Chicken - South Austin'),
  ]);
  assert.equal(result.status, 'resolved');
  assert.equal(result.match?.displayName?.text, 'Spicy Boys Fried Chicken - East 6th');
});

test('ambiguous options are capped at 5', () => {
  const many = Array.from({ length: 9 }, (_, i) => c(`Veracruz All Natural ${i}`, `id${i}`));
  const result = classifyCandidates('Veracruz All Natural', many);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.options?.length, 5);
});

// --- address tiebreak: chains whose branches share one identical name ---

const branch = (name: string, address: string, id = address) => ({
  id,
  displayName: { text: name },
  formattedAddress: address,
});

// Real case: these two are indistinguishable by name.
const veracruz = [
  branch('Veracruz All Natural', '111 E Cesar Chavez St, Austin, TX 78701, USA'),
  branch('Veracruz All Natural', '2505 Webberville Rd, Austin, TX 78702, USA'),
];

test('street in the query breaks an identical-name tie', () => {
  const result = classifyCandidates('Veracruz All Natural - Cesar Chavez Austin TX', veracruz);
  assert.equal(result.status, 'resolved');
  assert.match(result.match?.formattedAddress ?? '', /Cesar Chavez/);
});

test('the other branch resolves from its own street', () => {
  const result = classifyCandidates('Veracruz All Natural Webberville Austin TX', veracruz);
  assert.equal(result.status, 'resolved');
  assert.match(result.match?.formattedAddress ?? '', /Webberville/);
});

test('a token shared by every branch does not break the tie', () => {
  // "Austin" is in both addresses, so it disambiguates nothing.
  const result = classifyCandidates('Veracruz All Natural Austin TX', veracruz);
  assert.equal(result.status, 'ambiguous');
});

test('tiebreak does not fire when nothing in the query matches an address', () => {
  const result = classifyCandidates('Veracruz All Natural', veracruz);
  assert.equal(result.status, 'ambiguous');
});

test('tiebreak survives candidates with no address', () => {
  const result = classifyCandidates('Spicy Boys', [
    { id: 'a', displayName: { text: 'Spicy Boys' } },
    { id: 'b', displayName: { text: 'Spicy Boys' } },
  ]);
  assert.equal(result.status, 'ambiguous');
});

test('candidate with no name does not throw', () => {
  const result = classifyCandidates('whatever', [{ id: 'x' }]);
  assert.equal(result.status, 'not_found');
});
