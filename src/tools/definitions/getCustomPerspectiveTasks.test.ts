import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveCustomPerspectiveDisplayMode } from './getCustomPerspectiveTasks.js';
import { buildPerspectiveTaskTree, isPerspectiveTaskVisible } from '../primitives/perspectiveTaskTree.js';

const here = dirname(fileURLToPath(import.meta.url));

function readSource(relativePath: string): string {
  return readFileSync(join(here, relativePath), 'utf8');
}

test('resolveCustomPerspectiveDisplayMode respects explicit displayMode', () => {
  const mode = resolveCustomPerspectiveDisplayMode({
    perspectiveName: 'Today',
    displayMode: 'flat',
    showHierarchy: true,
    groupByProject: true,
  });

  assert.equal(mode, 'flat');
});

test('resolveCustomPerspectiveDisplayMode maps legacy params to task_tree', () => {
  const mode = resolveCustomPerspectiveDisplayMode({
    perspectiveName: 'Today',
    showHierarchy: true,
  });

  assert.equal(mode, 'task_tree');
});

test('resolveCustomPerspectiveDisplayMode maps legacy params to flat when groupByProject is false', () => {
  const mode = resolveCustomPerspectiveDisplayMode({
    perspectiveName: 'Today',
    groupByProject: false,
  });

  assert.equal(mode, 'flat');
});

test('resolveCustomPerspectiveDisplayMode defaults to project_tree', () => {
  const mode = resolveCustomPerspectiveDisplayMode({
    perspectiveName: 'Today',
  });

  assert.equal(mode, 'project_tree');
});

// --- limit applies to every display mode, not just flat ---

test('limit is applied before tree building, so tree modes truncate too', () => {
  const src = readSource('../primitives/getCustomPerspectiveTasks.ts');

  // The limit must be applied to the task list, not inside formatFlatTasks only.
  assert.match(src, /visibleTasks\.slice\(0, limit\)/, 'limit is not applied to tasks before tree building');
  assert.match(
    src,
    /buildPerspectiveTaskTree\(limitedTasks/,
    'tree is not built from the limited task list'
  );
  assert.match(src, /showing \$\{limitedTasks\.length\} of \$\{matchedCount\} tasks/, 'missing truncation note');

  // formatFlatTasks must no longer be the only place a limit is honored.
  assert.doesNotMatch(src, /limit > 0 \? tasks\.slice\(0, limit\) : tasks/, 'formatFlatTasks still applies the limit locally');

  // Every formatter receives the truncation note.
  const formatterCalls = src.match(/format(ProjectTree|TaskTree|FlatTasks)\(perspectiveName/g) || [];
  assert.equal(formatterCalls.length, 3, 'expected all three display modes to be routed through formatters');
  assert.match(src, /formatProjectTree\([\s\S]*?truncationNote\)/, 'project_tree does not receive the truncation note');
  assert.match(src, /formatTaskTree\([\s\S]*?truncationNote\)/, 'task_tree does not receive the truncation note');
});

test('isPerspectiveTaskVisible matches the tree builder visibility rule', () => {
  const tasks = [
    { id: 'a', name: 'Open', parent: null },
    { id: 'b', name: 'Done', parent: null, completed: true },
    { id: 'c', name: 'Dropped', parent: null, dropped: true },
  ];

  const visible = tasks.filter((task) => isPerspectiveTaskVisible(task as any, true));
  assert.deepEqual(visible.map((task) => task.id), ['a']);

  // Same rule the tree builder applies internally.
  const tree = buildPerspectiveTaskTree(tasks as any[], { hideCompleted: true });
  assert.deepEqual(tree.flatTasks.map((task) => task.id), ['a']);

  // With hideCompleted false, nothing is filtered out.
  const allVisible = tasks.filter((task) => isPerspectiveTaskVisible(task as any, false));
  assert.equal(allVisible.length, 3);
});

test('limiting the input list truncates the rendered tree', () => {
  const tasks = [
    { id: 'p1', name: 'Parent', project: 'Alpha', parent: null },
    { id: 'c1', name: 'Child', project: 'Alpha', parent: 'p1' },
    { id: 'p2', name: 'Second Parent', project: 'Beta', parent: null },
  ];

  const limited = tasks.slice(0, 2);
  const tree = buildPerspectiveTaskTree(limited as any[], { hideCompleted: true, inboxLabel: 'Inbox' });

  assert.equal(tree.flatTasks.length, 2);
  assert.equal(tree.projectGroups.length, 1);
  assert.equal(tree.projectGroups[0].projectName, 'Alpha');
  assert.equal(tree.rootTasks[0].children[0].id, 'c1');
});

// Window isolation and cleanup are exercised behaviorally in perspectiveWindow.test.ts.
