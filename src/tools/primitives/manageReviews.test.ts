import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  LIST_DUE_REVIEWS_SCRIPT,
  MARK_REVIEWED_SCRIPT,
  SET_REVIEW_SCHEDULE_SCRIPT,
  REVIEW_UNIT_PLURAL,
  MAX_REVIEW_BATCH,
  buildMarkReviewedSpecs,
  validateManageReviewsParams
} from './manageReviews.js';

const here = dirname(fileURLToPath(import.meta.url));
const primitiveSource = readFileSync(join(here, 'manageReviews.ts'), 'utf8');
const definitionSource = readFileSync(join(here, '..', 'definitions', 'manageReviews.ts'), 'utf8');

// --- Script syntax coverage (unit tests that mock runOmniJs cannot catch a
// const collision or a broken escaping round-trip) -------------------------

const SCRIPTS: Array<[string, string]> = [
  ['manage_reviews:list_due', LIST_DUE_REVIEWS_SCRIPT],
  ['manage_reviews:mark_reviewed', MARK_REVIEWED_SCRIPT],
  ['manage_reviews:set_schedule', SET_REVIEW_SCHEDULE_SCRIPT]
];

for (const [name, script] of SCRIPTS) {
  test(`${name} script is syntactically valid JavaScript`, () => {
    assert.doesNotThrow(() => new Function('args', script), `${name} script failed to parse`);
  });

  test(`${name} script survives the runOmniJs escaping round-trip`, () => {
    assert.ok(!script.includes('`'), `${name} script contains a backtick`);
    assert.ok(!script.includes('$'), `${name} script contains a dollar sign`);
    assert.ok(!script.includes('\\'), `${name} script contains a backslash`);
  });

  test(`${name} script reads user data only from the args object`, () => {
    assert.match(script, /\bargs\b/, `${name} script never reads args`);
  });
}

// --- Verified OmniJS API facts these scripts depend on ---------------------

test('review scripts never call a markReviewed API (it does not exist)', () => {
  for (const [name, script] of SCRIPTS) {
    assert.doesNotMatch(script, /markReviewed/, `${name} calls a nonexistent markReviewed API`);
  }
  assert.match(MARK_REVIEWED_SCRIPT, /p\.lastReviewDate = now/, 'mark_reviewed does not assign lastReviewDate');
  assert.match(MARK_REVIEWED_SCRIPT, /p\.nextReviewDate = computedNext/, 'mark_reviewed does not assign nextReviewDate');
});

test('reviewInterval is read field-by-field, never via JSON.stringify', () => {
  // JSON.stringify on an OmniJS reviewInterval yields {} — the fields have to
  // be read explicitly.
  assert.match(primitiveSource, /var unit = \(ri\.unit === undefined/, 'reviewInterval.unit is not read explicitly');
  assert.match(primitiveSource, /var steps = \(typeof ri\.steps === 'number'\)/, 'reviewInterval.steps is not read explicitly');
  assert.doesNotMatch(primitiveSource, /JSON\.stringify\(ri\)/, 'reviewInterval must not be serialized wholesale');
});

test('project status is read from .status, not the root task status', () => {
  // Project.taskStatus exists but reports the ROOT TASK status (Blocked/Next),
  // so the shared __statusLabel is wrong for review filtering.
  assert.match(primitiveSource, /function __projectStatusLabel/, 'missing project-specific status label helper');
  assert.match(primitiveSource, /var s = String\(p\.status\)/, 'project status is not read from .status');
  assert.doesNotMatch(LIST_DUE_REVIEWS_SCRIPT, /__statusLabel\(/, 'list_due uses the task-status helper for projects');
});

test('month and year intervals use calendar arithmetic, not milliseconds', () => {
  assert.match(primitiveSource, /function __addMonths/, 'missing calendar month helper');
  assert.match(primitiveSource, /d\.setMonth\(d\.getMonth\(\) \+ n\)/, 'months are not added via setMonth');
  assert.match(primitiveSource, /__addMonths\(d, steps \* 12\)/, 'years are not added as 12 months');
  assert.doesNotMatch(primitiveSource, /30 \* 24 \* 60 \* 60 \* 1000/, 'months must not be approximated in milliseconds');
});

test('list_due runs read-only and mark/set do not', () => {
  assert.match(primitiveSource, /LIST_DUE_REVIEWS_SCRIPT,[\s\S]*?\{ readOnly: true \}/, 'list_due does not pass readOnly to the executor');
  assert.doesNotMatch(primitiveSource, /MARK_REVIEWED_SCRIPT,[\s\S]{0,120}readOnly/, 'mark_reviewed must not be marked read-only');
  assert.doesNotMatch(primitiveSource, /SET_REVIEW_SCHEDULE_SCRIPT,[\s\S]{0,200}readOnly/, 'set_schedule must not be marked read-only');
});

test('set_schedule verifies the assignment stuck instead of assuming it', () => {
  // OmniFocus rejects a plain {unit, steps} object (verified live) — the write
  // must use the copy idiom: read the interval, mutate the copy, assign back.
  assert.match(SET_REVIEW_SCHEDULE_SCRIPT, /writeInterval\.unit = args\.unit/, 'set_schedule does not set unit on the interval copy');
  assert.match(SET_REVIEW_SCHEDULE_SCRIPT, /writeInterval\.steps = args\.steps/, 'set_schedule does not set steps on the interval copy');
  assert.match(SET_REVIEW_SCHEDULE_SCRIPT, /project\.reviewInterval = writeInterval/, 'set_schedule does not assign the interval back');
  assert.doesNotMatch(SET_REVIEW_SCHEDULE_SCRIPT, /project\.reviewInterval = \{/, 'plain-object assignment throws in OmniFocus — must not come back');
  assert.match(SET_REVIEW_SCHEDULE_SCRIPT, /const actual = __readInterval\(project\)/, 'set_schedule does not read the interval back');
  assert.match(SET_REVIEW_SCHEDULE_SCRIPT, /reviewInterval assignment did not stick/, 'set_schedule does not report a failed write');
});

test('mark_reviewed and set_schedule resolve through the shared lookup helpers', () => {
  assert.match(MARK_REVIEWED_SCRIPT, /__resolveByIdOrName\(flattenedProjects, spec\.id \|\| null, spec\.name \|\| null, 'Project'\)/);
  assert.match(SET_REVIEW_SCHEDULE_SCRIPT, /__resolveByIdOrName\(flattenedProjects, args\.projectId \|\| null, args\.projectName \|\| null, 'Project'\)/);
});

test('mark_reviewed verifies both dates in the same script', () => {
  assert.match(MARK_REVIEWED_SCRIPT, /const lastOk = /, 'lastReviewDate is not verified');
  assert.match(MARK_REVIEWED_SCRIPT, /const nextOk = /, 'nextReviewDate is not verified');
  assert.match(MARK_REVIEWED_SCRIPT, /verified: verified/, 'result rows do not carry a verified flag');
  assert.match(MARK_REVIEWED_SCRIPT, /previousNextReviewDate: previousNext/, 'result rows do not carry the previous next-review date');
});

test('a project with no review interval is still stamped, with an explanation', () => {
  assert.match(MARK_REVIEWED_SCRIPT, /Project has no review interval/, 'missing no-interval explanation');
  assert.match(MARK_REVIEWED_SCRIPT, /nextComputed: computedNext !== null/, 'nextComputed flag missing');
});

// --- Node-side behaviour ---------------------------------------------------

test('REVIEW_UNIT_PLURAL maps singular caller units to OmniFocus plurals', () => {
  assert.deepEqual(REVIEW_UNIT_PLURAL, { day: 'days', week: 'weeks', month: 'months', year: 'years' });
});

test('buildMarkReviewedSpecs handles single and batch shapes', () => {
  assert.deepEqual(buildMarkReviewedSpecs({ operation: 'mark_reviewed', projectId: 'p1' }), [{ id: 'p1', name: undefined }]);
  assert.deepEqual(buildMarkReviewedSpecs({ operation: 'mark_reviewed', projectName: 'Taxes' }), [{ id: undefined, name: 'Taxes' }]);
  assert.deepEqual(buildMarkReviewedSpecs({ operation: 'mark_reviewed', projectIds: ['a', 'b'] }), [{ id: 'a' }, { id: 'b' }]);
});

test('list_due rejects project arguments', () => {
  const v = validateManageReviewsParams({ operation: 'list_due', projectId: 'p1' });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /list_due does not take a project/);
});

test('list_due rejects schedule arguments', () => {
  const v = validateManageReviewsParams({ operation: 'list_due', unit: 'week', steps: 1 });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /only supported when operation is "set_schedule"/);
});

test('list_due accepts all and includeOnHold', () => {
  assert.equal(validateManageReviewsParams({ operation: 'list_due' }).valid, true);
  assert.equal(validateManageReviewsParams({ operation: 'list_due', all: true, includeOnHold: false }).valid, true);
});

// Run the actual listing script with the effective root-task status supplied
// by OmniFocus, which can differ from a project's explicit status.
const REVIEW_NOW = new Date('2026-10-02T12:00:00Z');
const REVIEW_PAST = new Date('2026-09-01T12:00:00Z');
const REVIEW_FUTURE = new Date('2026-11-01T12:00:00Z');

function reviewProject(id: string, overrides: Record<string, any> = {}): any {
  return {
    id: { primaryKey: id },
    name: id,
    status: '[object Project.Status: Active]',
    task: { taskStatus: 'Blocked' },
    parentFolder: null,
    reviewInterval: { unit: 'weeks', steps: 1 },
    nextReviewDate: REVIEW_PAST,
    lastReviewDate: REVIEW_PAST,
    ...overrides
  };
}

function runListDue(projects: any[], args: Record<string, any> = {}): any {
  const Clock = class extends Date {
    constructor(value: string | number = REVIEW_NOW.getTime()) { super(value); }
  };
  const fn = new Function('args', 'flattenedProjects', 'Task', 'Date', LIST_DUE_REVIEWS_SCRIPT);
  return JSON.parse(fn(args, projects, { Status: { Dropped: 'Dropped' } }, Clock));
}

for (const status of ['Active', 'OnHold']) {
  for (const depth of [1, 3]) {
    for (const args of [{}, { all: true }, { all: true, includeOnHold: false }]) {
      test(`list_due excludes ${status} projects under dropped ancestry (depth ${depth}, ${JSON.stringify(args)})`, () => {
        let folder: any = { name: 'Historical', parent: null, status: 'Dropped' };
        for (let i = 1; i < depth; i++) {
          folder = { name: `Nested ${i}`, parent: folder, status: 'Active' };
        }
        const hidden = reviewProject('historical', {
          status: `[object Project.Status: ${status}]`,
          parentFolder: folder,
          task: { taskStatus: 'Dropped' }
        });
        const result = runListDue([hidden, reviewProject('current')], args);
        assert.equal(result.success, true);
        assert.deepEqual(result.projects.map((p: any) => p.id), ['current']);
        assert.equal(result.scanned, 2, 'scanned remains the number of projects inspected');
      });
    }
  }
}

test('list_due retains available, empty, blocked and deferred active projects', () => {
  const projects = ['Available', 'Next', 'Blocked', 'DueSoon', 'Overdue'].map(taskStatus =>
    reviewProject(taskStatus, { task: { taskStatus } })
  );
  projects.push(reviewProject('deferred', {
    task: { taskStatus: 'Blocked', effectiveDeferDate: REVIEW_FUTURE },
    parentFolder: { name: 'Current', parent: null, status: 'Active' }
  }));
  assert.deepEqual(runListDue(projects).projects.map((p: any) => p.id), projects.map(p => p.id.primaryKey));
});

test('list_due includes on-hold projects by default and excludes them only when requested', () => {
  const projects = [reviewProject('active'), reviewProject('held', { status: '[object Project.Status: OnHold]' })];
  assert.deepEqual(runListDue(projects).projects.map((p: any) => p.id), ['active', 'held']);
  assert.deepEqual(runListDue(projects, { includeOnHold: false }).projects.map((p: any) => p.id), ['active']);
});

test('list_due never includes explicitly finished projects, even with all enabled', () => {
  const projects = ['Done', 'Completed', 'Dropped'].map(status => reviewProject(status, {
    status: `[object Project.Status: ${status}]`,
    task: { taskStatus: status === 'Dropped' ? 'Dropped' : 'Completed' }
  }));
  assert.deepEqual(runListDue(projects).projects, []);
  assert.deepEqual(runListDue(projects, { all: true }).projects, []);
});

test('list_due preserves due-date boundaries and all-scheduled behavior', () => {
  const projects = [
    reviewProject('past'),
    reviewProject('now', { nextReviewDate: REVIEW_NOW }),
    reviewProject('future', { nextReviewDate: REVIEW_FUTURE }),
    reviewProject('interval-only', { nextReviewDate: null, lastReviewDate: null }),
    reviewProject('unscheduled', { reviewInterval: null, nextReviewDate: null, lastReviewDate: null })
  ];
  assert.deepEqual(runListDue(projects).projects.map((p: any) => p.id), ['past', 'now']);
  const all = runListDue(projects, { all: true });
  assert.deepEqual(all.projects.map((p: any) => [p.id, p.dueForReview]), [
    ['past', true], ['now', true], ['future', false], ['interval-only', false]
  ]);
});

test('list_due returns an empty result for an empty database', () => {
  assert.deepEqual(runListDue([]), { success: true, projects: [], scanned: 0 });
});

test('mark_reviewed rejects mixing the single and batch forms', () => {
  const v = validateManageReviewsParams({ operation: 'mark_reviewed', projectId: 'p1', projectIds: ['p2'] });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /Cannot combine projectIds/);
});

test('mark_reviewed requires a project', () => {
  const v = validateManageReviewsParams({ operation: 'mark_reviewed' });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /needs a project/);
});

test('mark_reviewed rejects both projectId and projectName', () => {
  const v = validateManageReviewsParams({ operation: 'mark_reviewed', projectId: 'p1', projectName: 'Taxes' });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /Cannot specify both projectId and projectName/);
});

test('mark_reviewed caps the batch size', () => {
  const ids = Array.from({ length: MAX_REVIEW_BATCH + 1 }, (_, i) => `p${i}`);
  const v = validateManageReviewsParams({ operation: 'mark_reviewed', projectIds: ids });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /at most 100 ids/);
});

test('mark_reviewed rejects list_due-only arguments', () => {
  const v = validateManageReviewsParams({ operation: 'mark_reviewed', projectId: 'p1', all: true });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /only supported when operation is "list_due"/);
});

test('set_schedule requires a single project, a unit, and steps', () => {
  assert.match(validateManageReviewsParams({ operation: 'set_schedule', unit: 'week', steps: 1 }).error || '', /needs a project/);
  assert.match(validateManageReviewsParams({ operation: 'set_schedule', projectId: 'p1', steps: 1 }).error || '', /requires unit/);
  assert.match(validateManageReviewsParams({ operation: 'set_schedule', projectId: 'p1', unit: 'week' }).error || '', /requires steps/);
  assert.match(validateManageReviewsParams({ operation: 'set_schedule', projectId: 'p1', unit: 'week', steps: 0 }).error || '', /whole number/);
  assert.match(validateManageReviewsParams({ operation: 'set_schedule', projectIds: ['p1'], unit: 'week', steps: 1 }).error || '', /not projectIds/);
  assert.equal(validateManageReviewsParams({ operation: 'set_schedule', projectId: 'p1', unit: 'month', steps: 3 }).valid, true);
});

// --- Output rendering ------------------------------------------------------

test('review output renders dates locally, never as a raw UTC string', () => {
  assert.match(definitionSource, /toLocaleDateString\(\)/, 'definition does not render dates locally');
  assert.doesNotMatch(definitionSource, /toISOString\(\)/, 'definition leaks a UTC ISO string to the caller');
});

// ---------------------------------------------------------------------------
// mark_reviewed behavior harness.
//
// The script only touches OmniJS globals, so `new Function` plus a fake
// project model runs the REAL verification logic. This is what catches a
// verification window loose enough to accept a write that never happened.
// ---------------------------------------------------------------------------

function runMarkReviewed(projects: any[], specs: any[]): any {
  const fn = new Function('args', 'flattenedProjects', MARK_REVIEWED_SCRIPT);
  return JSON.parse(fn({ projects: specs }, projects));
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function fakeProject(options: {
  lastReviewDate?: Date | null;
  nextReviewDate?: Date | null;
  frozen?: boolean;
  truncateToMidnight?: boolean;
} = {}): any {
  let last = options.lastReviewDate ?? null;
  let next = options.nextReviewDate ?? null;

  const project: any = {
    id: { primaryKey: 'p1' },
    name: 'Quarterly goals',
    status: '[object Project.Status: Active]',
    reviewInterval: { unit: 'weeks', steps: 1 }
  };

  Object.defineProperty(project, 'lastReviewDate', {
    configurable: true,
    get: () => last,
    set: (value: Date) => {
      if (options.frozen) return; // the write silently does not take
      if (options.truncateToMidnight) {
        const d = new Date(value.getTime());
        d.setHours(0, 0, 0, 0);
        last = d;
        return;
      }
      last = value;
    }
  });
  Object.defineProperty(project, 'nextReviewDate', {
    configurable: true,
    get: () => next,
    set: (value: Date) => {
      if (options.frozen) return;
      next = value;
    }
  });

  return project;
}

test('mark_reviewed verifies a write that actually landed', () => {
  const project = fakeProject({ lastReviewDate: daysAgo(9), nextReviewDate: daysAgo(2) });
  const out = runMarkReviewed([project], [{ id: 'p1' }]);

  assert.equal(out.results[0].verified, true, JSON.stringify(out.results[0]));
  assert.equal(out.results[0].success, true);
  assert.equal(out.results[0].error, undefined);
});

test('mark_reviewed rejects a no-op write on a project reviewed yesterday', () => {
  // The old plus-or-minus-24h window accepted this: the project still carries
  // yesterday's lastReviewDate, the write silently did nothing, and the tool
  // reported a successful review.
  const project = fakeProject({ lastReviewDate: daysAgo(1), nextReviewDate: daysAgo(1), frozen: true });
  const out = runMarkReviewed([project], [{ id: 'p1' }]);

  assert.equal(out.results[0].verified, false, 'a stale lastReviewDate passed verification');
  assert.equal(out.results[0].success, false);
  assert.match(out.results[0].error, /did not verify/);
});

test('mark_reviewed rejects a next-review date that landed on the wrong day', () => {
  const project = fakeProject({ lastReviewDate: daysAgo(9), nextReviewDate: daysAgo(2) });
  // lastReviewDate writes land, nextReviewDate silently keeps the old value.
  const stuckNext = daysAgo(2);
  Object.defineProperty(project, 'nextReviewDate', {
    configurable: true,
    get: () => stuckNext,
    set: () => { /* ignored */ }
  });

  const out = runMarkReviewed([project], [{ id: 'p1' }]);

  assert.equal(out.results[0].verified, false);
  assert.match(out.results[0].error, /nextReviewDate read back as/);
});

test('mark_reviewed still verifies when the build truncates the stamp to local midnight', () => {
  // OmniFocus normalizes review dates to local midnight on some builds. A
  // "within a few minutes of now" check alone would call every correct write a
  // failure, so a midnight stamp from TODAY is accepted (and one from
  // yesterday is not).
  const fresh = fakeProject({ lastReviewDate: daysAgo(9), truncateToMidnight: true });
  assert.equal(runMarkReviewed([fresh], [{ id: 'p1' }]).results[0].verified, true);

  const stale = fakeProject({ lastReviewDate: daysAgo(1), frozen: true });
  assert.equal(runMarkReviewed([stale], [{ id: 'p1' }]).results[0].verified, false);
});

test('a mark_reviewed verification failure never reports a UTC timestamp', () => {
  const project = fakeProject({ lastReviewDate: daysAgo(1), nextReviewDate: daysAgo(1), frozen: true });
  const out = runMarkReviewed([project], [{ id: 'p1' }]);

  assert.doesNotMatch(
    String(out.results[0].error),
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/,
    'the failure message leaked a UTC ISO timestamp'
  );
});
