import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addOmniFocusTask,
  normalizeItemDates,
  validateAddTaskParams,
  ADD_TASK_SCRIPT,
  OMNIJS_CREATE_TASK_HELPER,
  OMNIJS_PLACEMENT_HELPERS
} from './addOmniFocusTask.js';
import { handler as addTaskHandler } from '../definitions/addOmniFocusTask.js';

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

// --- placement resolution + post-write verification ---

test('the placement helper survives the runOmniJs escaping round-trip', () => {
  assert.ok(!OMNIJS_PLACEMENT_HELPERS.includes('`'));
  assert.ok(!OMNIJS_PLACEMENT_HELPERS.includes('$'));
  assert.ok(!OMNIJS_PLACEMENT_HELPERS.includes('\\'));
});

test('the placement helper is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(OMNIJS_PLACEMENT_HELPERS));
});

test('resolution is split out of creation so a dry run can resolve without writing', () => {
  // __createTask must take its location from a placement it was handed or
  // resolved separately — never inline a lookup next to `new Task`.
  assert.match(OMNIJS_CREATE_TASK_HELPER, /new Task\(spec\.name, placement\.location\)/);
  assert.match(OMNIJS_PLACEMENT_HELPERS, /function __resolveTaskPlacement\(spec\)/);
  assert.doesNotMatch(OMNIJS_CREATE_TASK_HELPER, /__resolveByIdOrName\(/, 'creation must not do its own lookups');
});

test('a created task is read back and its placement compared before success is reported', () => {
  assert.match(ADD_TASK_SCRIPT, /__verifyTaskPlacement\(created\.task, created\.placement\)/);
  // Existence failure is a hard failure...
  assert.match(ADD_TASK_SCRIPT, /if \(!check\.exists\) \{[\s\S]*success: false/);
  // ...and a placement mismatch surfaces as verified:false plus a warning
  // naming both sides, rather than a silent success.
  assert.match(ADD_TASK_SCRIPT, /verified: check\.verified/);
  assert.match(OMNIJS_PLACEMENT_HELPERS, /'Placement not verified: requested ' \+ __placementLabel\(requested\) \+ ' but the task is in ' \+ __placementLabel\(out\.actual\)/);
});

test('placement comparison prefers ids and treats inbox/library as identity-free', () => {
  assert.match(OMNIJS_PLACEMENT_HELPERS, /if \(requested\.kind !== actual\.kind\) \{ return false; \}/);
  assert.match(OMNIJS_PLACEMENT_HELPERS, /if \(requested\.id && actual\.id\) \{ return requested\.id === actual\.id; \}/);
});

test('a serialized placement never carries the OmniJS location object', () => {
  // JSON.stringify on an OmniJS object yields {}, so .location must be dropped
  // before a placement crosses back to Node.
  assert.match(OMNIJS_PLACEMENT_HELPERS, /function __publicPlacement\(p\)/);
  assert.doesNotMatch(OMNIJS_PLACEMENT_HELPERS, /out\.location/);
});

// --- Handler output ---------------------------------------------------------

test('add_omnifocus_task prints the id of the task it just created', async () => {
  // The primitive has always returned taskId and the handler always dropped it,
  // so an agent had to re-find its own task by name before it could touch it.
  const result: any = await addTaskHandler({ name: 'Call the plumber' }, {} as any, {
    addOmniFocusTask: async () => ({ success: true, taskId: 'abc123', verified: true })
  } as any);

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /\[id: abc123\]/);
});

test('add_omnifocus_task prints the id even when placement could not be verified', async () => {
  const result: any = await addTaskHandler({ name: 'Call the plumber', projectName: 'Home' }, {} as any, {
    addOmniFocusTask: async () => ({
      success: true,
      taskId: 'abc123',
      verified: false,
      warning: 'Placement not verified: requested project "Home" but the task is in the inbox.'
    })
  } as any);

  assert.match(result.content[0].text, /\[id: abc123\]/, 'the id is most needed when the task went somewhere unexpected');
  assert.match(result.content[0].text, /but NOT in project "Home"/);
});

test('add_omnifocus_task omits the id marker when the primitive returned none', async () => {
  const result: any = await addTaskHandler({ name: 'Call the plumber' }, {} as any, {
    addOmniFocusTask: async () => ({ success: true, verified: true })
  } as any);

  assert.doesNotMatch(result.content[0].text, /\[id:/);
});
