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

test('editItem surfaces plannedDate warnings instead of swallowing them', () => {
  assert.match(primitiveSource, /warnings\.push\('plannedDate not supported by this OmniFocus version/, 'plannedDate failure is still swallowed');
  assert.doesNotMatch(primitiveSource, /catch\(e\) \{\}/, 'script still has an empty catch block');
  assert.match(definitionSource, /result\.warnings/, 'handler does not surface script warnings');
});
