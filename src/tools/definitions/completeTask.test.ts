import assert from 'node:assert/strict';
import test from 'node:test';
import { schema } from './completeTask.js';

test('complete_task schema accepts a task_id string', () => {
  const r = schema.safeParse({ task_id: 'abc' });
  assert.equal(r.success, true);
});

test('complete_task schema rejects missing task_id', () => {
  const r = schema.safeParse({});
  assert.equal(r.success, false);
});

test('complete_task schema rejects unknown fields', () => {
  const r = schema.safeParse({ task_id: 'abc', bogus: 1 });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /bogus|unrecognized/i);
  }
});
