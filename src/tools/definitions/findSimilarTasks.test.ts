import assert from 'node:assert/strict';
import test from 'node:test';

import { schema } from './findSimilarTasks.js';

test('find_similar_tasks schema applies the documented defaults', () => {
  const result = schema.safeParse({ name: 'Buy milk' });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.includeCompleted, false);
    assert.equal(result.data.limit, 5);
    assert.equal(result.data.minScore, 0.35);
  }
});

test('find_similar_tasks schema requires a non-empty name', () => {
  assert.equal(schema.safeParse({}).success, false);
  assert.equal(schema.safeParse({ name: '' }).success, false);
});

test('find_similar_tasks schema bounds limit and minScore', () => {
  assert.equal(schema.safeParse({ name: 'x', limit: 0 }).success, false);
  assert.equal(schema.safeParse({ name: 'x', limit: 21 }).success, false);
  assert.equal(schema.safeParse({ name: 'x', limit: 2.5 }).success, false);
  assert.equal(schema.safeParse({ name: 'x', limit: 20 }).success, true);
  assert.equal(schema.safeParse({ name: 'x', minScore: -0.1 }).success, false);
  assert.equal(schema.safeParse({ name: 'x', minScore: 1.1 }).success, false);
  assert.equal(schema.safeParse({ name: 'x', minScore: 1 }).success, true);
});

test('find_similar_tasks schema rejects unknown top-level fields', () => {
  const result = schema.safeParse({ name: 'x', bogusUnknownField: true });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(JSON.stringify(result.error.issues), /bogusUnknownField|unrecognized/i);
  }
});
