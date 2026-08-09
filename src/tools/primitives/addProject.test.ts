import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AddProjectParams } from './addProject.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'addProject.ts'), 'utf8');

test('AddProjectParams interface accepts all expected fields', () => {
  // Type-level test: ensure the interface shape is correct
  const params: AddProjectParams = {
    name: 'Test Project',
    note: 'A note',
    dueDate: '2026-03-15T17:00:00-05:00',
    deferDate: '2026-03-10T09:00:00-05:00',
    plannedDate: '2026-03-12T09:00:00-05:00',
    flagged: true,
    estimatedMinutes: 60,
    tags: ['Work', 'Urgent'],
    folderName: 'My Folder',
    sequential: true
  };

  assert.equal(params.name, 'Test Project');
  assert.equal(params.sequential, true);
  assert.equal(params.tags?.length, 2);
});

test('addProject resolves the folder with the ambiguity-guarded helper', () => {
  // Old behaviour took flattenedFolders.filter(...)[0], silently picking one of
  // several same-named folders.
  assert.doesNotMatch(src, /flattenedFolders\.filter\(f => f\.name === args\.folderName\)\[0\]/, 'addProject still takes the first same-named folder');
  assert.match(src, /__resolveByNameOrId\(allFolders, args\.folderName, 'Folder'\)/, 'addProject should resolve the folder via __resolveByNameOrId');
  assert.match(src, /OMNIJS_LOOKUP_HELPERS/, 'addProject should prepend the shared lookup helpers');
});

test('addProject surfaces a failed plannedDate write instead of swallowing it', () => {
  assert.doesNotMatch(src, /catch\(e\) \{\}/, 'addProject still has an empty catch around plannedDate');
  assert.match(src, /warnings\.push\('plannedDate was not set: ' \+ e\.message\)/, 'plannedDate failure should be collected as a warning');
  assert.match(src, /warnings: warnings/, 'script result should carry the warnings array');
});

test('addProject normalizes date strings to local time before OmniJS sees them', () => {
  // Bare YYYY-MM-DD parses as UTC midnight — the previous evening west of UTC.
  assert.match(src, /toLocalDateTimeString/, 'addProject should import toLocalDateTimeString');
  for (const field of ['dueDate', 'deferDate', 'plannedDate']) {
    assert.match(
      src,
      new RegExp(`${field}: toLocalDateTimeString\\(params\\.${field}\\)`),
      `${field} should be normalized before being passed to runOmniJs`
    );
  }
  assert.match(src, /runOmniJs\(script, normalized\)/, 'runOmniJs should receive the normalized params');
});
