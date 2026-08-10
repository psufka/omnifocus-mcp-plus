import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SEARCH_ITEMS_SCRIPT,
  renderSearchItemsResult,
  ALL_SEARCH_TYPES,
  DEFAULT_LIMIT_PER_TYPE,
  type SearchItemsParams
} from './searchItems.js';
import { schema as searchItemsSchema } from '../definitions/searchItems.js';

const here = dirname(fileURLToPath(import.meta.url));

function readSource(...segments: string[]): string {
  return readFileSync(join(here, ...segments), 'utf8');
}

// ---------------------------------------------------------------------------
// Script coverage. SEARCH_ITEMS_SCRIPT only ever runs inside OmniFocus, so a
// syntax error or an escaping hazard would otherwise surface as a runtime
// failure against the live database. Compiling with `new Function` parses it
// (flattenedTasks, Task, Project... resolve at call time, which never happens
// here) without touching OmniFocus.
// ---------------------------------------------------------------------------

test('search_items script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', SEARCH_ITEMS_SCRIPT), 'search_items script failed to parse');
});

test('search_items script survives the runOmniJs escaping round-trip', () => {
  // runOmniJs escapes \ ` and $ before embedding the script in a JXA template
  // literal; a script containing any of them is a hazard.
  assert.ok(!SEARCH_ITEMS_SCRIPT.includes('`'), 'search_items script contains a backtick');
  assert.ok(!SEARCH_ITEMS_SCRIPT.includes('$'), 'search_items script contains a dollar sign');
  assert.ok(!SEARCH_ITEMS_SCRIPT.includes('\\'), 'search_items script contains a backslash');
});

test('search_items script reads user data only from the args object', () => {
  // Every user value is injected as `const args = {...}` by runOmniJs. Anything
  // else would mean string interpolation.
  assert.match(SEARCH_ITEMS_SCRIPT, /args\.query/, 'script never reads the query from args');
  assert.match(SEARCH_ITEMS_SCRIPT, /args\.types/, 'script never reads types from args');
  assert.match(SEARCH_ITEMS_SCRIPT, /args\.searchIn/, 'script never reads searchIn from args');
  assert.match(SEARCH_ITEMS_SCRIPT, /args\.includeCompleted/, 'script never reads includeCompleted from args');
  assert.match(SEARCH_ITEMS_SCRIPT, /args\.limitPerType/, 'script never reads limitPerType from args');
});

test('search_items script searches every entity collection in ONE evaluation', () => {
  for (const collection of ['flattenedTasks', 'flattenedProjects', 'flattenedFolders', 'flattenedTags']) {
    assert.match(SEARCH_ITEMS_SCRIPT, new RegExp(collection), `script never reads ${collection}`);
  }
  // One return, one JSON payload — not one script per type.
  assert.equal(SEARCH_ITEMS_SCRIPT.match(/return JSON\.stringify/g)?.length, 1);
});

test('search_items script counts all matches before it truncates', () => {
  assert.match(SEARCH_ITEMS_SCRIPT, /totalMatched: matches\.length/, 'totalMatched is computed after slicing');
  assert.match(SEARCH_ITEMS_SCRIPT, /items: matches\.slice\(0, limitPerType\)/, 'script does not cap per type');
  assert.match(SEARCH_ITEMS_SCRIPT, /truncated: matches\.length > limitPerType/, 'script does not report truncation');
});

test('search_items script excludes finished work unless includeCompleted', () => {
  assert.match(
    SEARCH_ITEMS_SCRIPT,
    /!includeCompleted && \(status === 'Completed' \|\| status === 'Dropped'\)/,
    'completed/dropped tasks are not excluded by default'
  );
  assert.match(
    SEARCH_ITEMS_SCRIPT,
    /!includeCompleted && \(status === 'completed' \|\| status === 'dropped'\)/,
    'done/dropped projects are not excluded by default'
  );
});

test('search_items script compares status with enum identity, not string parsing', () => {
  assert.match(SEARCH_ITEMS_SCRIPT, /taskStatusName\[Task\.Status\.Available\]/);
  assert.match(SEARCH_ITEMS_SCRIPT, /projectStatusName\[Project\.Status\.Done\]/);
  assert.match(SEARCH_ITEMS_SCRIPT, /folderStatusName\[Folder\.Status\.Dropped\]/);
  assert.match(SEARCH_ITEMS_SCRIPT, /tagStatusName\[Tag\.Status\.OnHold\]/);
});

test('searchItems.ts classifies its script read-only for the executor', () => {
  const src = readSource('searchItems.ts');
  assert.match(src, /\{ readOnly: true \}/, 'searchItems does not classify its script as read-only');
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const SAMPLE_PARAMS: SearchItemsParams = { query: 'memo' };

const SAMPLE_PAYLOAD = {
  success: true,
  query: 'memo',
  searchIn: 'names',
  includeCompleted: false,
  limitPerType: 2,
  typesSearched: ['task', 'project', 'folder', 'tag'],
  results: {
    task: {
      items: [
        { id: 't1', name: 'Draft memo', status: 'Available', projectName: 'Work Planning', matchedIn: 'name' },
        { id: 't2', name: 'Memo follow-up', status: 'Blocked', projectName: 'Inbox', matchedIn: 'name' }
      ],
      totalMatched: 5,
      truncated: true
    },
    project: {
      items: [{ id: 'p1', name: 'Memo pipeline', status: 'active', parentName: 'Admin', matchedIn: 'name' }],
      totalMatched: 1,
      truncated: false
    },
    folder: { items: [], totalMatched: 0, truncated: false },
    tag: {
      items: [{ id: 'g1', name: 'memos', status: 'on_hold', parentName: null, matchedIn: 'name' }],
      totalMatched: 1,
      truncated: false
    }
  }
};

test('search_items renders per-type groups with ids and honest showing-N-of-M lines', () => {
  const output = renderSearchItemsResult(SAMPLE_PAYLOAD, { ...SAMPLE_PARAMS, limitPerType: 2 });

  assert.match(output, /# 🔎 SEARCH RESULTS/);
  assert.match(output, /\*\*Query\*\*: "memo"/);
  assert.match(output, /\*\*Searched in\*\*: names/);
  assert.match(output, /\*\*Completed\/dropped\*\*: excluded/);

  assert.match(output, /Found 7 matches \(showing 4\):/);

  assert.match(output, /## ✔️ Tasks — showing 2 of 5/);
  assert.match(output, /Draft memo \[t1\] \(Work Planning\) — Available, matched in name/);
  assert.match(output, /3 more task matches hidden — raise `limitPerType` \(currently 2\)/);

  assert.match(output, /## 📊 Projects — showing 1 of 1/);
  assert.match(output, /Memo pipeline \[p1\] \(Admin\) — active, matched in name/);

  assert.match(output, /## 📁 Folders — no matches/);

  assert.match(output, /## 🏷 Tags — showing 1 of 1/);
  assert.match(output, /memos \[g1\] — on_hold, matched in name/);
});

test('search_items never claims more results than it shows', () => {
  const output = renderSearchItemsResult(SAMPLE_PAYLOAD, { ...SAMPLE_PARAMS, limitPerType: 2 });
  const shown = (output.match(/\[(t1|t2|p1|g1)\]/g) ?? []).length;
  assert.equal(shown, 4, 'rendered row count drifted from the payload');
  assert.doesNotMatch(output, /showing 5 of 5/);
});

test('search_items renders a helpful empty result', () => {
  const output = renderSearchItemsResult(
    {
      success: true,
      searchIn: 'names',
      includeCompleted: false,
      limitPerType: 20,
      typesSearched: ['task'],
      results: { task: { items: [], totalMatched: 0, truncated: false } }
    },
    { query: 'zzz', types: ['task'] }
  );

  assert.match(output, /🎯 No items match that query\./);
  assert.match(output, /searchIn: "both"/);
  assert.match(output, /includeCompleted: true/);
  assert.doesNotMatch(output, /## /, 'empty result should not print per-type headings');
});

test('search_items reports the note-vs-name provenance of each hit', () => {
  const output = renderSearchItemsResult(
    {
      success: true,
      searchIn: 'both',
      includeCompleted: true,
      limitPerType: 20,
      typesSearched: ['task'],
      results: {
        task: {
          items: [
            { id: 'n1', name: 'Unrelated title', status: 'Available', projectName: null, matchedIn: 'note' }
          ],
          totalMatched: 1,
          truncated: false
        }
      }
    },
    { query: 'memo', searchIn: 'both', includeCompleted: true }
  );

  assert.match(output, /\*\*Searched in\*\*: names and notes/);
  assert.match(output, /\*\*Completed\/dropped\*\*: included/);
  assert.match(output, /Unrelated title \[n1\] — Available, matched in note/);
});

test('search_items surfaces a script error instead of rendering an empty page', () => {
  assert.throws(
    () => renderSearchItemsResult({ success: false, error: 'OmniFocus returned empty output' }, SAMPLE_PARAMS),
    /OmniFocus returned empty output/
  );
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test('search_items schema defaults and bounds', () => {
  assert.equal(searchItemsSchema.safeParse({ query: 'x' }).success, true);
  assert.equal(searchItemsSchema.safeParse({ query: '' }).success, false, 'empty query accepted');
  assert.equal(searchItemsSchema.safeParse({ query: 'x', limitPerType: 0 }).success, false);
  assert.equal(searchItemsSchema.safeParse({ query: 'x', limitPerType: 101 }).success, false);
  assert.equal(searchItemsSchema.safeParse({ query: 'x', limitPerType: 100 }).success, true);
  assert.equal(searchItemsSchema.safeParse({ query: 'x', types: ['task', 'tag'] }).success, true);
  assert.equal(searchItemsSchema.safeParse({ query: 'x', types: ['perspective'] }).success, false);
  assert.equal(searchItemsSchema.safeParse({ query: 'x', searchIn: 'both' }).success, true);
  assert.equal(searchItemsSchema.safeParse({ query: 'x', searchIn: 'titles' }).success, false);
});

test('search_items schema rejects unknown top-level fields', () => {
  assert.equal(searchItemsSchema.safeParse({ query: 'x', bogusUnknownField: true }).success, false);
});

test('search_items defaults are the documented ones', () => {
  assert.deepEqual(ALL_SEARCH_TYPES, ['task', 'project', 'folder', 'tag']);
  assert.equal(DEFAULT_LIMIT_PER_TYPE, 20);
});

test('search_items only suggests knobs that are not already on', () => {
  const empty = (params: SearchItemsParams, searchIn: string, includeCompleted: boolean) =>
    renderSearchItemsResult(
      {
        success: true,
        searchIn,
        includeCompleted,
        limitPerType: 20,
        typesSearched: ALL_SEARCH_TYPES,
        results: Object.fromEntries(ALL_SEARCH_TYPES.map(t => [t, { items: [], totalMatched: 0, truncated: false }]))
      },
      params
    );

  const narrow = empty({ query: 'zzz' }, 'names', false);
  assert.match(narrow, /searchIn: "both"/);
  assert.match(narrow, /includeCompleted: true/);

  const wide = empty({ query: 'zzz', searchIn: 'both', includeCompleted: true }, 'both', true);
  assert.doesNotMatch(wide, /searchIn: "both"/, 'suggested a setting that was already on');
  assert.doesNotMatch(wide, /includeCompleted: true/, 'suggested a setting that was already on');
});

test('search_items says folders and tags have no notes rather than "no matches"', () => {
  const output = renderSearchItemsResult(
    {
      success: true,
      searchIn: 'notes',
      includeCompleted: false,
      limitPerType: 20,
      typesSearched: ['task', 'folder', 'tag'],
      results: {
        task: {
          items: [{ id: 'x1', name: 'Something', status: 'Available', projectName: null, matchedIn: 'note' }],
          totalMatched: 1,
          truncated: false
        },
        folder: { items: [], totalMatched: 0, truncated: false },
        tag: { items: [], totalMatched: 0, truncated: false }
      }
    },
    { query: 'memo', searchIn: 'notes', types: ['task', 'folder', 'tag'] }
  );

  assert.match(output, /## 📁 Folders — not applicable \(folders have no notes\)/);
  assert.match(output, /## 🏷 Tags — not applicable \(tags have no notes\)/);
  assert.doesNotMatch(output, /Folders — no matches/);
});
