import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyClientSideFilters } from './filterTasks.js';

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

  // Truncation must come after the filter pass and the sort.
  const filterIndex = src.indexOf('const matchedCount = filteredTasks.length;');
  const sortIndex = src.indexOf('filteredTasks.sort(');
  const truncateIndex = src.indexOf('filteredTasks.slice(0, limitApplied)');
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
