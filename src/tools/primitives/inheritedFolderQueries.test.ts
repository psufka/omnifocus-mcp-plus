import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { SEARCH_ITEMS_SCRIPT } from './searchItems.js';

const dumpScript = readFileSync(new URL('../../utils/omnifocusScripts/omnifocusDump.js', import.meta.url), 'utf8');
const statuses = (...names: string[]) => Object.fromEntries(names.map(name => [name, name]));
const enums = {
  Task: { Status: statuses('Available', 'Blocked', 'Completed', 'Dropped', 'DueSoon', 'Next', 'Overdue') },
  Project: { Status: statuses('Active', 'OnHold', 'Done', 'Dropped') },
  Folder: { Status: statuses('Active', 'Dropped') },
  Tag: { Status: statuses('Active', 'OnHold', 'Dropped') }
};

function folder(id: string, status = 'Active', parent: any = null): any {
  return {
    id: { primaryKey: id }, name: 'Project ' + id, status, parent,
    // Native Folder.effectiveActive includes every containing folder.
    get effectiveActive() { return this.status === 'Active' && (!this.parent || this.parent.effectiveActive); }
  };
}

function project(id: string, parentFolder: any = null, status = 'Active', deferred = false): any {
  const p: any = { id: { primaryKey: id }, name: 'Project ' + id, status, parentFolder,
    deferDate: deferred ? new Date('2099-01-01T00:00:00Z') : null };
  const nativeTaskStatus = () => {
    if (p.status === 'Done') return 'Completed';
    if (p.status === 'Dropped' || (p.parentFolder && !p.parentFolder.effectiveActive)) return 'Dropped';
    return p.status === 'OnHold' || p.deferDate ? 'Blocked' : 'Next';
  };
  const task = (taskId: string, root: boolean): any => ({
    id: { primaryKey: taskId }, name: 'Project ' + taskId, project: root ? p : null,
    containingProject: p, parent: null, children: [], tags: [],
    // Native Task.taskStatus reflects dropped folder ancestry; Project.status does not.
    get taskStatus() { return nativeTaskStatus(); }
  });
  p.task = task(id + '-root', true);
  const action = task(id + '-action', false);
  action.parent = p.task;
  p.task.children = [action];
  p.flattenedTasks = [p.task, action];
  return p;
}

function database() {
  const active = folder('active-folder');
  const activeChild = folder('active-child', 'Active', active);
  const dropped = folder('dropped-folder');
  dropped.status = 'Dropped';
  const nested = folder('nested-folder', 'Active', dropped);
  const deep = folder('deep-folder', 'Active', nested);
  const droppedChild = folder('dropped-child', 'Dropped', active);
  const excluded = [project('direct', dropped), project('nested', nested), project('deep', deep),
    project('dropped-child-project', droppedChild), project('nested-on-hold', nested, 'OnHold'),
    project('explicit-dropped', null, 'Dropped'), project('completed', null, 'Done')];
  const retained = [project('root'), project('active', activeChild), project('on-hold', active, 'OnHold'),
    project('deferred', active, 'Active', true)];
  return {
    excluded, retained,
    flattenedFolders: [active, activeChild, dropped, nested, deep, droppedChild],
    flattenedProjects: [...excluded, ...retained],
    flattenedTasks: [...excluded, ...retained].flatMap(p => p.flattenedTasks),
    flattenedTags: [{ id: { primaryKey: 'dropped-tag' }, name: 'Project dropped tag', status: 'Dropped', active: false, effectiveActive: false, parent: null }]
  };
}

function search(db: ReturnType<typeof database>, args: Record<string, unknown> = {}) {
  return JSON.parse(runInNewContext('(function () {' + SEARCH_ITEMS_SCRIPT + '})()', {
    ...enums, ...db, args: { query: 'Project', types: ['project'], ...args }
  }));
}

function dump(db: ReturnType<typeof database>, args: Record<string, unknown> = {}) {
  return JSON.parse(runInNewContext(dumpScript, {
    ...enums, ...db, injectedArgs: args, console: { log() {} }
  }));
}

const ids = (items: any[]) => items.map(item => item.id.primaryKey);

test('project search excludes direct and nested dropped-folder projects before counting and limiting', () => {
  const db = database();
  const result = search(db, { limitPerType: 2 }).results.project;
  assert.equal(result.totalMatched, db.retained.length);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.items.map((p: any) => p.id), ids(db.retained.slice(0, 2)));
});

test('project search keeps root, active, on-hold and deferred projects', () => {
  const db = database();
  const result = search(db).results.project;
  assert.deepEqual(result.items.map((p: any) => [p.id, p.status]),
    [['root', 'active'], ['active', 'active'], ['on-hold', 'on_hold'], ['deferred', 'active']]);
  assert.equal(result.truncated, false);
});

test('project history search restores dropped descendants and preserves their explicit status', () => {
  const db = database();
  const result = search(db, { includeCompleted: true }).results.project;
  assert.deepEqual(result.items.map((p: any) => p.id), ids(db.flattenedProjects));
  assert.equal(result.totalMatched, db.flattenedProjects.length);
  assert.equal(result.items.find((p: any) => p.id === 'nested').status, 'active');
  assert.equal(result.items.find((p: any) => p.id === 'nested-on-hold').status, 'on_hold');
});

test('search folder and tag inventory still includes dropped items', () => {
  const db = database();
  const result = search(db, { types: ['folder', 'tag'] }).results;
  assert.deepEqual(result.folder.items.map((f: any) => f.id), ids(db.flattenedFolders));
  assert.deepEqual(result.tag.items.map((t: any) => t.id), ['dropped-tag']);
});

test('default export omits whole dropped folder branches while retaining reviewable projects', () => {
  const db = database();
  const result = dump(db);
  assert.deepEqual(Object.keys(result.projects), ids(db.retained));
  assert.deepEqual(Object.keys(result.folders), ['active-folder', 'active-child']);
  assert.deepEqual(result.tasks.map((t: any) => t.id), ids(db.retained.flatMap(p => p.flattenedTasks)));
  assert.equal(result.projects.root.folderID, null);
  assert.equal(result.projects['on-hold'].status, 'OnHold');
  assert.equal(result.projects.deferred.deferDate, '2099-01-01T00:00:00.000Z');
  assert.deepEqual(result.folders['active-folder'].subfolders, ['active-child']);
  assert.deepEqual(result.folders['active-child'].projects, ['active']);
  for (const p of Object.values(result.projects) as any[]) {
    assert.ok(p.folderID === null || result.folders[p.folderID], 'every exported project has its containing folder');
  }
});

test('history export restores dropped folder hierarchy, projects and tasks', () => {
  const db = database();
  const result = dump(db, { hideCompleted: false });
  assert.deepEqual(Object.keys(result.projects), ids(db.flattenedProjects));
  assert.deepEqual(Object.keys(result.folders), ids(db.flattenedFolders));
  assert.deepEqual(result.tasks.map((t: any) => t.id).sort(), ids(db.flattenedTasks).sort());
  assert.deepEqual(result.folders['dropped-folder'].subfolders, ['nested-folder']);
  assert.deepEqual(result.folders['nested-folder'].subfolders, ['deep-folder']);
  assert.deepEqual(result.folders['deep-folder'].projects, ['deep']);
  assert.equal(result.projects.nested.status, 'Active');
  assert.equal(result.completedSummary.totalOmitted, 0);
});

test('restoring a dropped ancestor restores its active descendants in search and export', () => {
  const db = database();
  db.flattenedFolders.find(f => f.id.primaryKey === 'dropped-folder').status = 'Active';
  const expected = ['direct', 'nested', 'deep', 'nested-on-hold', ...ids(db.retained)];
  assert.deepEqual(search(db).results.project.items.map((p: any) => p.id), expected);
  assert.deepEqual(Object.keys(dump(db).projects), expected);
});
