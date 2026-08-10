import assert from 'node:assert/strict';
import test from 'node:test';

import { renderFilterTasksResult, type FilterTasksOptions } from './filterTasks.js';

// ---------------------------------------------------------------------------
// GOLDEN BACK-COMPAT TEST
//
// The expected strings below were captured from the pre-0.5.0 implementation of
// filterTasks() (the markdown builder that lived inline in that function) for
// this exact payload + options pair. Nothing in the 0.5.0 feature batch —
// clauses, folder scope, field projection, countOnly, offset paging — may change
// the bytes produced for a call that uses NONE of those parameters.
//
// The only runtime substitution is `local(iso)`: the renderer formats dates with
// toLocaleDateString(), so the literal digits depend on the machine's locale and
// timezone. Every other byte (structure, emoji, spacing, blank lines, counts,
// grouping order) is asserted literally.
// ---------------------------------------------------------------------------

const DUE_2020 = '2020-03-05T15:00:00.000Z';
const DEFER_2020 = '2020-03-01T15:00:00.000Z';
const PLAN_2020 = '2020-03-02T15:00:00.000Z';
const EFF_DUE_2099 = '2099-11-20T15:00:00.000Z';
const EFF_DEFER_2099 = '2099-11-01T15:00:00.000Z';

function local(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

const GOLDEN_TASKS = [
  {
    id: 'task-inbox-1',
    name: 'Zebra inbox capture',
    note: '  needs a decision  ',
    taskStatus: 'Available',
    flagged: false,
    dueDate: null,
    deferDate: null,
    plannedDate: null,
    completedDate: null,
    effectiveDueDate: null,
    effectiveDeferDate: null,
    estimatedMinutes: null,
    projectId: null,
    projectName: null,
    inInbox: true,
    tags: []
  },
  {
    id: 'task-work-1',
    name: 'Draft quarterly memo',
    note: '',
    taskStatus: 'Blocked',
    flagged: true,
    dueDate: DUE_2020,
    deferDate: DEFER_2020,
    plannedDate: PLAN_2020,
    completedDate: null,
    effectiveDueDate: null,
    effectiveDeferDate: null,
    estimatedMinutes: 95,
    projectId: 'proj-work',
    projectName: 'Work Planning',
    inInbox: false,
    tags: [{ id: 'tag-1', name: 'office' }, { id: 'tag-2', name: 'writing' }]
  },
  {
    id: 'task-work-2',
    name: 'archive old invoices',
    note: 'box 4 in the closet',
    taskStatus: 'Available',
    flagged: false,
    dueDate: null,
    deferDate: null,
    plannedDate: null,
    completedDate: null,
    effectiveDueDate: EFF_DUE_2099,
    effectiveDeferDate: EFF_DEFER_2099,
    estimatedMinutes: 20,
    projectId: 'proj-home',
    projectName: 'Home Admin',
    inInbox: false,
    tags: [{ id: 'tag-3', name: 'errand' }]
  }
];

const GROUPED_PAYLOAD = {
  exportDate: '2026-01-01T00:00:00.000Z',
  tasks: GOLDEN_TASKS,
  totalCount: 42,
  matchedCount: 3,
  filteredCount: 3,
  limitApplied: 100,
  truncated: false,
  appliedFilters: ['tagFilter'],
  sortedBy: 'name',
  sortOrder: 'asc'
};

const GROUPED_OPTIONS: FilterTasksOptions = {
  flagged: true,
  projectFilter: 'Work',
  tagFilter: ['office'],
  tagMatchMode: 'any',
  searchText: 'memo'
};

const CAPPED_PAYLOAD = {
  exportDate: '2026-01-01T00:00:00.000Z',
  tasks: GOLDEN_TASKS.slice(0, 2),
  totalCount: 42,
  matchedCount: 9,
  filteredCount: 2,
  limitApplied: 2,
  truncated: true,
  appliedFilters: ['deferAvailable', 'plannedThisWeek'],
  sortedBy: 'dueDate',
  sortOrder: 'desc'
};

const CAPPED_OPTIONS: FilterTasksOptions = {
  limit: 2,
  sortBy: 'dueDate',
  sortOrder: 'desc',
  taskStatus: ['Available', 'Blocked'],
  perspective: 'inbox',
  completedToday: true,
  deferAvailable: true,
  plannedThisWeek: true
};

const EMPTY_PAYLOAD = {
  exportDate: '2026-01-01T00:00:00.000Z',
  tasks: [],
  totalCount: 42,
  matchedCount: 0,
  filteredCount: 0,
  limitApplied: 100,
  truncated: false,
  appliedFilters: [],
  sortedBy: 'name',
  sortOrder: 'asc'
};

const EMPTY_OPTIONS: FilterTasksOptions = { projectFilter: 'Nothing' };

test('GOLDEN: grouped multi-project render is byte-identical to the pre-0.5.0 output', () => {
  const expected =
    '# 🔍 FILTERED TASKS\n' +
    '\n' +
    '**Filter**: Project: "Work" | Tags: office | Flagged: Yes | Search: "memo"\n' +
    '\n' +
    'Found 3 tasks:\n' +
    '\n' +
    '## 📁 Home Admin\n' +
    `⚪ archive old invoices [task-work-2] [📅 DUE (eff): ${local(EFF_DUE_2099)}, 🚀 DEFER (eff): ${local(EFF_DEFER_2099)}] (⏱ 20m)\n` +
    '  📝 box 4 in the closet\n' +
    '  🏷 errand\n' +
    '\n' +
    '\n' +
    '## 📁 Work Planning\n' +
    `🔴 🚩 Draft quarterly memo [task-work-1] [⚠️ DUE: ${local(DUE_2020)}, 🚀 DEFER: ${local(DEFER_2020)}, 🗓 PLAN: ${local(PLAN_2020)}] (Blocked, ⏱ 1h35m)\n` +
    '  🏷 office, writing\n' +
    '\n' +
    '\n' +
    '## 📁 📥 Inbox\n' +
    '⚪ Zebra inbox capture [task-inbox-1]\n' +
    '  📝 needs a decision\n' +
    '\n' +
    '\n' +
    '\n' +
    '📊 **Sorted by**: name (asc)\n';

  assert.equal(renderFilterTasksResult(GROUPED_PAYLOAD, GROUPED_OPTIONS), expected);
});

test('GOLDEN: capped render is byte-identical to the pre-0.5.0 output', () => {
  const expected =
    '# 🔍 FILTERED TASKS\n' +
    '\n' +
    '**Filter**: Status: Available, Blocked | Perspective: inbox | Completed: Today | Defer: Available | Planned: This Week\n' +
    '\n' +
    'Found 2 tasks (showing first 2 of 9):\n' +
    '\n' +
    '## 📁 📥 Inbox\n' +
    '⚪ Zebra inbox capture [task-inbox-1]\n' +
    '  📝 needs a decision\n' +
    '\n' +
    '\n' +
    '## 📁 Work Planning\n' +
    `🔴 🚩 Draft quarterly memo [task-work-1] [⚠️ DUE: ${local(DUE_2020)}, 🚀 DEFER: ${local(DEFER_2020)}, 🗓 PLAN: ${local(PLAN_2020)}] (Blocked, ⏱ 1h35m)\n` +
    '  🏷 office, writing\n' +
    '\n' +
    '\n' +
    '\n' +
    '📊 **Sorted by**: dueDate (desc)\n' +
    '⚠️ **Results capped at 2** — raise `limit` or narrow the filter to see the rest.\n';

  assert.equal(renderFilterTasksResult(CAPPED_PAYLOAD, CAPPED_OPTIONS), expected);
});

test('GOLDEN: empty render is byte-identical to the pre-0.5.0 output', () => {
  const expected =
    '# 🔍 FILTERED TASKS\n' +
    '\n' +
    '**Filter**: Project: "Nothing"\n' +
    '\n' +
    '🎯 No tasks match your filter criteria.\n' +
    '\n' +
    '**Tips**:\n' +
    '- Try broadening your search criteria\n' +
    '- Check if tasks exist in the specified project/tags\n' +
    '- Use `get_inbox_tasks` or `get_flagged_tasks` for basic views\n';

  assert.equal(renderFilterTasksResult(EMPTY_PAYLOAD, EMPTY_OPTIONS), expected);
});

// ---------------------------------------------------------------------------
// New 0.5.0 rendering behaviour
// ---------------------------------------------------------------------------

test('offset renders a "showing X-Y of Z" header instead of "showing first N"', () => {
  const output = renderFilterTasksResult(
    { ...CAPPED_PAYLOAD, tasks: GOLDEN_TASKS.slice(0, 2), matchedCount: 9, offsetApplied: 4, truncated: true },
    { ...CAPPED_OPTIONS, offset: 4 }
  );

  assert.match(output, /Found 2 tasks \(showing 5–6 of 9\):/);
  assert.doesNotMatch(output, /showing first/);
  assert.match(output, /Next page: `offset: 6`/);
});

test('offset makes the script authoritative — no client-side re-filter, re-sort or re-slice', () => {
  // deferAvailable is NOT in appliedFilters here, so the legacy fallback would
  // run and drop the future-dated task. With an offset in play the script's
  // page must survive untouched or pagination silently loses rows.
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const payload = {
    ...CAPPED_PAYLOAD,
    tasks: [
      { ...GOLDEN_TASKS[0], id: 'keep-me', deferDate: future },
      { ...GOLDEN_TASKS[1], id: 'also-keep' }
    ],
    appliedFilters: [],
    matchedCount: 40,
    truncated: true
  };

  const output = renderFilterTasksResult(payload, { limit: 2, offset: 10, deferAvailable: true });

  assert.match(output, /keep-me/, 'client-side fallback re-filtered a paginated page');
  assert.match(output, /also-keep/);
  assert.match(output, /showing 11–12 of 40/);
});

test('logical clauses also make the script authoritative', () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const payload = {
    ...GROUPED_PAYLOAD,
    tasks: [{ ...GOLDEN_TASKS[0], id: 'clause-kept', deferDate: future }],
    appliedFilters: [],
    matchedCount: 1
  };

  const output = renderFilterTasksResult(payload, {
    deferAvailable: true,
    or: [{ flagged: true }, { hasNote: true }]
  });

  assert.match(output, /clause-kept/, 'client-side fallback re-filtered a clause result');
  assert.match(output, /OR clauses: 2/);
});

test('countOnly renders a single count line and never a task list', () => {
  const output = renderFilterTasksResult(
    { countOnly: true, count: 137, totalCount: 900, appliedFilters: ['hasNote'] },
    { countOnly: true, hasNote: true }
  );

  assert.equal(
    output,
    '# 🔍 FILTERED TASKS\n\n**Filter**: Has note: Yes\n\n🔢 **137 matching tasks** (countOnly — no task details were read).\n'
  );
});

test('countOnly singular reads correctly', () => {
  const output = renderFilterTasksResult({ countOnly: true, count: 1, appliedFilters: [] }, { countOnly: true });
  assert.match(output, /\*\*1 matching task\*\*/);
});

test('fields projection gates only the optional components', () => {
  const output = renderFilterTasksResult(GROUPED_PAYLOAD, { ...GROUPED_OPTIONS, fields: ['project'] });

  // ids and names always render
  assert.match(output, /archive old invoices \[task-work-2\]/);
  assert.match(output, /## 📁 Work Planning/);
  // everything else is suppressed
  assert.doesNotMatch(output, /DUE/);
  assert.doesNotMatch(output, /⏱/);
  assert.doesNotMatch(output, /📝/);
  assert.doesNotMatch(output, /🏷/);
  assert.doesNotMatch(output, /\(Blocked/);
});

test('fields without "project" drops the per-project group headings', () => {
  const output = renderFilterTasksResult(GROUPED_PAYLOAD, { ...GROUPED_OPTIONS, fields: ['tags'] });

  assert.doesNotMatch(output, /## 📁/);
  assert.match(output, /🏷 office, writing/);
  assert.match(output, /Zebra inbox capture \[task-inbox-1\]/);
});

test('omitting fields renders every component (the golden default)', () => {
  assert.equal(
    renderFilterTasksResult(GROUPED_PAYLOAD, GROUPED_OPTIONS),
    renderFilterTasksResult(GROUPED_PAYLOAD, { ...GROUPED_OPTIONS, fields: [] })
  );
});
