import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTAINMENT_BONUS,
  bigramCounts,
  containmentBonus,
  diceCoefficient,
  normalizeForSimilarity,
  rankBySimilarity,
  similarityScore,
  tokenJaccard,
  tokenize
} from './similarity.js';

// --- normalization ---

test('normalizeForSimilarity lowercases, strips punctuation, and collapses whitespace', () => {
  assert.equal(normalizeForSimilarity('  Buy   MILK!! '), 'buy milk');
  assert.equal(normalizeForSimilarity('Review Q3 — plan/notes'), 'review q3 plan notes');
});

test('normalizeForSimilarity strips diacritics so accented names still match', () => {
  assert.equal(normalizeForSimilarity('Café résumé'), 'cafe resume');
  assert.equal(normalizeForSimilarity('Cafe resume'), normalizeForSimilarity('Café résumé'));
});

test('normalizeForSimilarity drops emoji and other symbols', () => {
  assert.equal(normalizeForSimilarity('📎 Attach receipt 💾'), 'attach receipt');
});

test('normalizeForSimilarity handles empty and non-string input', () => {
  assert.equal(normalizeForSimilarity(''), '');
  assert.equal(normalizeForSimilarity('   '), '');
  assert.equal(normalizeForSimilarity(undefined as unknown as string), '');
});

test('tokenize splits on the normalized word boundaries', () => {
  assert.deepEqual(tokenize('Call Dr. Smith — re: labs'), ['call', 'dr', 'smith', 're', 'labs']);
  assert.deepEqual(tokenize('   '), []);
});

// --- bigrams ---

test('bigramCounts is a multiset over adjacent character pairs', () => {
  const counts = bigramCounts('abab');
  assert.equal(counts.get('ab'), 2);
  assert.equal(counts.get('ba'), 1);
  assert.equal(counts.size, 2);
});

test('bigramCounts degrades gracefully for 0- and 1-character strings', () => {
  assert.equal(bigramCounts('').size, 0);
  assert.deepEqual([...bigramCounts('a')], [['a', 1]]);
});

// --- dice ---

test('diceCoefficient is 1 for identical (post-normalization) strings and 0 for blanks', () => {
  assert.equal(diceCoefficient('Buy milk', 'buy   MILK'), 1);
  assert.equal(diceCoefficient('', 'buy milk'), 0);
  assert.equal(diceCoefficient('', ''), 0);
});

test('diceCoefficient rates a transposition typo far above an unrelated string', () => {
  const typo = diceCoefficient('Buy milk', 'Buy mlik');
  const unrelated = diceCoefficient('Buy milk', 'Deploy the API gateway');
  assert.ok(typo > 0.4, `typo variant scored ${typo}`);
  assert.ok(unrelated < 0.2, `unrelated scored ${unrelated}`);
  assert.ok(typo > unrelated);
});

test('diceCoefficient is symmetric', () => {
  assert.equal(diceCoefficient('weekly review', 'weekly reviews'), diceCoefficient('weekly reviews', 'weekly review'));
});

// --- jaccard ---

test('tokenJaccard ignores word order', () => {
  assert.equal(tokenJaccard('weekly plan review', 'review weekly plan'), 1);
});

test('tokenJaccard measures shared-token proportion', () => {
  // {call, dentist} vs {call, dentist, about, crown} -> 2 / 4
  assert.equal(tokenJaccard('call dentist', 'call dentist about crown'), 0.5);
  assert.equal(tokenJaccard('buy milk', 'file taxes'), 0);
  assert.equal(tokenJaccard('', 'anything'), 0);
});

// --- containment ---

test('containmentBonus fires when the shorter string is contained in the longer', () => {
  assert.equal(containmentBonus('call dentist', 'call dentist about the crown'), CONTAINMENT_BONUS);
  assert.equal(containmentBonus('call dentist about the crown', 'call dentist'), CONTAINMENT_BONUS);
});

test('containmentBonus is withheld for non-containment and for very short strings', () => {
  assert.equal(containmentBonus('call dentist', 'email plumber'), 0);
  assert.equal(containmentBonus('abc', 'abcdefgh'), 0, 'strings under 4 chars are coincidence, not signal');
  assert.equal(containmentBonus('', 'anything'), 0);
});

// --- combined score ---

test('similarityScore is 1 for a normalization-equal pair and 0 when either side is blank', () => {
  assert.equal(similarityScore('Buy milk', 'buy milk!'), 1);
  assert.equal(similarityScore('Buy milk', '   '), 0);
});

test('similarityScore is symmetric and always inside [0, 1]', () => {
  const pairs: Array<[string, string]> = [
    ['Buy milk', 'Buy mlik'],
    ['weekly plan review', 'review weekly plan'],
    ['call dentist', 'Call dentist about the crown next week'],
    ['Buy milk', 'Deploy the API gateway'],
    ['a', 'a'],
    ['', '']
  ];
  for (const [left, right] of pairs) {
    const forward = similarityScore(left, right);
    const backward = similarityScore(right, left);
    assert.equal(forward, backward, `asymmetric for "${left}" / "${right}"`);
    assert.ok(forward >= 0 && forward <= 1, `out of range: ${forward}`);
  }
});

test('similarityScore clears the default 0.35 threshold for typos, reorderings, and substrings', () => {
  assert.ok(similarityScore('Buy milk', 'Buy mlik') > 0.35, 'typo variant should match');
  assert.ok(similarityScore('weekly plan review', 'review weekly plan') > 0.8, 'reordering should match strongly');
  assert.ok(
    similarityScore('call dentist', 'Call dentist about the crown next week') > 0.35,
    'substring containment should match'
  );
});

test('similarityScore stays below the default threshold for unrelated task names', () => {
  const unrelated: Array<[string, string]> = [
    ['Buy milk', 'Deploy the API gateway'],
    ['Renew passport', 'Water the plants'],
    ['Write clinic notes', 'Book flights to Denver']
  ];
  for (const [left, right] of unrelated) {
    const score = similarityScore(left, right);
    assert.ok(score < 0.35, `"${left}" / "${right}" scored ${score}, expected below threshold`);
  }
});

test('similarityScore ranks a near-duplicate above a merely related name', () => {
  const nearDuplicate = similarityScore('Call the dentist', 'Call dentist');
  const related = similarityScore('Call the dentist', 'Call the pharmacy');
  assert.ok(nearDuplicate > related, `${nearDuplicate} should beat ${related}`);
});

// --- ranking ---

const CANDIDATES = [
  { id: 't1', name: 'Buy milk' },
  { id: 't2', name: 'Buy mlik' },
  { id: 't3', name: 'Deploy the API gateway' },
  { id: 't4', name: 'Buy milk and eggs' }
];

test('rankBySimilarity returns only matches at or above minScore, best first', () => {
  const ranked = rankBySimilarity('Buy milk', CANDIDATES, { limit: 10, minScore: 0.35 });
  assert.equal(ranked[0].id, 't1');
  assert.equal(ranked[0].score, 1);
  assert.ok(ranked.every(r => r.score >= 0.35));
  assert.ok(!ranked.some(r => r.id === 't3'), 'unrelated candidate must be filtered out');
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].score >= ranked[i].score, 'results must be sorted by descending score');
  }
});

test('rankBySimilarity honours limit', () => {
  const ranked = rankBySimilarity('Buy milk', CANDIDATES, { limit: 1, minScore: 0 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 't1');
});

test('rankBySimilarity applies the documented defaults (limit 5, minScore 0.35)', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `Buy milk ${i}` }));
  const ranked = rankBySimilarity('Buy milk', many);
  assert.equal(ranked.length, 5);
  assert.ok(ranked.every(r => r.score >= 0.35));
});

test('rankBySimilarity breaks ties deterministically by name then id', () => {
  const duplicates = [
    { id: 'b', name: 'Buy milk' },
    { id: 'a', name: 'Buy milk' }
  ];
  const ranked = rankBySimilarity('Buy milk', duplicates, { limit: 5, minScore: 0 });
  assert.deepEqual(ranked.map(r => r.id), ['a', 'b']);

  // Equal scores, different names -> name ascending.
  const symmetric = [
    { id: '2', name: 'cd' },
    { id: '1', name: 'ab' }
  ];
  const rankedSymmetric = rankBySimilarity('ab cd', symmetric, { limit: 5, minScore: 0 });
  assert.equal(rankedSymmetric[0].score, rankedSymmetric[1].score, 'test premise: scores must tie');
  assert.deepEqual(rankedSymmetric.map(r => r.name), ['ab', 'cd']);
});

test('rankBySimilarity is deterministic and never mutates its inputs', () => {
  const snapshot = JSON.parse(JSON.stringify(CANDIDATES));
  const first = rankBySimilarity('Buy milk', CANDIDATES, { limit: 3, minScore: 0.2 });
  const second = rankBySimilarity('Buy milk', CANDIDATES, { limit: 3, minScore: 0.2 });
  assert.deepEqual(first, second);
  assert.deepEqual(CANDIDATES, snapshot);
});

test('rankBySimilarity carries extra candidate fields through to the result', () => {
  const ranked = rankBySimilarity(
    'Buy milk',
    [{ id: 't1', name: 'Buy milk', projectName: 'Errands', status: 'Available' }],
    { minScore: 0.5 }
  );
  assert.equal(ranked[0].projectName, 'Errands');
  assert.equal(ranked[0].status, 'Available');
});

test('rankBySimilarity returns nothing for an empty query', () => {
  assert.deepEqual(rankBySimilarity('', CANDIDATES, { minScore: 0.35 }), []);
});
