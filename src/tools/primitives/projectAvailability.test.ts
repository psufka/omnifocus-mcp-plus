import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { ANALYZE_SCRIPT, renderHealthSnapshot, renderStalledProjects } from './analyze.js';
import { LIST_PROJECTS_SCRIPT } from './listProjects.js';
import { GET_PROJECT_COUNTS_SCRIPT } from './getProjectCounts.js';

const observed = new Date('2026-10-02T12:00:00Z');
const future = new Date(observed.getTime() + 1);
const past = new Date(observed.getTime() - 1);
const old = new Date('2026-01-01T00:00:00Z');
const taskStatuses = ['Available', 'Next', 'DueSoon', 'Overdue', 'Blocked', 'Completed', 'Dropped'];
const projectStatuses = ['Active', 'OnHold', 'Done', 'Dropped'];
const statuses = (names: string[]) => Object.fromEntries(names.map(name => [name, name]));

function task(status = 'Blocked', overrides: any = {}) {
  return { project: null, taskStatus: status, effectiveDeferDate: null,
    tags: [], estimatedMinutes: null, ...overrides };
}

function project(tasks: any[], overrides: any = {}) {
  const p: any = { id: { primaryKey: 'project' }, name: 'Example project', status: 'Active',
    parentFolder: null, sequential: false, containsSingletonActions: true, nextTask: null,
    ...overrides };
  p.task = task('Blocked', { project: p, modified: observed, effectiveActive: true, ...overrides.root });
  p.flattenedTasks = [p.task, ...tasks];
  return p;
}

function execute(script: string, projects: any[], args: any = {}) {
  class ObservedDate extends Date {
    constructor(value?: string | number) { super(value === undefined ? observed.getTime() : value); }
  }
  return JSON.parse(runInNewContext(`(function () { ${script} })()`, {
    args: { inactiveDays: 30, ...args }, Date: ObservedDate,
    Task: { Status: statuses(taskStatuses) }, Project: { Status: statuses(projectStatuses) },
    flattenedProjects: projects, flattenedTasks: projects.flatMap(p => p.flattenedTasks)
  }));
}

// Exercise every public consumer, rather than just the shared predicate.
function assertSignal(p: any, expected: boolean, remaining: number) {
  const health = execute(ANALYZE_SCRIPT, [p], { analysis: 'health_snapshot' });
  assert.equal(health.activeProjectsNoNextAction, Number(expected), 'health_snapshot');
  const stalled = execute(ANALYZE_SCRIPT, [p], { analysis: 'stalled_projects' });
  assert.equal(stalled.projects.length, Number(expected), 'stalled_projects');
  if (expected) {
    assert.equal(stalled.projects[0].noNextAction, true);
    assert.equal(stalled.projects[0].remainingTasks, remaining);
  }
  const counts = execute(GET_PROJECT_COUNTS_SCRIPT, [p]);
  assert.equal(counts.stalled, Number(expected), 'get_project_counts');
  const listed = execute(LIST_PROJECTS_SCRIPT, [p]);
  assert.equal(listed.projects[0].isStalled, expected, 'list_projects.isStalled');
  assert.equal(listed.projects[0].remainingTaskCount, remaining);
  const filtered = execute(LIST_PROJECTS_SCRIPT, [p], { stalledOnly: true });
  assert.equal(filtered.projects.length, Number(expected), 'list_projects.stalledOnly');
}

for (const type of ['single-action', 'parallel', 'sequential']) {
  for (const status of taskStatuses) {
    test(`${type}: ${status} work has a consistent missing-action signal`, () => {
      const t = task(status);
      const finished = status === 'Completed' || status === 'Dropped';
      const p = project([t], { containsSingletonActions: type === 'single-action', sequential: type === 'sequential',
        nextTask: type === 'single-action' || status === 'Blocked' ? null : t });
      assertSignal(p, status === 'Blocked', finished ? 0 : 1);
    });
  }
}

for (const [label, tasks, expected] of [
  ['future defer on the action', [task('Blocked', { deferDate: future, effectiveDeferDate: future })], false],
  ['inherited defer with no direct task date', [task('Blocked', { effectiveDeferDate: future })], false],
  ['defer exactly now has expired', [task('Blocked', { effectiveDeferDate: observed })], true],
  ['past defer does not explain another block', [task('Blocked', { effectiveDeferDate: past })], true],
  ['deferred first action with blocked sequential followers', [task('Blocked', { effectiveDeferDate: future }), task()], false],
  ['available work with blocked siblings', [task(), task('Available')], false],
  ['finished deferred work does not hide a blocked action', [task('Completed', { effectiveDeferDate: future }), task('Dropped', { effectiveDeferDate: future }), task()], true],
  ['no tasks', [], false],
  ['only completed and dropped tasks', [task('Completed'), task('Dropped')], false]
] as Array<[string, any[], boolean]>) {
  test(label, () => assertSignal(project(tasks), expected, tasks.filter(t => !['Completed', 'Dropped'].includes(t.taskStatus)).length));
}

test('available nested action counts even when its group is blocked', () => {
  const group = task();
  const child = task('Available', { parent: group });
  group.tasks = [child];
  assertSignal(project([group, child]), false, 2);
});

test('root availability does not substitute for blocked child work or count as remaining', () => {
  assertSignal(project([task()], { root: { taskStatus: 'Available' } }), true, 1);
});

for (const state of ['Available', 'Blocked', 'Deferred', 'Empty']) {
  test(`inactivity is independent for ${state} projects`, () => {
    const tasks = state === 'Empty' ? [] : [task(state === 'Available' ? 'Available' : 'Blocked', {
      effectiveDeferDate: state === 'Deferred' ? future : null
    })];
    const p = project(tasks, { root: { modified: old } });
    const result = execute(ANALYZE_SCRIPT, [p], { analysis: 'stalled_projects' });
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].lastActivityStale, true);
    assert.equal(result.projects[0].noNextAction, state === 'Blocked');
  });
}

for (const status of ['OnHold', 'Done', 'Dropped']) {
  test(`${status} project scope respects includeOnHold`, () => {
    const p = project([task()], { status, root: { modified: old } });
    assert.equal(execute(ANALYZE_SCRIPT, [p], { analysis: 'health_snapshot' }).activeProjectsNoNextAction, 0);
    assert.equal(execute(GET_PROJECT_COUNTS_SCRIPT, [p]).stalled, 0);
    assert.equal(execute(LIST_PROJECTS_SCRIPT, [p], { stalledOnly: true }).count, 0);
    for (const includeOnHold of [false, true]) {
      const result = execute(ANALYZE_SCRIPT, [p], { analysis: 'stalled_projects', includeOnHold });
      const expected = status === 'OnHold' && includeOnHold;
      assert.equal(result.scannedProjects, Number(expected));
      assert.equal(result.projects.length, Number(expected));
    }
  });
}

test('missing-action results do not depend on dateMode or includeProjectRoots', () => {
  const p = project([task('Blocked', { effectiveDeferDate: future })]);
  for (const dateMode of ['direct', 'effective']) {
    for (const includeProjectRoots of [false, true]) {
      const args = { dateMode, includeProjectRoots };
      assert.equal(execute(ANALYZE_SCRIPT, [p], { ...args, analysis: 'health_snapshot' }).activeProjectsNoNextAction, 0);
      assert.equal(execute(ANALYZE_SCRIPT, [p], { ...args, analysis: 'stalled_projects' }).projects.length, 0);
    }
  }
});

test('remaining-task sorting excludes roots and finished work', () => {
  const one = project([task(), task('Completed')], { id: { primaryKey: 'one' } });
  const empty = project([], { id: { primaryKey: 'empty' } });
  const two = project([task(), task()], { id: { primaryKey: 'two' } });
  const result = execute(LIST_PROJECTS_SCRIPT, [two, empty, one], { sortBy: 'remainingTaskCount' });
  assert.deepEqual(result.projects.map((p: any) => [p.id, p.remainingTaskCount]), [['empty', 0], ['one', 1], ['two', 2]]);
});

test('effectively dropped projects are excluded from signals while explicit status totals are preserved', () => {
  const outer = { name: 'Dropped folder', parent: null, status: 'Dropped' };
  const inner = { name: 'Nested folder', parent: outer, status: 'Active' };
  const p = project([task('Dropped')], { parentFolder: inner,
    root: { taskStatus: 'Dropped', effectiveActive: false, modified: old } });
  const health = execute(ANALYZE_SCRIPT, [p], { analysis: 'health_snapshot' });
  assert.equal(health.projects.active, 1);
  assert.equal(health.activeProjectsNoNextAction, 0);
  const counts = execute(GET_PROJECT_COUNTS_SCRIPT, [p]);
  assert.equal(counts.active, 1);
  assert.equal(counts.stalled, 0);
  assert.equal(execute(LIST_PROJECTS_SCRIPT, [p]).projects[0].isStalled, false);
  assert.equal(execute(LIST_PROJECTS_SCRIPT, [p], { stalledOnly: true }).count, 0);
  for (const includeOnHold of [false, true]) {
    const result = execute(ANALYZE_SCRIPT, [p], { analysis: 'stalled_projects', includeOnHold });
    assert.equal(result.scannedProjects, 0);
    assert.deepEqual(result.projects, []);
  }
});

test('inactivity threshold and missing modification dates retain their existing behavior', () => {
  const threshold = new Date(observed);
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - 30);
  for (const [modified, stale] of [[new Date(threshold.getTime() - 1), true], [threshold, false], [null, false]] as const) {
    const p = project([task('Available')], { root: { modified } });
    assert.equal(execute(ANALYZE_SCRIPT, [p], { analysis: 'stalled_projects' }).projects.length, Number(stale));
  }
});

test('rendered definitions explain available and deferred work instead of nextTask', () => {
  const p = project([task()]);
  const health = renderHealthSnapshot(execute(ANALYZE_SCRIPT, [p], { analysis: 'health_snapshot' }));
  const stalled = renderStalledProjects(execute(ANALYZE_SCRIPT, [p], { analysis: 'stalled_projects' }));
  for (const markdown of [health, stalled]) {
    assert.doesNotMatch(markdown, /project\.nextTask|own root task as nextTask/);
    assert.match(markdown, /available/i);
    assert.match(markdown, /defer/i);
  }
});
