import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateEditItemParams } from './editItem.js';

// The OmniJS script only runs inside OmniFocus, so the script-level fixes are
// verified as source patterns (same approach as omniJsScriptPatches.test.ts).
const here = dirname(fileURLToPath(import.meta.url));
const primitiveSource = readFileSync(join(here, 'editItem.ts'), 'utf8');
const definitionSource = readFileSync(join(here, '..', 'definitions', 'editItem.ts'), 'utf8');

test('validateEditItemParams requires id or name', () => {
  const validation = validateEditItemParams({
    itemType: 'task',
    newFlagged: true
  });
  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Either id or name must be provided/);
});

test('validateEditItemParams rejects task move parameters for project edits', () => {
  const validation = validateEditItemParams({
    id: 'project-1',
    itemType: 'project',
    newProjectName: 'ShouldFail'
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /only supported when itemType is "task"/);
});

test('validateEditItemParams rejects conflicting destination types', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newProjectId: 'proj-1',
    moveToInbox: true
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Invalid destination selection/);
});

test('validateEditItemParams rejects both newProjectId and newProjectName', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newProjectId: 'proj-1',
    newProjectName: 'Project'
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Cannot specify both newProjectId and newProjectName/);
});

test('validateEditItemParams rejects both newParentTaskId and newParentTaskName', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newParentTaskId: 'parent-1',
    newParentTaskName: 'Parent'
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Cannot specify both newParentTaskId and newParentTaskName/);
});

test('validateEditItemParams accepts valid task edit', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newName: 'Updated Name',
    newFlagged: true,
    newProjectName: 'Destination'
  });

  assert.equal(validation.valid, true);
});

test('validateEditItemParams accepts valid project edit', () => {
  const validation = validateEditItemParams({
    name: 'My Project',
    itemType: 'project',
    newSequential: true,
    newProjectStatus: 'onHold'
  });

  assert.equal(validation.valid, true);
});

test('validateEditItemParams rejects both newFolderId and newFolderName', () => {
  const validation = validateEditItemParams({
    id: 'project-1',
    itemType: 'project',
    newFolderId: 'fldr-abc',
    newFolderName: 'Travel'
  });
  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Cannot specify both newFolderId and newFolderName/);
});

test('validateEditItemParams accepts newFolderId alone', () => {
  const validation = validateEditItemParams({
    id: 'project-1',
    itemType: 'project',
    newFolderId: 'fldr-abc'
  });
  assert.equal(validation.valid, true);
});

test('validateEditItemParams accepts slash-path newFolderName alone', () => {
  const validation = validateEditItemParams({
    id: 'project-1',
    itemType: 'project',
    newFolderName: 'Someday/Maybe/Travel'
  });
  assert.equal(validation.valid, true);
});

test('validateEditItemParams rejects newStatus on a project edit', () => {
  const validation = validateEditItemParams({
    id: 'project-1',
    itemType: 'project',
    newStatus: 'dropped'
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /newStatus is only supported when itemType is "task"/);
  assert.match(validation.error || '', /newProjectStatus/);
});

test('validateEditItemParams rejects project-only fields on a task edit', () => {
  for (const [field, value] of [
    ['newSequential', true],
    ['newProjectStatus', 'onHold'],
    ['newFolderName', 'Travel'],
    ['newFolderId', 'fldr-abc']
  ] as Array<[string, unknown]>) {
    const validation = validateEditItemParams({
      id: 'task-1',
      itemType: 'task',
      [field]: value
    } as any);

    assert.equal(validation.valid, false, `${field} should be rejected for tasks`);
    assert.match(validation.error || '', new RegExp(`${field} is only supported when itemType is "project"`));
  }
});

test('validateEditItemParams allows tag operations on projects', () => {
  for (const params of [
    { addTags: ['Home'] },
    { removeTags: ['Home'] },
    { replaceTags: [] }
  ]) {
    const validation = validateEditItemParams({
      id: 'project-1',
      itemType: 'project',
      ...params
    });

    assert.equal(validation.valid, true, `${JSON.stringify(params)} should be valid for projects`);
  }
});

test('editItem script resolves the target with the shared strict lookup helper', () => {
  assert.match(primitiveSource, /OMNIJS_LOOKUP_HELPERS/, 'script does not include the shared lookup helpers');
  assert.match(
    primitiveSource,
    /__resolveByIdOrName\(collection, args\.id \|\| null, args\.name \|\| null, args\.itemType\)/,
    'main lookup does not use __resolveByIdOrName'
  );
  // The stale-ID bug: an id that matched nothing used to fall through to a name search.
  assert.doesNotMatch(primitiveSource, /if \(!item && args\.name\)/, 'script still falls back to name after an ID miss');
  assert.doesNotMatch(
    primitiveSource,
    /collection\.filter\(o => o\.id\.primaryKey === args\.id\)/,
    'script still does its own ID filter instead of the helper'
  );
});

test('editItem script resolves move destinations with the shared lookup helper', () => {
  assert.match(primitiveSource, /__resolveByIdOrName\(flattenedProjects, args\.newProjectId \|\| null, args\.newProjectName \|\| null, 'Destination project'\)/);
  assert.match(primitiveSource, /__resolveByIdOrName\(flattenedTasks, args\.newParentTaskId \|\| null, args\.newParentTaskName \|\| null, 'Destination parent task'\)/);
  assert.doesNotMatch(primitiveSource, /primaryKey === args\.newProjectId/, 'destination project still hand-rolls its ID lookup');
  assert.doesNotMatch(primitiveSource, /primaryKey === args\.newParentTaskId/, 'destination parent still hand-rolls its ID lookup');
});

test('editItem script resolves every destination before mutating anything', () => {
  const firstWrite = primitiveSource.indexOf('item.name = args.newName');
  const folderIdLookup = primitiveSource.indexOf('Folder not found with ID:');
  const folderNameLookup = primitiveSource.indexOf('Folder not found:');
  const projectLookup = primitiveSource.indexOf("'Destination project'");
  const parentLookup = primitiveSource.indexOf("'Destination parent task'");

  assert.ok(firstWrite > 0, 'expected a property write in the script');
  for (const [label, index] of [
    ['folder ID lookup', folderIdLookup],
    ['folder name lookup', folderNameLookup],
    ['destination project lookup', projectLookup],
    ['destination parent lookup', parentLookup]
  ] as Array<[string, number]>) {
    assert.ok(index > 0, `expected ${label} in the script`);
    assert.ok(index < firstWrite, `${label} must run before any property write (half-applied edit)`);
  }
});

test('editItem script treats replaceTags: [] as "clear all tags"', () => {
  assert.doesNotMatch(
    primitiveSource,
    /args\.replaceTags && args\.replaceTags\.length > 0/,
    'empty replaceTags array is still a silent no-op'
  );
  assert.match(primitiveSource, /args\.replaceTags !== undefined/, 'replaceTags does not distinguish omitted from empty');
  assert.match(primitiveSource, /item\.clearTags\(\)/, 'replaceTags does not clear existing tags');
  assert.match(primitiveSource, /tags \(cleared\)/, 'clearing tags is not reported in changedProperties');
});

test('editItem script wires tag operations for projects as well as tasks', () => {
  const tagBlock = primitiveSource.indexOf('--- Tag operations (tasks AND projects) ---');
  const taskOnlyBlock = primitiveSource.indexOf('--- Task-specific updates ---');

  assert.ok(tagBlock > 0, 'expected a shared tag-operations block');
  assert.ok(taskOnlyBlock > tagBlock, 'tag operations must not live inside the task-only section');
});

test('editItem drops only the current occurrence unless dropAllOccurrences is true', () => {
  assert.doesNotMatch(primitiveSource, /item\.drop\(true\)/, 'drop() still hardcodes all-occurrences');
  assert.match(primitiveSource, /item\.drop\(args\.dropAllOccurrences === true\)/, 'drop() does not honour dropAllOccurrences');
  assert.match(definitionSource, /dropAllOccurrences: z\.boolean\(\)\.optional\(\)/, 'schema is missing dropAllOccurrences');
  assert.match(definitionSource, /Defaults to false/, 'schema does not document the false default');
});

test('editItem normalizes bare dates to local time before running the script', () => {
  assert.match(primitiveSource, /toLocalDateTimeString/, 'date args are not normalized to local time');
  assert.match(primitiveSource, /runOmniJs\(script, normalizeDateParams\(params\)\)/, 'script still receives raw date args');
  assert.doesNotMatch(definitionSource, /will display on the wrong day/, 'schema still warns that bare dates are buggy');
});

// --- Post-write read-back verification (v0.5.0) ---------------------------

test('editItem verifies every requested field after applying the edit', () => {
  const firstWrite = primitiveSource.indexOf('item.name = args.newName');
  const verifyPhase = primitiveSource.indexOf('Phase 3 — read-back verification');

  assert.ok(verifyPhase > 0, 'script has no read-back verification phase');
  assert.ok(verifyPhase > firstWrite, 'verification must run after the writes, not before');
  assert.match(primitiveSource, /verified: mismatches\.length === 0/, 'result does not carry a verified flag');
  assert.match(primitiveSource, /mismatches: mismatches/, 'result does not carry the mismatch list');
});

test('editItem read-back compares dates by timestamp, not by string', () => {
  assert.match(primitiveSource, /const verifyDate = function/, 'missing date verification helper');
  assert.match(primitiveSource, /Math\.abs\(want - got\) > 1000/, 'dates are not compared as timestamps with slack');
});

test('editItem read-back compares tags by set equality', () => {
  assert.match(primitiveSource, /const sameSet = function/, 'missing set-equality helper for tags');
  assert.match(primitiveSource, /recordMismatch\('replaceTags'/, 'replaceTags is not verified');
  assert.match(primitiveSource, /recordMismatch\('addTags'/, 'addTags is not verified');
  assert.match(primitiveSource, /recordMismatch\('removeTags'/, 'removeTags is not verified');
});

test('editItem read-back reads project status from .status, not the root task status', () => {
  // Project.taskStatus exists but reports the ROOT TASK's status (Blocked/Next).
  assert.match(primitiveSource, /const raw = String\(item\.status\)/, 'project status verification does not read .status');
  assert.match(primitiveSource, /recordMismatch\('newProjectStatus'/, 'project status is not verified');
});

test('editItem read-back does not report a repeating task as a failed completion', () => {
  assert.match(primitiveSource, /Repeating task: this occurrence was completed/, 'repeating completions are treated as mismatches');
});

test('editItem verification is additive — move_task still gets its existing fields', () => {
  // move_task renders success/id/name/changedProperties; changing or dropping
  // them would break it.
  assert.match(primitiveSource, /changedProperties: changedProperties\.join\(', '\)/, 'changedProperties was dropped from the result');
  assert.match(primitiveSource, /warnings: warnings/, 'warnings was dropped from the result');
  assert.match(primitiveSource, /id: itemId/, 'id was dropped from the result');
});

test('edit_item handler reports a failed read-back instead of a clean success', () => {
  assert.match(definitionSource, /result\.verified === false/, 'handler ignores the verification flag');
  assert.match(definitionSource, /read-back verification failed/, 'handler does not explain a failed verification');
  assert.match(definitionSource, /result\.mismatches/, 'handler does not list the mismatched fields');
});

test('editItem surfaces plannedDate warnings instead of swallowing them', () => {
  assert.match(primitiveSource, /warnings\.push\('plannedDate not supported by this OmniFocus version/, 'plannedDate failure is still swallowed');
  assert.doesNotMatch(primitiveSource, /catch\(e\) \{\}/, 'script still has an empty catch block');
  assert.match(definitionSource, /result\.warnings/, 'handler does not surface script warnings');
});

// --- Mismatch rendering: no UTC leak ---------------------------------------

const UTC_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/;

test('editItem records date mismatches as epoch ms, never as an ISO string', () => {
  // A toISOString() here was rendered verbatim by the handler, putting
  // `expected "2026-03-06T06:00:00.000Z"` in front of the caller — a UTC
  // timestamp for a date the caller gave as local.
  assert.match(primitiveSource, /recordMismatch\(field, want, got, 'date'\)/, 'verifyDate does not record raw epoch ms');
  assert.doesNotMatch(
    primitiveSource,
    /recordMismatch\(\s*field,\s*want === null \? null : new Date\(want\)\.toISOString\(\)/,
    'verifyDate still stores an ISO string in the mismatch'
  );
});

test('edit_item renders a date mismatch in local time, with no Z timestamp', async () => {
  const { handler } = await import('../definitions/editItem.js');
  const expected = new Date(2026, 2, 6, 0, 0, 0).getTime();
  const actual = new Date(2026, 2, 7, 9, 30, 0).getTime();

  const result: any = await handler(
    { id: 't1', itemType: 'task', newDueDate: '2026-03-06' } as any,
    {} as any,
    {
      editItem: async () => ({
        success: true,
        id: 't1',
        name: 'Renew passport',
        changedProperties: 'dueDate',
        verified: false,
        mismatches: [{ field: 'newDueDate', expected, actual, kind: 'date' as const }]
      })
    } as any
  );

  const text = result.content[0].text;
  assert.equal(result.isError, true, 'a failed read-back must not be a clean success');
  assert.doesNotMatch(text, UTC_TIMESTAMP_RE, `rendered mismatch leaked a UTC timestamp: ${text}`);
  assert.ok(text.includes(new Date(expected).toLocaleString()), `expected local rendering in: ${text}`);
  assert.ok(text.includes(new Date(actual).toLocaleString()), `actual local rendering in: ${text}`);
});

test('edit_item renders a cleared date mismatch as "none", not as null or a Z string', async () => {
  const { handler } = await import('../definitions/editItem.js');

  const result: any = await handler(
    { id: 't1', itemType: 'task', newDueDate: '' } as any,
    {} as any,
    {
      editItem: async () => ({
        success: true,
        id: 't1',
        name: 'Renew passport',
        verified: false,
        mismatches: [
          { field: 'newDueDate', expected: null, actual: new Date(2026, 2, 7).getTime(), kind: 'date' as const }
        ]
      })
    } as any
  );

  const text = result.content[0].text;
  assert.match(text, /expected none/);
  assert.doesNotMatch(text, UTC_TIMESTAMP_RE);
});

test('edit_item still renders non-date mismatches as plain values', async () => {
  const { handler } = await import('../definitions/editItem.js');

  const result: any = await handler(
    { id: 't1', itemType: 'task', newFlagged: true } as any,
    {} as any,
    {
      editItem: async () => ({
        success: true,
        id: 't1',
        name: 'Renew passport',
        verified: false,
        mismatches: [{ field: 'newFlagged', expected: true, actual: false }]
      })
    } as any
  );

  assert.match(result.content[0].text, /newFlagged: expected true, got false/);
});
