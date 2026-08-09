import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addOmniFocusTask,
  normalizeItemDates,
  validateAddTaskParams,
  OMNIJS_CREATE_TASK_HELPER
} from './addOmniFocusTask.js';

test('addOmniFocusTask rejects both parentTaskId and parentTaskName', async () => {
  const result = await addOmniFocusTask({
    name: 'Test Task',
    parentTaskId: 'id-1',
    parentTaskName: 'Parent Name'
  });

  assert.equal(result.success, false);
  assert.match(result.error || '', /Cannot specify both parentTaskId and parentTaskName/);
});

test('addOmniFocusTask rejects parent task with project', async () => {
  const result = await addOmniFocusTask({
    name: 'Test Task',
    parentTaskId: 'id-1',
    projectName: 'My Project'
  });

  assert.equal(result.success, false);
  assert.match(result.error || '', /Cannot specify both parent task and project/);
});

test('validateAddTaskParams accepts a plain task', () => {
  assert.equal(validateAddTaskParams({ name: 'Test Task' }).valid, true);
  assert.equal(validateAddTaskParams({ name: 'Test Task', projectName: 'P' }).valid, true);
});

test('normalizeItemDates converts bare dates to local midnight', () => {
  const normalized = normalizeItemDates({
    name: 'T',
    dueDate: '2026-03-05',
    deferDate: '2026-03-04T08:00:00-06:00',
    plannedDate: '2026-03-03'
  });

  assert.equal(normalized.dueDate, '2026-03-05T00:00:00');
  assert.equal(normalized.deferDate, '2026-03-04T08:00:00-06:00');
  assert.equal(normalized.plannedDate, '2026-03-03T00:00:00');
});

test('normalizeItemDates does not mutate its input', () => {
  const params = { name: 'T', dueDate: '2026-03-05' };
  normalizeItemDates(params);
  assert.equal(params.dueDate, '2026-03-05');
});

// The creation script needs the OmniFocus runtime, so its numeric-field and
// warning behaviour is asserted against the shared OmniJS source.

test('estimatedMinutes: 0 is written, not skipped by a truthiness check', () => {
  assert.match(OMNIJS_CREATE_TASK_HELPER, /if \(spec\.estimatedMinutes !== undefined\) \{ task\.estimatedMinutes = spec\.estimatedMinutes; \}/);
  assert.doesNotMatch(OMNIJS_CREATE_TASK_HELPER, /if \(spec\.estimatedMinutes\)/);
});

test('flagged: false is written explicitly rather than skipped', () => {
  assert.match(OMNIJS_CREATE_TASK_HELPER, /if \(spec\.flagged !== undefined\) \{ task\.flagged = spec\.flagged; \}/);
});

test('a failed plannedDate write becomes a warning instead of a silent catch', () => {
  assert.match(OMNIJS_CREATE_TASK_HELPER, /warnings\.push\('plannedDate was not applied/);
  // The bug: `try { ... } catch(e) {}` discarded the failure entirely.
  assert.doesNotMatch(OMNIJS_CREATE_TASK_HELPER, /catch\s*\(e\)\s*\{\s*\}/);
});

test('the creation helper survives the runOmniJs escaping round-trip', () => {
  // runOmniJs escapes \ ` and $ — the shared snippet must contain none of them.
  assert.ok(!OMNIJS_CREATE_TASK_HELPER.includes('`'));
  assert.ok(!OMNIJS_CREATE_TASK_HELPER.includes('$'));
  assert.ok(!OMNIJS_CREATE_TASK_HELPER.includes('\\'));
});
