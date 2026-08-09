import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reorderTask } from './reorderTask.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'reorderTask.ts'), 'utf8');

// --- TS-side guards (these return before any OmniFocus call) ---

test('reorderTask requires taskId or taskName', async () => {
  const r = await reorderTask({ position: 'beginning' });
  assert.equal(r.success, false);
  assert.match(r.error, /Either taskId or taskName/);
});

test('reorderTask requires exactly one destination', async () => {
  const none = await reorderTask({ taskId: 't1' });
  assert.equal(none.success, false);
  assert.match(none.error, /Exactly one of beforeTaskId, afterTaskId, or position/);

  const two = await reorderTask({ taskId: 't1', beforeTaskId: 't2', position: 'ending' });
  assert.equal(two.success, false);
  assert.match(two.error, /Exactly one of beforeTaskId, afterTaskId, or position/);
});

// --- OmniJS-embedded siblingship guard (source assertions) ---

test('reorderTask compares containers before moving to a reference task', () => {
  // Without this check moveTasks() silently RELOCATES the task into the
  // reference task's project — a cross-container move behind a "reorder" API.
  assert.match(src, /function __containerKey\(t\)/, 'missing __containerKey helper');
  assert.match(src, /__containerKey\(task\) !== __containerKey\(sibling\)/, 'missing container comparison before moveTasks');
});

test('__containerKey distinguishes parent task, project top level, and inbox', () => {
  assert.match(src, /return 'parent:' \+ t\.parent\.id\.primaryKey/, 'missing parent-task container key');
  assert.match(src, /return 'inbox'/, 'missing inbox container key');
  assert.match(src, /return 'project:' \+ t\.containingProject\.id\.primaryKey/, 'missing project container key');
});

test('cross-container reorder produces an actionable error, not a silent move', () => {
  assert.match(src, /is not a sibling/, 'missing not-a-sibling error text');
  assert.match(src, /use move_task to relocate/, 'error should point users at move_task');
});

test('reorderTask rejects a reference task that is the task itself', () => {
  assert.match(src, /refers to the task being reordered/, 'missing self-reference guard');
});

test('reorderTask uses the shared strict lookup helpers', () => {
  assert.match(src, /OMNIJS_LOOKUP_HELPERS/, 'reorderTask should prepend the shared lookup helpers');
  assert.match(src, /__resolveByIdOrName\(allTasks, args\.taskId, args\.taskName/, 'reorderTask should resolve the task via __resolveByIdOrName');
});
