import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expandScriptHelpers } from '../../utils/taskQueryHelpers.js';
import { buildPerspectiveTaskTree, isPerspectiveTaskVisible, type PerspectiveTaskInput } from './perspectiveTaskTree.js';

const source = expandScriptHelpers(readFileSync(
  new URL('../../utils/omnifocusScripts/getCustomPerspectiveTasks.js', import.meta.url), 'utf8'
));

class FakeTask {
  static Status = {
    Available: Symbol('Available'), Blocked: Symbol('Blocked'), Completed: Symbol('Completed'),
    Dropped: Symbol('Dropped'), DueSoon: Symbol('DueSoon'), Next: Symbol('Next'), Overdue: Symbol('Overdue')
  };

  id: { primaryKey: string };
  name: string;
  project = null;
  containingProject = { name: 'Project' };
  tags = [];
  completed = false;
  active = true;

  constructor(id: string, public taskStatus: symbol, direct: { completed?: boolean; active?: boolean } = {}) {
    this.id = { primaryKey: id };
    this.name = id;
    Object.assign(this, direct);
  }
}

interface ContentNode { object: FakeTask | null; children: ContentNode[] }
const node = (task: FakeTask | null, children: ContentNode[] = []): ContentNode => ({ object: task, children });

function collect(nodes: ContentNode[]): PerspectiveTaskInput[] {
  const previousPerspective = { identifier: 'previous' };
  const perspective = { identifier: 'all-tasks' };
  const window = { perspective: previousPerspective, content: { rootNode: { children: nodes } } };
  const run = new Function('Task', 'Perspective', 'document', 'injectedArgs',
    'return (\n' + source.trimEnd().replace(/;$/, '') + '\n);');
  const result = JSON.parse(run(FakeTask, { Custom: { byName: () => perspective } },
    { windows: [window] }, { perspectiveName: 'All Tasks' }));
  assert.equal(result.success, true, result.error);
  assert.equal(window.perspective, previousPerspective);
  assert.equal(result.count, Object.keys(result.taskMap).length);
  return Object.values(result.taskMap);
}

const finishedCases = [
  { name: 'directly dropped task', status: FakeTask.Status.Dropped, direct: { active: false } },
  { name: 'task in a dropped folder', status: FakeTask.Status.Dropped, direct: { active: true } },
  { name: 'task in a nested dropped folder', status: FakeTask.Status.Dropped, direct: { active: true } },
  { name: 'child of a dropped task', status: FakeTask.Status.Dropped, direct: { active: true } },
  { name: 'directly completed task', status: FakeTask.Status.Completed, direct: { completed: true } },
  { name: 'child of a completed task or project', status: FakeTask.Status.Completed, direct: { completed: false } },
];

for (const { name, status, direct } of finishedCases) {
  test(`custom perspective hides ${name} and retains it when hideCompleted is false`, () => {
    // OmniFocus computes taskStatus from the task and its containers. Direct
    // completed/active properties need not reflect the inherited status.
    const tasks = collect([node(new FakeTask(name, status, direct))]);
    assert.equal(tasks[0].completed, status === FakeTask.Status.Completed);
    assert.equal(tasks[0].dropped, status === FakeTask.Status.Dropped);
    assert.deepEqual(tasks.filter(task => isPerspectiveTaskVisible(task, true)), []);
    assert.equal(buildPerspectiveTaskTree(tasks).flatTasks.length, 0);
    assert.equal(tasks.filter(task => isPerspectiveTaskVisible(task, false)).length, 1);
    assert.equal(buildPerspectiveTaskTree(tasks, { hideCompleted: false }).flatTasks[0].id, name);
  });
}

test('custom perspective keeps all remaining statuses, including blocked tasks', () => {
  const remaining = ['Available', 'Blocked', 'DueSoon', 'Next', 'Overdue'] as const;
  const tasks = collect(remaining.map(status => node(new FakeTask(status, FakeTask.Status[status]))));
  assert.deepEqual(tasks.filter(task => isPerspectiveTaskVisible(task, true)).map(task => task.id), remaining);
  for (const task of tasks) {
    assert.equal(task.completed, false);
    assert.equal(task.dropped, false);
  }
});

test('custom perspective preserves nested finished tasks only when requested', () => {
  const tasks = collect([node(null, [node(new FakeTask('parent', FakeTask.Status.Available), [
    node(new FakeTask('dropped-group', FakeTask.Status.Dropped, { active: false }), [
      node(new FakeTask('dropped-child', FakeTask.Status.Dropped))
    ]),
    node(new FakeTask('completed-group', FakeTask.Status.Completed, { completed: true }), [
      node(new FakeTask('completed-child', FakeTask.Status.Completed))
    ]),
    node(new FakeTask('remaining-child', FakeTask.Status.Blocked))
  ])])]);

  const visible = buildPerspectiveTaskTree(tasks);
  assert.deepEqual(visible.flatTasks.map(task => task.id), ['parent', 'remaining-child']);
  assert.deepEqual(visible.rootTasks[0].children.map(task => task.id), ['remaining-child']);

  const all = buildPerspectiveTaskTree(tasks, { hideCompleted: false });
  assert.equal(all.flatTasks.length, 6);
  assert.deepEqual(all.rootTasks[0].children.map(task => task.id),
    ['dropped-group', 'completed-group', 'remaining-child']);
  assert.equal(all.rootTasks[0].children[0].children[0].id, 'dropped-child');
  assert.equal(all.rootTasks[0].children[1].children[0].id, 'completed-child');
});
