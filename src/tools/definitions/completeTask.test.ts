import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema } from './completeTask.js';
import { runInNewContext } from 'node:vm';
import { COMPLETE_TASK_SCRIPT } from '../primitives/completeTask.js';

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

// --- Post-write read-back verification (v0.5.0) ---------------------------

test('completeTask reads the task back and reports whether the write landed', () => {
  const src = readPrimitive('completeTask.ts');
  assert.match(src, /const completed = \(task\.taskStatus === Task\.Status\.Completed\) \|\| task\.completed === true/, 'completion is not read back');
  assert.match(src, /verified: true/, 'successful completion does not report verified');
  assert.match(src, /markComplete\(\) did not take effect/, 'a silent no-op completion is not reported as a failure');
  assert.match(src, /success: false,[\s\S]{0,200}verified: false/, 'an unverified completion must not report success');
});

function executeCompletion(task: any) {
  return JSON.parse(runInNewContext(`(function () { ${COMPLETE_TASK_SCRIPT} })()`, {
    args: { task_id: 'original' }, flattenedTasks: [task],
    Task: { Status: { Completed: 'Completed', Dropped: 'Dropped' } }
  }));
}

test('repeating completion distinguishes the completed clone from the active original', () => {
  const task = { id: { primaryKey: 'original' }, name: 'repeat', taskStatus: 'Available', repetitionRule: {},
    markComplete: () => ({ id: { primaryKey: 'completed-clone' }, taskStatus: 'Completed' }) };
  const result = executeCompletion(task);
  assert.equal(result.verified, true);
  assert.equal(result.completedOccurrenceId, 'completed-clone');
  assert.equal(result.nextOccurrenceId, 'original');
});

test('a different returned ID without completed status is not proof of completion', () => {
  const task = { id: { primaryKey: 'original' }, name: 'repeat', taskStatus: 'Available', repetitionRule: {},
    markComplete: () => ({ id: { primaryKey: 'another' }, taskStatus: 'Available' }) };
  assert.equal(executeCompletion(task).verified, false);
});

test('ordinary completion reports the completed original without a next occurrence', () => {
  const task: any = { id: { primaryKey: 'original' }, name: 'once', taskStatus: 'Available',
    markComplete() { this.taskStatus = 'Completed'; return this; } };
  const result = executeCompletion(task);
  assert.equal(result.completedOccurrenceId, 'original');
  assert.equal(result.nextOccurrenceId, undefined);
  assert.equal(result.verified, true);
});

test('complete_task handler surfaces the next occurrence of a repeating task', () => {
  const def = readFileSync(join(here, 'completeTask.ts'), 'utf8');
  assert.match(def, /result\.nextOccurrenceId/, 'handler hides the new occurrence');
  assert.match(def, /next occurrence remains active/, 'handler does not explain the repeat');
});

test('complete/uncomplete handlers report the no-change case distinctly', () => {
  const completeDef = readFileSync(join(here, 'completeTask.ts'), 'utf8');
  const uncompleteDef = readFileSync(join(here, 'uncompleteTask.ts'), 'utf8');
  assert.match(completeDef, /was already completed \(no change\)/, 'complete_task handler should say "already completed"');
  assert.match(uncompleteDef, /was already incomplete \(no change/, 'uncomplete_task handler should say "already incomplete"');
});
