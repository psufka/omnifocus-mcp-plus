import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema } from './completeTask.js';

const here = dirname(fileURLToPath(import.meta.url));

function readPrimitive(name: string): string {
  return readFileSync(join(here, '..', 'primitives', name), 'utf8');
}

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

// --- Idempotency: a retry after a timeout must not read as a failure ---

test('completeTask succeeds when the task is already completed', () => {
  const src = readPrimitive('completeTask.ts');
  assert.doesNotMatch(src, /error: 'Task is already completed'/, 'completing an already-completed task must not be an error');
  assert.match(src, /alreadyCompleted: true/, 'already-completed path should report alreadyCompleted');
  assert.match(src, /success: true,[\s\S]*alreadyCompleted: true/, 'already-completed path should return success');
});

test('uncompleteTask succeeds when the task is already incomplete', () => {
  const src = readPrimitive('uncompleteTask.ts');
  assert.doesNotMatch(src, /error: 'Task is not completed/, 'uncompleting an incomplete task must not be an error');
  assert.match(src, /alreadyIncomplete: true/, 'already-incomplete path should report alreadyIncomplete');
  assert.match(src, /success: true,[\s\S]*alreadyIncomplete: true/, 'already-incomplete path should return success');
});

test('uncompleteTask reads the status name from the enum string, not the absent .name', () => {
  // OmniJS enum members have no .name: String(status) is
  // "[object Task.Status: Available]". The old code interpolated `undefined`.
  const src = readPrimitive('uncompleteTask.ts');
  assert.doesNotMatch(src, /task\.taskStatus\.name/, 'taskStatus.name is undefined in OmniJS');
  assert.match(src, /function __statusName\(status\)/, 'missing __statusName helper');
});

test('complete/uncomplete handlers report the no-change case distinctly', () => {
  const completeDef = readFileSync(join(here, 'completeTask.ts'), 'utf8');
  const uncompleteDef = readFileSync(join(here, 'uncompleteTask.ts'), 'utf8');
  assert.match(completeDef, /was already completed \(no change\)/, 'complete_task handler should say "already completed"');
  assert.match(uncompleteDef, /was already incomplete \(no change/, 'uncomplete_task handler should say "already incomplete"');
});
