import assert from 'node:assert/strict';
import test from 'node:test';
import { coerceBatchResults, summarizeBatchErrors } from './batchResults.js';

test('coerceBatchResults keeps input order and one result per item', () => {
  const raw = {
    success: true,
    results: [
      { index: 1, success: true, id: 'b', name: 'Second' },
      { index: 0, success: false, name: 'First', error: 'boom' }
    ]
  };

  const results = coerceBatchResults(raw, 2, 'fallback');
  assert.deepEqual(results.map(r => r.index), [0, 1]);
  assert.equal(results[0].success, false);
  assert.equal(results[0].error, 'boom');
  assert.equal(results[1].success, true);
  assert.equal(results[1].id, 'b');
});

test('coerceBatchResults fills missing entries with the script error', () => {
  const raw = { success: true, results: [{ index: 0, success: true, id: 'a' }] };
  const results = coerceBatchResults(raw, 3, 'fallback');
  assert.equal(results.length, 3);
  assert.equal(results[1].success, false);
  assert.equal(results[1].error, 'fallback');
});

test('coerceBatchResults turns a script-level failure into per-item failures', () => {
  const raw = { success: false, error: 'OmniFocus got an error' };
  const results = coerceBatchResults(raw, 2, 'fallback');
  assert.equal(results.length, 2);
  assert.ok(results.every(r => !r.success && r.error === 'OmniFocus got an error'));
});

test('coerceBatchResults handles a non-JSON string response', () => {
  const results = coerceBatchResults('osascript: execution error', 1, 'fallback');
  assert.equal(results[0].error, 'osascript: execution error');
});

test('coerceBatchResults never reports success without an error message', () => {
  const raw = { success: true, results: [{ index: 0, success: false }] };
  const results = coerceBatchResults(raw, 1, 'fallback');
  assert.equal(results[0].error, 'fallback');
});

test('summarizeBatchErrors returns undefined on partial success', () => {
  const summary = summarizeBatchErrors([
    { index: 0, success: true },
    { index: 1, success: false, error: 'nope' }
  ]);
  assert.equal(summary, undefined);
});

test('summarizeBatchErrors builds a summary from per-item errors', () => {
  const summary = summarizeBatchErrors([
    { index: 0, success: false, name: 'Alpha', error: 'Project not found with name: X' },
    { index: 1, success: false, id: 'abc', error: 'task not found with ID: abc' }
  ], 'added');

  assert.ok(summary);
  assert.match(summary!, /All 2 items failed/);
  assert.match(summary!, /Alpha/);
  assert.match(summary!, /not found with ID: abc/);
  // The regression this guards: the handlers used to print
  // "Failed to process batch operation: undefined".
  assert.doesNotMatch(summary!, /undefined/);
});

test('summarizeBatchErrors caps the listed failures', () => {
  const results = Array.from({ length: 8 }, (_, index) => ({ index, success: false, name: `T${index}`, error: 'nope' }));
  const summary = summarizeBatchErrors(results, 'added');
  assert.match(summary!, /\(\+3 more\)/);
});
