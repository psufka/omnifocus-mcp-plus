import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { ANALYZE_SCRIPT, renderVelocity } from './analyze.js';

process.env.TZ = 'America/Chicago';

function task(stamp: string | number | null) {
  const date = stamp === null ? null : new Date(stamp);
  return { project: null, taskStatus: date ? 'Completed' : 'Available',
    completionDate: date, added: date, tags: [], estimatedMinutes: null };
}

function execute(analysis: string, observed: string, tasks: any[], clockStepMs = 0) {
  let clockReads = 0;
  class ObservedDate extends Date {
    constructor(value?: string | number) {
      super(value === undefined ? Date.parse(observed) + clockReads++ * clockStepMs : value);
    }
  }
  const raw = runInNewContext(`(function () { ${ANALYZE_SCRIPT} })()`, {
    args: { analysis, days: 7 }, Date: ObservedDate,
    Task: { Status: { Completed: 'Completed', Dropped: 'Dropped' } },
    Project: { Status: {} }, flattenedTasks: tasks, flattenedProjects: []
  });
  return JSON.parse(raw);
}

const observed = '2026-09-05T18:21:20.973-05:00';
const start = '2026-08-30T00:00:00-05:00';
const boundaryTasks = () => [
  task(Date.parse(start) - 1), task(start), task(observed),
  task(Date.parse(observed) + 1), // later today is still in the future
  task('2026-09-06T00:00:00-05:00'), task('2027-07-30T00:00:00-05:00'), task(null)
];

test('health counts both observed-window endpoints and excludes older, missing and future dates', () => {
  const data = execute('health_snapshot', observed, boundaryTasks());
  assert.equal(data.completedLast7Days, 2);
  assert.equal(data.completedWindowStartIso, new Date(start).toISOString());
  assert.equal(data.completedWindowEndIso, new Date(observed).toISOString());
  assert.equal(data.completedWindowEndIso, data.generatedIso);
});

test('velocity excludes future completions and creations from records, totals and rates', () => {
  const data = execute('velocity', observed, boundaryTasks());
  const expected = [start, observed].map(value => new Date(value).toISOString());
  assert.deepEqual(data.completed.map((record: any) => record.completedIso), expected);
  assert.deepEqual(data.created, expected);
  assert.equal(data.windowEndIso, data.generatedIso);
  const markdown = renderVelocity(data);
  const rows = markdown.split('\n').filter(line => /^\| (Sun|Mon|Tue|Wed|Thu|Fri|Sat) /.test(line));
  assert.equal(rows.length, 7);
  const sumColumn = (column: number) => rows.reduce((sum, row) => sum + Number(row.split('|')[column].trim()), 0);
  assert.equal(sumColumn(2), 2);
  assert.equal(sumColumn(3), 2);
  assert.match(markdown, /- Completed: 2 · Created: 2/);
  assert.match(markdown, /Daily average completed: 0\.29/);
  assert.match(markdown, /Backlog growth per day: 0\.00/);
});

for (const [label, observation, expectedStart] of [
  ['spring DST', '2026-03-09T12:00:00-05:00', '2026-03-03T00:00:00-06:00'],
  ['fall DST', '2026-11-02T12:00:00-06:00', '2026-10-27T00:00:00-05:00'],
  ['leap day', '2028-03-01T12:00:00-06:00', '2028-02-24T00:00:00-06:00'],
  ['year boundary', '2027-01-02T12:00:00-06:00', '2026-12-27T00:00:00-06:00']
]) {
  test(`both analytics use seven local calendar days through observation across ${label}`, () => {
    const tasks = [task(Date.parse(expectedStart) - 1), task(expectedStart), task(observation), task(Date.parse(observation) + 1)];
    const health = execute('health_snapshot', observation, tasks);
    const velocity = execute('velocity', observation, tasks);
    assert.equal(health.completedWindowStartIso, new Date(expectedStart).toISOString());
    assert.equal(velocity.windowStartIso, health.completedWindowStartIso);
    assert.equal(health.completedLast7Days, 2);
    assert.equal(velocity.completed.length, 2);
    assert.equal(velocity.created.length, 2);
  });
}

test('crossing midnight during evaluation cannot move the window beyond its observation time', () => {
  const beforeMidnight = '2026-09-05T23:59:59.999-05:00';
  const tasks = [task(start)];
  const health = execute('health_snapshot', beforeMidnight, tasks, 1);
  const velocity = execute('velocity', beforeMidnight, tasks, 1);
  assert.equal(health.completedWindowStartIso, new Date(start).toISOString());
  assert.equal(velocity.windowStartIso, health.completedWindowStartIso);
  assert.equal(health.completedLast7Days, 1);
  assert.equal(velocity.completed.length, 1);
});
