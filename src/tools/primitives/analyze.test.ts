// A fixed timezone makes every local-rendering and local-bucketing assertion
// deterministic. node:test runs each test file in its own process, so this
// cannot leak into another file. America/Chicago is west of UTC, which is what
// makes the 23:30 bucketing case discriminating: UTC-based bucketing would
// push it into the next day.
process.env.TZ = 'America/Chicago';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYZE_SCRIPT,
  AnalyzeParams,
  DEFAULT_INACTIVE_DAYS,
  DEFAULT_VELOCITY_DAYS,
  STALLED_PROJECT_ROW_CAP,
  analyze,
  bucketByLocalDay,
  buildScriptArgs,
  localDayKey,
  median,
  renderHealthSnapshot,
  renderOverdueClusters,
  renderStalledProjects,
  renderVelocity
} from './analyze.js';

// ISO instant for a given LOCAL wall-clock time — the wire format the OmniJS
// script produces.
function localIso(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

// A raw ISO-8601 UTC timestamp must never reach the caller.
const UTC_LEAK = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/;

// ---------------------------------------------------------------------------
// Script coverage — unit tests that mock runOmniJs cannot catch a syntax error
// or an escaping hazard in the script source.
// ---------------------------------------------------------------------------

test('analyze script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', ANALYZE_SCRIPT), 'analyze script failed to parse');
});

test('analyze script survives the runOmniJs escaping round-trip', () => {
  assert.ok(!ANALYZE_SCRIPT.includes('`'), 'analyze script contains a backtick');
  assert.ok(!ANALYZE_SCRIPT.includes('$'), 'analyze script contains a dollar sign');
  assert.ok(!ANALYZE_SCRIPT.includes('\\'), 'analyze script contains a backslash');
});

test('analyze script reads user data only from the args object', () => {
  assert.match(ANALYZE_SCRIPT, /\bargs\.analysis\b/);
  assert.match(ANALYZE_SCRIPT, /\bargs\.days\b/);
  assert.match(ANALYZE_SCRIPT, /\bargs\.inactiveDays\b/);
  assert.match(ANALYZE_SCRIPT, /\bargs\.includeOnHold\b/);
});

test('analyze script avoids the OmniJS properties that do not exist', () => {
  // JXA-only count properties, and the task flags that are not OmniJS properties.
  assert.doesNotMatch(ANALYZE_SCRIPT, /numberOf/);
  assert.doesNotMatch(ANALYZE_SCRIPT, /availableTaskCount/);
  assert.doesNotMatch(ANALYZE_SCRIPT, /\.blocked\b/);
  assert.doesNotMatch(ANALYZE_SCRIPT, /\.next\b/);
  // Project carries no .added/.modified — the root task does.
  assert.doesNotMatch(ANALYZE_SCRIPT, /\bp\.(added|modified)\b/);
  assert.match(ANALYZE_SCRIPT, /p\.task/, 'project timestamps must come from the root task');
  // Object.keys() returns [] on OmniJS objects.
  assert.doesNotMatch(ANALYZE_SCRIPT, /Object\.keys/);
});

test('analyze script buckets and thresholds on local calendar fields, not UTC slicing', () => {
  assert.doesNotMatch(ANALYZE_SCRIPT, /toISOString\(\)\s*\.\s*slice/);
  assert.match(ANALYZE_SCRIPT, /setHours\(0, 0, 0, 0\)/);
  assert.match(ANALYZE_SCRIPT, /setDate\(d\.getDate\(\) - n\)/);
});

test('analyze script filters out project root tasks before counting', () => {
  assert.match(ANALYZE_SCRIPT, /function __isRealTask/);
  assert.match(ANALYZE_SCRIPT, /__queryTasks\(args\.includeProjectRoots\)/);
});

test('every task walk in the analyze script filters out project root tasks', () => {
  // A project root task is a member of BOTH flattenedTasks and its project's
  // flattenedTasks. The stalled-projects remaining-task count walked
  // p.flattenedTasks without the filter and reported one task too many for
  // every project.
  const walks = ANALYZE_SCRIPT.match(/[A-Za-z.]*flattenedTasks[.\s]*(filter|forEach)/g) ?? [];
  assert.ok(walks.length >= 2, 'expected at least two task walks in the script');
  assert.match(
    ANALYZE_SCRIPT,
    /p\.flattenedTasks\.forEach\(function \(t\) \{ if \(__isRealTask\(t\) &&/,
    'the per-project remaining count does not exclude the project root task'
  );
});

// ---------------------------------------------------------------------------
// Executor contract
// ---------------------------------------------------------------------------

function stubExecutor(payload: any) {
  const calls: Array<{ script: string; args: any; options: any }> = [];
  const runOmniJs = async (script: string, args?: any, options?: any) => {
    calls.push({ script, args, options });
    return payload;
  };
  return { deps: { runOmniJs }, calls };
}

test('analyze makes exactly one read-only script call', async () => {
  const { deps, calls } = stubExecutor({ success: true, analysis: 'health_snapshot', projects: {} });
  await analyze({ analysis: 'health_snapshot' }, deps);

  assert.equal(calls.length, 1, 'an analysis must be a single OmniJS evaluation');
  assert.equal(calls[0].script, ANALYZE_SCRIPT);
  assert.deepEqual(calls[0].options, { readOnly: true });
});

test('analyze injects resolved defaults as args rather than interpolating them', () => {
  assert.deepEqual(buildScriptArgs({ analysis: 'velocity' }), {
    dateMode: 'direct', includeProjectRoots: false,
    analysis: 'velocity',
    days: DEFAULT_VELOCITY_DAYS,
    inactiveDays: DEFAULT_INACTIVE_DAYS,
    includeOnHold: false
  });

  assert.deepEqual(
    buildScriptArgs({
      analysis: 'stalled_projects',
      velocity: { days: 3 },
      stalledProjects: { inactiveDays: 90, includeOnHold: true }
    }),
    { analysis: 'stalled_projects', days: 3, inactiveDays: 90, includeOnHold: true, dateMode: 'direct', includeProjectRoots: false }
  );
});

test('analyze surfaces a script-level failure instead of rendering it as data', async () => {
  const { deps } = stubExecutor({ success: false, error: 'Unknown analysis: nope' });
  const result = await analyze({ analysis: 'velocity' }, deps);

  assert.equal(result.success, false);
  assert.equal(result.error, 'Unknown analysis: nope');
  assert.equal(result.markdown, undefined);
});

test('analyze surfaces an empty OmniFocus reply as a failure', async () => {
  const { deps } = stubExecutor(null);
  const result = await analyze({ analysis: 'velocity' }, deps);

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /no analysis data/);
});

test('analyze routes each analysis to its own renderer', async () => {
  const cases: Array<[AnalyzeParams, any, RegExp]> = [
    [{ analysis: 'health_snapshot' }, { success: true, projects: {} }, /# OmniFocus health snapshot/],
    [{ analysis: 'velocity' }, { success: true, days: 2, completed: [], created: [] }, /# Velocity/],
    [{ analysis: 'overdue_clusters' }, { success: true, totalOverdue: 0 }, /# Overdue clusters/],
    [{ analysis: 'stalled_projects' }, { success: true, projects: [] }, /# Stalled-project signals/]
  ];

  for (const [params, payload, expected] of cases) {
    const { deps } = stubExecutor(payload);
    const result = await analyze(params, deps);
    assert.equal(result.success, true, `${params.analysis} should succeed`);
    assert.match(result.markdown ?? '', expected);
  }
});

// ---------------------------------------------------------------------------
// Local-day bucketing
// ---------------------------------------------------------------------------

test('localDayKey uses local calendar fields, not the UTC date', () => {
  const lateEvening = new Date(2026, 7, 3, 23, 30);
  assert.equal(localDayKey(lateEvening), '2026-08-03');
  // The trap this guards: the same instant is already 2026-08-04 in UTC.
  assert.equal(lateEvening.toISOString().slice(0, 10), '2026-08-04');
});

test('bucketByLocalDay keeps a 23:30 local completion on its own local day', () => {
  const buckets = bucketByLocalDay([
    localIso(2026, 8, 3, 23, 30),
    localIso(2026, 8, 3, 0, 15),
    localIso(2026, 8, 4, 9, 0)
  ]);

  assert.equal(buckets.get('2026-08-03'), 2);
  assert.equal(buckets.get('2026-08-04'), 1);
});

test('bucketByLocalDay drops null and unparseable timestamps', () => {
  const buckets = bucketByLocalDay([null, undefined, '', 'not-a-date', localIso(2026, 8, 3)]);
  assert.equal(buckets.size, 1);
  assert.equal(buckets.get('2026-08-03'), 1);
});

test('median handles odd, even and empty inputs', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

// ---------------------------------------------------------------------------
// renderHealthSnapshot
// ---------------------------------------------------------------------------

const HEALTH_FIXTURE = {
  success: true,
  analysis: 'health_snapshot',
  generatedIso: localIso(2026, 8, 10, 11, 5),
  completedWindowStartIso: localIso(2026, 8, 4, 0, 0),
  inboxIncomplete: 91,
  incompleteTotal: 390,
  overdue: 115,
  dueToday: 8,
  flaggedIncomplete: 36,
  untaggedIncomplete: 308,
  noEstimateIncomplete: 385,
  completedLast7Days: 19,
  projects: { active: 37, onHold: 2, done: 5, dropped: 1, total: 45 },
  activeProjectsNoNextAction: 3
};

test('renderHealthSnapshot reports every requested count', () => {
  const md = renderHealthSnapshot(HEALTH_FIXTURE);

  assert.match(md, /\| Inbox \(incomplete\) \| 91 \|/);
  assert.match(md, /\| Incomplete tasks \(total\) \| 390 \|/);
  assert.match(md, /\| Overdue \| 115 \|/);
  assert.match(md, /\| Due today \| 8 \|/);
  assert.match(md, /\| Flagged \(incomplete\) \| 36 \|/);
  assert.match(md, /\| Untagged \(incomplete\) \| 308 \|/);
  assert.match(md, /\| No time estimate \(incomplete\) \| 385 \|/);
  assert.match(md, /\| Completed in last 7 days \| 19 \|/);
  assert.match(md, /\| Active \| 37 \|/);
  assert.match(md, /\| On hold \| 2 \|/);
  assert.match(md, /\| Done \| 5 \|/);
  assert.match(md, /\| Dropped \| 1 \|/);
  assert.match(md, /\| Active with no next action \| 3 \|/);
});

test('renderHealthSnapshot renders dates locally and offers no verdict', () => {
  const md = renderHealthSnapshot(HEALTH_FIXTURE);

  assert.doesNotMatch(md, UTC_LEAK);
  assert.match(md, /8\/4\/2026/, 'the completed-window start is rendered as a local date');
  // Evidence, not judgment.
  assert.doesNotMatch(md, /score|healthy|unhealthy|recommend|you should/i);
});

test('renderHealthSnapshot discloses the selected date and root semantics', () => {
  assert.match(renderHealthSnapshot(HEALTH_FIXTURE), /Dates: direct/);
  const effective = renderHealthSnapshot({ ...HEALTH_FIXTURE, dateMode: 'effective', includeProjectRoots: true });
  assert.match(effective, /Dates: effective/);
  assert.match(effective, /project roots included/);
});

test('renderHealthSnapshot renders an empty database as zeros, not blanks', () => {
  const md = renderHealthSnapshot({ success: true, generatedIso: localIso(2026, 8, 10), projects: {} });

  assert.match(md, /\| Incomplete tasks \(total\) \| 0 \|/);
  assert.match(md, /\| All projects \| 0 \|/);
  assert.match(md, /\| Active with no next action \| 0 \|/);
  assert.doesNotMatch(md, UTC_LEAK);
});

// ---------------------------------------------------------------------------
// renderVelocity
// ---------------------------------------------------------------------------

const VELOCITY_FIXTURE = {
  success: true,
  analysis: 'velocity',
  days: 3,
  windowStartIso: localIso(2026, 8, 3, 0, 0),
  generatedIso: localIso(2026, 8, 5, 9, 0),
  completed: [
    // 23:30 local on day 1 — the UTC-bucketing trap.
    { completedIso: localIso(2026, 8, 3, 23, 30), addedIso: localIso(2026, 8, 3, 11, 30), repeating: false },
    { completedIso: localIso(2026, 8, 5, 8, 0), addedIso: localIso(2026, 8, 3, 8, 0), repeating: false },
    { completedIso: localIso(2026, 8, 5, 8, 30), addedIso: localIso(2026, 8, 5, 8, 30), repeating: true }
  ],
  created: [
    localIso(2026, 8, 3, 9, 0),
    localIso(2026, 8, 5, 8, 30),
    localIso(2026, 8, 5, 10, 0),
    localIso(2026, 8, 5, 11, 0)
  ]
};

test('renderVelocity buckets a 23:30 local completion on its own local day', () => {
  const md = renderVelocity(VELOCITY_FIXTURE);
  const rows = md.split('\n').filter(line => /^\| \w{3} \d/.test(line));

  assert.equal(rows.length, 3, 'one row per day in the window');
  assert.match(rows[0], /8\/3\/2026 \| 1 \| 1 \|/, 'the 23:30 completion belongs to 8/3, not 8/4');
  assert.match(rows[1], /8\/4\/2026 \| 0 \| 0 \|/, 'a day with no activity still gets a row');
  assert.match(rows[2], /8\/5\/2026 \| 2 \| 3 \|/);
});

test('renderVelocity reports totals, averages and backlog growth without editorializing', () => {
  const md = renderVelocity(VELOCITY_FIXTURE);

  assert.match(md, /Completed: 3 · Created: 4/);
  assert.match(md, /Daily average completed: 1\.00/);
  // (4 - 3) / 3 = 0.33
  assert.match(md, /Backlog growth per day: 0\.33 — \(created − completed\) \/ days; negative = shrinking/);
  assert.doesNotMatch(md, /good|bad|improving|worse|you should|recommend/i);
});

test('renderVelocity labels a shrinking backlog with the exact phrasing', () => {
  const md = renderVelocity({
    ...VELOCITY_FIXTURE,
    created: [localIso(2026, 8, 3, 9, 0)]
  });

  assert.match(md, /Backlog growth per day: -0\.67 — \(created − completed\) \/ days; negative = shrinking/);
});

test('renderVelocity excludes repeating instances from the median and says so', () => {
  const md = renderVelocity(VELOCITY_FIXTURE);

  // Usable ages: 12h and 48h -> median 30h. The repeating instance is excluded.
  assert.match(md, /Median completion time: 30\.0 h \(creation → completion, across 2 of 3 completed tasks\)/);
  assert.match(md, /Excluded from the median: 1 repeating-task instance/);
});

test('renderVelocity reports an empty window as zeros and a dash median', () => {
  const md = renderVelocity({
    success: true,
    days: 2,
    windowStartIso: localIso(2026, 8, 9, 0, 0),
    generatedIso: localIso(2026, 8, 10, 9, 0),
    completed: [],
    created: []
  });

  assert.match(md, /Completed: 0 · Created: 0/);
  assert.match(md, /Daily average completed: 0\.00/);
  assert.match(md, /Backlog growth per day: 0\.00/);
  assert.match(md, /Median completion time: — \(no completed task in the window had a usable creation date\)/);
  assert.doesNotMatch(md, UTC_LEAK);
});

test('renderVelocity flags a truncated record set instead of quietly undercounting', () => {
  const md = renderVelocity({ ...VELOCITY_FIXTURE, truncated: true });
  assert.match(md, /Raw record cap reached/);
});

test('renderVelocity never leaks a UTC timestamp', () => {
  assert.doesNotMatch(renderVelocity(VELOCITY_FIXTURE), UTC_LEAK);
});

// ---------------------------------------------------------------------------
// renderOverdueClusters
// ---------------------------------------------------------------------------

function overdueFixture(projectCount: number, tagCount: number) {
  const mk = (prefix: string, index: number) => ({
    id: `${prefix}-${index}`,
    name: `${prefix} ${index}`,
    count: projectCount - index,
    oldestDueIso: localIso(2026, 7, 9 + index, 17, 0)
  });
  return {
    success: true,
    analysis: 'overdue_clusters',
    generatedIso: localIso(2026, 8, 10, 11, 0),
    totalOverdue: 115,
    untaggedOverdue: 67,
    byProject: Array.from({ length: projectCount }, (_, i) => mk('Project', i)),
    byTag: Array.from({ length: tagCount }, (_, i) => mk('Tag', i))
  };
}

test('renderOverdueClusters groups by project and by tag with oldest due dates', () => {
  const md = renderOverdueClusters(overdueFixture(3, 2), 10);

  assert.match(md, /## By project/);
  assert.match(md, /## By tag/);
  assert.match(md, /\| Project 0 \| 3 \| 7\/9\/2026 \|/);
  assert.match(md, /\| Tag 1 \| 2 \| 7\/10\/2026 \|/);
  assert.match(md, /Overdue incomplete tasks: \*\*115\*\*/);
  assert.doesNotMatch(md, UTC_LEAK);
});

test('renderOverdueClusters truncates at topN with an honest remainder line', () => {
  const md = renderOverdueClusters(overdueFixture(14, 12), 10);

  assert.ok(md.includes('| Project 9 |'), 'the tenth project is shown');
  assert.ok(!md.includes('| Project 10 |'), 'the eleventh project is not');
  // Hidden project counts: 14-10=4 groups, counts 4+3+2+1 = 10 tasks.
  assert.match(md, /\+ 4 more in other projects \(10 overdue tasks not shown\)/);
  // Hidden tag counts: 12-10=2 groups, counts 4+3 = 7 tasks.
  assert.match(md, /\+ 2 more in other tags \(7 overdue tasks not shown\)/);
});

test('renderOverdueClusters omits the remainder line when nothing is hidden', () => {
  const md = renderOverdueClusters(overdueFixture(3, 2), 10);
  assert.doesNotMatch(md, /more in other/);
});

test('renderOverdueClusters discloses untagged overdue tasks and the double-count', () => {
  const md = renderOverdueClusters(overdueFixture(3, 2), 10);
  assert.match(md, /67 overdue tasks carry no tag/);
  assert.match(md, /once per project and once per each of its own tags/);
});

test('renderOverdueClusters discloses that inherited due dates are not counted', () => {
  const md = renderOverdueClusters(overdueFixture(3, 2), 10);
  assert.match(md, /OWN due date/);
  assert.match(md, /effective due date\) is not counted/);
});

test('renderOverdueClusters reports an empty result plainly', () => {
  const md = renderOverdueClusters({ success: true, generatedIso: localIso(2026, 8, 10), totalOverdue: 0 }, 10);

  assert.match(md, /No overdue tasks\./);
  assert.doesNotMatch(md, /## By project/);
});

test('renderOverdueClusters names a grouping with no rows instead of showing an empty table', () => {
  const md = renderOverdueClusters(
    { ...overdueFixture(2, 0), untaggedOverdue: 115 },
    10
  );
  assert.match(md, /No overdue tasks carry a tag\./);
});

test('renderOverdueClusters escapes a pipe in a project name', () => {
  const md = renderOverdueClusters(
    {
      success: true,
      generatedIso: localIso(2026, 8, 10),
      totalOverdue: 1,
      untaggedOverdue: 1,
      byProject: [{ id: 'p1', name: 'Ops | Backlog', count: 1, oldestDueIso: localIso(2026, 7, 9) }],
      byTag: []
    },
    10
  );

  assert.match(md, /Ops \\\| Backlog/);
});

// ---------------------------------------------------------------------------
// renderStalledProjects
// ---------------------------------------------------------------------------

function stalledProject(index: number, overrides: Record<string, any> = {}) {
  return {
    id: `proj-${index}`,
    name: `Project ${index}`,
    folderPath: 'Work / Clients',
    status: 'Active',
    remainingTasks: 5,
    noNextAction: false,
    lastActivityIso: localIso(2026, 6, 1 + index, 9, 0),
    lastActivityStale: true,
    ...overrides
  };
}

const STALLED_FIXTURE = {
  success: true,
  analysis: 'stalled_projects',
  generatedIso: localIso(2026, 8, 10, 11, 0),
  inactiveDays: 30,
  includeOnHold: false,
  thresholdIso: localIso(2026, 7, 11, 0, 0),
  scannedProjects: 37,
  projects: [
    stalledProject(0, { noNextAction: true, lastActivityStale: false, lastActivityIso: localIso(2026, 8, 9, 9, 0) }),
    stalledProject(1, { folderPath: '', remainingTasks: 0 }),
    stalledProject(2, { lastActivityIso: null, lastActivityStale: false, noNextAction: true })
  ]
};

test('renderStalledProjects reports both signals side by side without merging them', () => {
  const md = renderStalledProjects(STALLED_FIXTURE);

  assert.match(md, /\| No next action \| Last activity \| Inactive ≥ threshold \|/);
  // Signal A only.
  assert.match(md, /\| Project 0 \| proj-0 \| Work \/ Clients \| 5 \| yes \| 8\/9\/2026 \| no \|/);
  // Signal B only, and an unknown folder renders as a dash rather than blank.
  assert.match(md, /\| Project 1 \| proj-1 \| — \| 0 \| no \| 6\/2\/2026 \| yes \|/);
  // Missing activity date renders as a dash, not "Invalid Date".
  assert.match(md, /\| Project 2 \| proj-2 \| Work \/ Clients \| 5 \| yes \| — \| no \|/);
  assert.doesNotMatch(md, /Invalid Date/);
  assert.doesNotMatch(md, UTC_LEAK);
});

test('renderStalledProjects states its scope, threshold and lack of a verdict', () => {
  const md = renderStalledProjects(STALLED_FIXTURE);

  assert.match(md, /Scope: Active projects \(37 scanned\)/);
  assert.match(md, /inactivity threshold 30 days \(last activity before 7\/11\/2026\)/);
  assert.match(md, /INDEPENDENT, not a combined verdict/);
  assert.doesNotMatch(md, /stale project|abandon|you should|recommend/i);
});

test('renderStalledProjects widens its stated scope when on-hold projects are included', () => {
  const md = renderStalledProjects({ ...STALLED_FIXTURE, includeOnHold: true });
  assert.match(md, /Scope: Active \+ on-hold projects/);
});

test('renderStalledProjects reports an empty result plainly', () => {
  const md = renderStalledProjects({
    success: true,
    generatedIso: localIso(2026, 8, 10),
    inactiveDays: DEFAULT_INACTIVE_DAYS,
    thresholdIso: localIso(2026, 7, 11),
    scannedProjects: 12,
    projects: []
  });

  assert.match(md, /No project fired either signal\./);
  assert.doesNotMatch(md, /\| Project \|/);
});

test('renderStalledProjects caps its table and says how many rows it hid', () => {
  const oversized = {
    ...STALLED_FIXTURE,
    projects: Array.from({ length: STALLED_PROJECT_ROW_CAP + 5 }, (_, i) => stalledProject(i))
  };
  const md = renderStalledProjects(oversized);

  const rows = md.split('\n').filter(line => /^\| Project \d+ \|/.test(line));
  assert.equal(rows.length, STALLED_PROJECT_ROW_CAP);
  assert.match(md, new RegExp(`\\+ 5 more projects matched but are not shown \\(cap ${STALLED_PROJECT_ROW_CAP}\\)`));
});
