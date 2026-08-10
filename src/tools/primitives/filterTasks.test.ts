import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyClientSideFilters, CONDITION_KEYS, validateClauses } from './filterTasks.js';
import { injectScriptParameters } from '../../utils/scriptExecution.js';
import { ConditionSchema, schema as filterTasksSchema } from '../definitions/filterTasks.js';

const here = dirname(fileURLToPath(import.meta.url));

function readSource(...segments: string[]): string {
  return readFileSync(join(here, ...segments), 'utf8');
}

function readScript(): string {
  return readSource('..', '..', 'utils', 'omnifocusScripts', 'filterTasks.js');
}

function isoWithOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

test('applyClientSideFilters applies exact tag filter', () => {
  const tasks = [
    { id: '1', name: 'watch video', tags: [{ name: 'watching' }] },
    { id: '2', name: 'read article', tags: [{ name: 'reading' }] },
  ];

  const filtered = applyClientSideFilters(tasks as any[], {
    tagFilter: 'watching',
    exactTagMatch: true,
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, '1');
});

test('applyClientSideFilters applies deferToday without including yesterday', () => {
  const tasks = [
    { id: 'today', name: 'today task', deferDate: isoWithOffset(0), tags: [] },
    { id: 'yesterday', name: 'yesterday task', deferDate: isoWithOffset(-1), tags: [] },
  ];

  const filtered = applyClientSideFilters(tasks as any[], {
    deferToday: true,
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'today');
});

test('applyClientSideFilters applies plannedToday without including yesterday', () => {
  const tasks = [
    { id: 'today', name: 'today task', plannedDate: isoWithOffset(0), tags: [] },
    { id: 'yesterday', name: 'yesterday task', plannedDate: isoWithOffset(-1), tags: [] },
  ];

  const filtered = applyClientSideFilters(tasks as any[], {
    plannedToday: true,
  } as any);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'today');
});

test('applyClientSideFilters applies dueToday without including yesterday or tomorrow', () => {
  const tasks = [
    { id: 'yesterday', name: 'yesterday task', dueDate: isoWithOffset(-1), tags: [] },
    { id: 'today', name: 'today task', dueDate: isoWithOffset(0), tags: [] },
    { id: 'tomorrow', name: 'tomorrow task', dueDate: isoWithOffset(1), tags: [] },
    { id: 'no-due', name: 'no due date', tags: [] },
  ];

  const filtered = applyClientSideFilters(tasks as any[], {
    dueToday: true,
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'today');
});

test('applyClientSideFilters applies overdue filter', () => {
  const tasks = [
    { id: 'past', name: 'overdue task', dueDate: isoWithOffset(-3), tags: [] },
    { id: 'future', name: 'future task', dueDate: isoWithOffset(5), tags: [] },
  ];

  const filtered = applyClientSideFilters(tasks as any[], {
    overdue: true,
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'past');
});

test('applyClientSideFilters applies dueBefore and dueAfter window', () => {
  const tasks = [
    { id: 'early', name: 'early task', dueDate: '2026-02-10T09:00:00.000Z', tags: [] },
    { id: 'in-window', name: 'window task', dueDate: '2026-02-15T09:00:00.000Z', tags: [] },
    { id: 'late', name: 'late task', dueDate: '2026-02-22T09:00:00.000Z', tags: [] },
  ];

  const filtered = applyClientSideFilters(tasks as any[], {
    dueAfter: '2026-02-12',
    dueBefore: '2026-02-20',
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'in-window');
});

test('applyClientSideFilters applies plannedBefore and plannedAfter window', () => {
  const tasks = [
    { id: 'early', name: 'early task', plannedDate: '2026-02-10T09:00:00.000Z', tags: [] },
    { id: 'in-window', name: 'window task', plannedDate: '2026-02-15T09:00:00.000Z', tags: [] },
    { id: 'late', name: 'late task', plannedDate: '2026-02-22T09:00:00.000Z', tags: [] },
  ];

  const filtered = applyClientSideFilters(tasks as any[], {
    plannedAfter: '2026-02-12',
    plannedBefore: '2026-02-20',
  } as any);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'in-window');
});

test('applyClientSideFilters reads bare dates as local midnight, not UTC midnight', () => {
  // A task planned at 6pm local on the 14th must fall outside "planned before
  // the 14th". Parsing "2026-02-14" as UTC midnight would put the boundary at
  // 6pm local on the 13th west of UTC and let the task through.
  const localEvening = new Date(2026, 1, 14, 18, 0, 0);
  const tasks = [
    { id: 'evening-of-14th', name: 'evening task', plannedDate: localEvening.toISOString(), tags: [] },
  ];

  const filtered = applyClientSideFilters(tasks as any[], {
    plannedBefore: '2026-02-14',
  } as any);

  assert.equal(filtered.length, 0);
});

// The OmniJS script needs the OmniFocus runtime, so these are source-pattern
// smoke checks rather than executions. End-to-end verification needs a rebuild
// plus an MCP server restart.

test('filterTasks.js implements a completedThisWeek range (most recent Monday)', () => {
  const src = readScript();
  assert.match(src, /completedWeekStart/, 'script missing completedThisWeek boundary');
  assert.match(src, /\(todayStart\.getDay\(\) \+ 6\) % 7/, 'script not anchoring the completion week to Monday');
  assert.match(
    src,
    /filters\.completedThisWeek && !\(completionDate && completionDate >= completedWeekStart\)/,
    'script selects completedThisWeek but never applies the range'
  );
});

test('filterTasks.js implements a completedThisMonth range (1st of the month)', () => {
  const src = readScript();
  assert.match(src, /completedMonthStart = startOfMonth\(now\)/, 'script missing completedThisMonth boundary');
  assert.match(
    src,
    /filters\.completedThisMonth && !\(completionDate && completionDate >= completedMonthStart\)/,
    'script selects completedThisMonth but never applies the range'
  );
});

test('filterTasks.js sorts names with localeCompare, not raw comparison', () => {
  const src = readScript();
  assert.match(src, /localeCompare/, 'script name sort is not using localeCompare');
  assert.doesNotMatch(src, /if \(valueA < valueB\) return filters\.sortOrder/, 'script still uses case-sensitive raw name comparison');
});

test('filterTasks.js applies every date and tag filter before it truncates', () => {
  const src = readScript();

  for (const key of [
    'dueToday', 'dueThisWeek', 'dueThisMonth', 'overdue',
    'deferToday', 'deferThisWeek', 'deferAvailable',
    'plannedToday', 'plannedThisWeek', 'plannedThisMonth',
  ]) {
    assert.match(src, new RegExp(`filters\\.${key}`), `script does not apply ${key} in-script`);
  }
  for (const key of ['dueBefore', 'dueAfter', 'deferBefore', 'deferAfter', 'plannedBefore', 'plannedAfter']) {
    assert.match(src, new RegExp(`argDates\\.${key}`), `script does not apply ${key} in-script`);
  }
  assert.match(src, /matchesTags\(task\)/, 'script does not apply the tag filter in-script');

  // The page slice (offset + limit) must come after the filter pass and the sort.
  const filterIndex = src.indexOf('const matchedCount = filteredTasks.length;');
  const sortIndex = src.indexOf('filteredTasks.sort(');
  const truncateIndex = src.indexOf('filteredTasks.slice(pageStart, pageEnd)');
  assert.ok(filterIndex > -1 && sortIndex > -1 && truncateIndex > -1, 'script structure changed unexpectedly');
  assert.ok(filterIndex < sortIndex, 'script sorts before it finishes filtering');
  assert.ok(sortIndex < truncateIndex, 'script truncates before it sorts');
});

test('filterTasks.js reports the cap and the filters it applied in metadata', () => {
  const src = readScript();
  assert.match(src, /matchedCount: matchedCount/, 'script does not report pre-truncation match count');
  assert.match(src, /truncated: truncated/, 'script does not report whether results were capped');
  assert.match(src, /limitApplied: limitApplied/, 'script does not report the cap it applied');
  assert.match(src, /appliedFilters: appliedFilters/, 'script does not report which filters it applied');
});

test('filterTasks.ts parses dates locally and normalizes dates sent to the script', () => {
  const src = readSource('filterTasks.ts');
  assert.match(src, /import \{ parseLocalDate, toLocalDateTimeString \}/, 'filterTasks.ts not importing local date helpers');
  assert.match(src, /return parseLocalDate\(value\)/, 'parseDate is not using parseLocalDate');
  assert.doesNotMatch(src, /const parsed = new Date\(value\);/, 'filterTasks.ts still parses option dates with new Date()');
  assert.match(src, /normalizeDateOptions\(options\)/, 'date options are not normalized before injection');
});

test('filterTasks.ts no longer over-fetches to compensate for late filtering', () => {
  const src = readSource('filterTasks.ts');
  assert.doesNotMatch(src, /Math\.max\(limit \* 20, 1000\)/, 'filterTasks.ts still inflates the source limit');
  assert.match(src, /const sourceLimit = limit;/, 'filterTasks.ts should request exactly `limit` rows');
  assert.match(src, /Results capped at/, 'filterTasks.ts does not surface the cap to the user');
});

test('filterTasks.ts drops the dead custom-perspective options', () => {
  const src = readSource('filterTasks.ts');
  assert.doesNotMatch(src, /customPerspectiveName/, 'dead customPerspectiveName option still present');
  assert.doesNotMatch(src, /customPerspectiveId/, 'dead customPerspectiveId option still present');
  assert.doesNotMatch(src, /'inbox' \| 'flagged' \| 'all' \| 'custom'/, "perspective still advertises unsupported 'custom'");
});

test('getTaskCounts counts all actionable statuses and uses Task.Status.DueSoon', () => {
  const src = readSource('getTaskCounts.ts');
  assert.match(src, /Task\.Status\.Next/, 'available count does not include Next');
  assert.match(src, /Task\.Status\.DueSoon/, 'available count does not include DueSoon');
  assert.match(src, /Task\.Status\.Overdue/, 'available count does not include Overdue');
  assert.match(src, /t\.taskStatus === Task\.Status\.DueSoon\) dueSoon\+\+/, 'dueSoon is not derived from Task.Status.DueSoon');
  assert.doesNotMatch(src, /threeDays/, 'getTaskCounts still uses a hardcoded 3-day due-soon window');
});

// ---------------------------------------------------------------------------
// v0.5.0 additions (items 13-18)
// ---------------------------------------------------------------------------

// Pull a `const NAME = [ ... ]` literal out of the OmniJS source so the
// script's own vocabulary — not a copy of it — is what gets compared.
function scriptStringArray(src: string, name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`).exec(src);
  assert.ok(match, `filterTasks.js is missing the ${name} list`);
  return match![1]
    .split(',')
    .map(entry => entry.trim().replace(/^"|"$/g, ''))
    .filter(entry => entry.length > 0);
}

function scriptConditionKeys(src: string): string[] {
  return scriptStringArray(src, 'CONDITION_KEYS').concat(scriptStringArray(src, 'CONDITION_DATE_KEYS'));
}

test('filterTasks.js still parses after parameter injection (no reserved const collisions)', () => {
  // executeOmniFocusScript declares injectedArgs/limit/format/... at the top of
  // the IIFE. A same-named top-level const in the script would be a SyntaxError
  // that only ever surfaces against the live database.
  const injected = injectScriptParameters(readScript(), {
    limit: 5,
    offset: 10,
    format: 'detailed',
    tagName: 'x',
    exactMatch: false,
    perspectiveName: 'p',
    perspectiveId: 'i',
    hideCompleted: true,
    includeBuiltIn: false,
    includeSidebar: true
  });
  assert.doesNotThrow(() => new Function(injected), 'injected filterTasks.js failed to parse');
});

test('filterTasks.js is syntactically valid JavaScript on its own', () => {
  assert.doesNotThrow(() => new Function(readScript()), 'filterTasks.js failed to parse');
});

test('the clause vocabulary is identical in the script, the primitive and the zod schema', () => {
  const fromScript = scriptConditionKeys(readScript()).sort();
  const fromPrimitive = [...CONDITION_KEYS].sort();
  const fromSchema = Object.keys(ConditionSchema.shape).sort();

  // A key the script cannot evaluate would be silently ignored, i.e. a wider
  // result set that looks exactly like a correctly filtered one.
  assert.deepEqual(fromPrimitive, fromScript, 'primitive and script clause keys drifted');
  assert.deepEqual(fromSchema, fromScript, 'zod condition schema and script clause keys drifted');
});

test('filterTasks.js evaluates and/or/not clauses in-script', () => {
  const src = readScript();
  assert.match(src, /andConditions\[i\]\(task\)/, 'AND clause is not evaluated in-script');
  assert.match(src, /orConditions\[i\]\(task\)/, 'OR clause is not evaluated in-script');
  assert.match(src, /notCondition\(task\)/, 'NOT clause is not evaluated in-script');
  assert.match(src, /Unsupported condition key\(s\) in/, 'script does not reject unevaluable clause keys');
});

test('filterTasks.js builds nameMatches with the RegExp constructor, never a literal', () => {
  const src = readScript();
  assert.match(src, /new RegExp\(String\(pattern\), 'i'\)/, 'nameMatches regex is not built via the constructor');
  // A regex literal carrying an interpolated value would look like /.../ around
  // a variable name or template hole.
  assert.doesNotMatch(src, /new RegExp\(['"][^'"]*\+/, 'regex source is being concatenated from user input');
  assert.doesNotMatch(src, /\/\s*\+\s*(filters|args|condition)\./, 'user value spliced into a regex literal');
  assert.match(src, /Invalid regular expression for/, 'script does not report an invalid pattern');
});

test('filterTasks.js applies every new flat filter in-script', () => {
  const src = readScript();
  for (const key of ['addedBefore', 'addedAfter', 'modifiedBefore', 'modifiedAfter', 'droppedBefore', 'droppedAfter']) {
    assert.match(src, new RegExp(`argDates\\.${key}`), `script does not apply ${key} in-script`);
  }
  assert.match(src, /taskDate\(task, 'added'\)/, 'script does not read task.added');
  assert.match(src, /taskDate\(task, 'modified'\)/, 'script does not read task.modified');
  assert.match(src, /taskDate\(task, 'dropDate'\)/, 'script does not read task.dropDate');
  assert.match(src, /task\.repetitionRule/, 'isRepeating does not read repetitionRule');
  assert.match(src, /filters\.hasNote !== null && hasNoteValue\(task\) !== filters\.hasNote/, 'hasNote is not applied');
  assert.match(src, /estimateFilter && !matchesEstimate\(task\)/, 'estimatedMinutes is not applied');
  assert.match(src, /nameContainsNeedle !== null/, 'nameContains is not applied');
  assert.match(src, /filters\.completedYesterday/, 'completedYesterday is not applied');
});

test('filterTasks.js resolves folder scope through parentFolder and the parent chain', () => {
  const src = readScript();
  assert.match(src, /project\.parentFolder/, 'folder scope does not start at Project.parentFolder');
  assert.match(src, /folder = folder\.parent/, 'folder scope does not walk up Folder.parent');
  assert.match(src, /if \(!project\) return false;/, 'inbox tasks are not excluded from folder scope');
  assert.match(src, /Folder\.byIdentifier\(filters\.folderId\)/, 'folderId does not use byIdentifier');
  assert.match(src, /Ambiguous folder name/, 'ambiguous folder names are not rejected');
});

test('filterTasks.js short-circuits countOnly before the sort and before serialization', () => {
  const src = readScript();
  const countIndex = src.indexOf('if (filters.countOnly) {');
  const sortIndex = src.indexOf('filteredTasks.sort(');
  const serializeIndex = src.indexOf('exportData.tasks.push(taskData)');
  assert.ok(countIndex > -1, 'script has no countOnly short-circuit');
  assert.ok(countIndex < sortIndex, 'countOnly still pays for the sort');
  assert.ok(countIndex < serializeIndex, 'countOnly still pays for per-task serialization');
  assert.match(src, /count: matchedCount/, 'countOnly does not return the match count');
});

test('filterTasks.js pages with offset after the sort and reports the pre-slice total', () => {
  const src = readScript();
  assert.match(src, /const pageStart = filters\.offset;/, 'offset is not applied as the page start');
  assert.match(src, /const pageEnd = limitApplied \? pageStart \+ limitApplied : matchedCount;/, 'limit is not applied relative to the offset');
  assert.match(src, /offsetApplied: pageStart/, 'script does not report the offset it applied');
  assert.match(src, /matchedCount: matchedCount/, 'script does not report the pre-slice match count');

  const sortIndex = src.indexOf('filteredTasks.sort(');
  const pageIndex = src.indexOf('const pageStart = filters.offset;');
  assert.ok(sortIndex < pageIndex, 'script pages before it sorts, so pages would not be stable');
});

test('filterTasks.js widens the candidate set for dropped/completed clause predicates', () => {
  const src = readScript();
  assert.match(src, /clauseWidensCandidateSet/, 'clauses that ask about completed/dropped tasks cannot see them');
  assert.match(src, /const wantsDroppedTasks = Boolean\(argDates\.droppedBefore \|\| argDates\.droppedAfter\)/, 'droppedBefore/After does not widen the candidate set');
});

test('filterTasks.ts marks its script read-only for the executor', () => {
  const src = readSource('filterTasks.ts');
  assert.match(src, /\{ readOnly: true \}/, 'filterTasks does not classify its script as read-only');
});

test('validateClauses rejects a condition key the script cannot evaluate', () => {
  assert.throws(
    () => validateClauses({ and: [{ bogusPredicate: true } as any] }),
    /Unsupported condition key\(s\) in and\[0\]: bogusPredicate/
  );
  assert.throws(
    () => validateClauses({ or: [{ flagged: true }, { nope: 1 } as any] }),
    /Unsupported condition key\(s\) in or\[1\]: nope/
  );
  assert.throws(
    () => validateClauses({ not: { alsoBogus: 'x' } as any }),
    /Unsupported condition key\(s\) in not: alsoBogus/
  );
});

test('validateClauses rejects an empty condition instead of matching everything', () => {
  assert.throws(() => validateClauses({ and: [{}] }), /Condition and\[0\] is empty/);
  assert.throws(() => validateClauses({ not: {} }), /Condition not is empty/);
  // tagMatchMode alone constrains nothing.
  assert.throws(() => validateClauses({ or: [{ tagMatchMode: 'all' }] }), /Condition or\[0\] is empty/);
});

test('validateClauses accepts every supported condition key', () => {
  const everything: Record<string, unknown> = {};
  for (const key of CONDITION_KEYS) {
    if (key === 'taskStatus') everything[key] = ['Available'];
    else if (key === 'flagged' || key === 'hasNote' || key === 'isRepeating') everything[key] = true;
    else if (key === 'tagMatchMode') everything[key] = 'all';
    else if (key === 'tagFilter') everything[key] = ['home'];
    else everything[key] = key.endsWith('Before') || key.endsWith('After') ? '2026-01-01' : 'x';
  }
  assert.doesNotThrow(() => validateClauses({ and: [everything as any] }));
});

test('filter_tasks schema exposes the new 0.5.0 fields', () => {
  const parsed = filterTasksSchema.parse({
    completedYesterday: true,
    addedAfter: '2026-01-01',
    modifiedBefore: '2026-02-01',
    droppedAfter: '2026-01-15',
    isRepeating: true,
    hasNote: false,
    nameContains: 'draft',
    nameMatches: '^Draft',
    estimatedMinutes: { between: [5, 30] },
    folderName: 'Work',
    fields: ['dates', 'tags'],
    countOnly: false,
    offset: 20,
    and: [{ flagged: true }],
    or: [{ hasNote: true }, { isRepeating: false }],
    not: { taskStatus: ['Dropped'] }
  }) as any;

  assert.equal(parsed.completedYesterday, true);
  assert.equal(parsed.offset, 20);
  assert.deepEqual(parsed.estimatedMinutes, { between: [5, 30] });
  assert.equal(parsed.and.length, 1);
});

test('condition and estimate objects are strict — a typo can never widen the result', () => {
  assert.equal(ConditionSchema.safeParse({ flagged: true, flaged: true }).success, false);
  assert.equal(
    filterTasksSchema.safeParse({ estimatedMinutes: { lessThan: 10, moreThan: 5 } }).success,
    false,
    'estimatedMinutes accepted an unknown comparator'
  );
  assert.equal(
    filterTasksSchema.safeParse({ and: [{ dueBefore: '2026-01-01', dewBefore: 'x' }] }).success,
    false,
    'clause condition accepted an unknown key'
  );
});

test('an empty or[] is rejected at the schema level (it would match nothing)', () => {
  assert.equal(filterTasksSchema.safeParse({ or: [] }).success, false);
  assert.equal(filterTasksSchema.safeParse({ and: [] }).success, false);
});

test('limit must be a positive integer within the cap', () => {
  // An unvalidated limit accepted 0 (silently returning nothing), -5 and 2.5 —
  // all of which reach the script and produce a page size nobody asked for.
  assert.equal(filterTasksSchema.safeParse({ limit: 0 }).success, false);
  assert.equal(filterTasksSchema.safeParse({ limit: -5 }).success, false);
  assert.equal(filterTasksSchema.safeParse({ limit: 2.5 }).success, false);
  assert.equal(filterTasksSchema.safeParse({ limit: 1001 }).success, false);
  assert.equal(filterTasksSchema.safeParse({ limit: 1 }).success, true);
  assert.equal(filterTasksSchema.safeParse({ limit: 1000 }).success, true);
});

test('offset must be a non-negative integer', () => {
  assert.equal(filterTasksSchema.safeParse({ offset: -1 }).success, false);
  assert.equal(filterTasksSchema.safeParse({ offset: 1.5 }).success, false);
  assert.equal(filterTasksSchema.safeParse({ offset: 0 }).success, true);
});

// ---------------------------------------------------------------------------
// In-script behavior harness.
//
// filterTasks.js only touches OmniJS globals, so it can be compiled with
// `new Function` and handed a fake database. That runs the REAL script — the
// candidate-set widening rules included — with no OmniFocus anywhere. Source
// regexes cannot catch a widening bug; this can.
// ---------------------------------------------------------------------------

const FAKE_TASK_STATUS = {
  Available: 'Available',
  Blocked: 'Blocked',
  Completed: 'Completed',
  Dropped: 'Dropped',
  DueSoon: 'DueSoon',
  Next: 'Next',
  Overdue: 'Overdue'
};

function fakeTask(name: string, taskStatus: string, extra: Record<string, any> = {}) {
  return {
    id: { primaryKey: name.toLowerCase().replace(/\s+/g, '-') },
    name,
    note: '',
    taskStatus,
    flagged: false,
    dueDate: null,
    deferDate: null,
    plannedDate: null,
    completionDate: taskStatus === 'Completed' ? new Date() : null,
    dropDate: taskStatus === 'Dropped' ? new Date() : null,
    added: new Date(),
    modified: new Date(),
    effectiveDueDate: null,
    effectiveDeferDate: null,
    estimatedMinutes: null,
    containingProject: null,
    inInbox: true,
    repetitionRule: null,
    tags: [],
    ...extra
  };
}

function runFilterScript(tasks: any[], args: Record<string, any>): any {
  // The file is one IIFE statement; as an expression it must lose its
  // statement-terminating semicolon.
  const scriptExpression = readScript().trim().replace(/;$/, '');
  const fn = new Function(
    'injectedArgs',
    'flattenedTasks',
    'flattenedFolders',
    'Task',
    'Folder',
    // Parenthesized: the script file opens with comment lines, and
    // `return` + newline would otherwise be cut short by ASI.
    `return (\n${scriptExpression}\n);`
  );
  const raw = fn(args, tasks, [], { Status: FAKE_TASK_STATUS }, { byIdentifier: () => null });
  return JSON.parse(raw);
}

const MIXED_STATUS_TASKS = [
  fakeTask('Live one', 'Available'),
  fakeTask('Next one', 'Next'),
  fakeTask('Finished one', 'Completed'),
  fakeTask('Also finished', 'Completed'),
  fakeTask('Abandoned one', 'Dropped')
];

test('a not clause over Dropped does not resurrect completed tasks', () => {
  // Regression: `not` used to feed the completed/dropped widening check, so
  // excluding dropped work switched OFF the default completed/dropped filter
  // and returned every completed task in the database. Negation only ever
  // removes tasks — it can never widen the candidate set.
  const result = runFilterScript(MIXED_STATUS_TASKS, { not: { taskStatus: ['Dropped'] } });

  assert.ok(Array.isArray(result.tasks), JSON.stringify(result));
  const names = result.tasks.map((t: any) => t.name).sort();
  assert.deepEqual(names, ['Live one', 'Next one'], 'a not clause widened the candidate set');
});

test('a not clause over Completed still excludes completed tasks', () => {
  const result = runFilterScript(MIXED_STATUS_TASKS, { not: { taskStatus: ['Completed'] } });

  assert.ok(Array.isArray(result.tasks), JSON.stringify(result));
  const names = result.tasks.map((t: any) => t.name).sort();
  assert.deepEqual(names, ['Live one', 'Next one']);
});

test('an and/or clause asking for Completed still widens the candidate set', () => {
  // The widening rule is still needed for positive clauses: without it an
  // and/or clause mentioning Completed would always be false.
  const result = runFilterScript(MIXED_STATUS_TASKS, { and: [{ taskStatus: ['Completed'] }] });

  assert.ok(Array.isArray(result.tasks), JSON.stringify(result));
  const names = result.tasks.map((t: any) => t.name).sort();
  assert.deepEqual(names, ['Also finished', 'Finished one']);
});

test('a not clause combined with an or clause over Completed keeps the or widening', () => {
  const result = runFilterScript(MIXED_STATUS_TASKS, {
    or: [{ taskStatus: ['Completed'] }],
    not: { nameContains: 'also' }
  });

  assert.ok(Array.isArray(result.tasks), JSON.stringify(result));
  assert.deepEqual(result.tasks.map((t: any) => t.name), ['Finished one']);
});

// ---------------------------------------------------------------------------
// Skill-doc accuracy. The skill doc is what an agent reads before it calls the
// tool, so a key documented as a clause condition that the strict schema
// rejects is a guaranteed failed call.
// ---------------------------------------------------------------------------

function clauseSectionOfSkillDoc(): string {
  const doc = readSource('..', '..', '..', 'docs', 'skills', 'omnifocus', 'filters.md');
  const start = doc.indexOf('## Boolean clauses');
  const end = doc.indexOf('## Reading the output');
  assert.ok(start > 0 && end > start, 'filters.md has no boolean-clause section');
  return doc.slice(start, end);
}

test('filters.md documents exactly the clause keys the schema accepts', () => {
  const section = clauseSectionOfSkillDoc();

  for (const key of Object.keys(ConditionSchema.shape)) {
    // Date keys are documented as Before/After pairs ("`due`, `defer`, …").
    const base = key.replace(/(Before|After)$/, '');
    assert.ok(
      section.includes(`\`${key}\``) || (base !== key && section.includes(`\`${base}\``)),
      `filters.md does not document the clause condition "${key}"`
    );
  }
});

test('filters.md does not present a top-level-only field as a clause condition', () => {
  const section = clauseSectionOfSkillDoc();
  const topLevelOnly = ['estimatedMinutes', 'folderName', 'folderId', 'exactTagMatch', 'perspective'];

  for (const key of topLevelOnly) {
    assert.ok(
      !(key in ConditionSchema.shape),
      `${key} is now a real clause key — update the doc test and the doc`
    );
    // It may only appear on the "top level only" side of the section.
    const topLevelPart = section.slice(section.indexOf('top level only'));
    assert.ok(
      !section.includes(key) || topLevelPart.includes(key),
      `filters.md lists "${key}" as a clause condition, but the strict schema rejects it`
    );
  }
});
