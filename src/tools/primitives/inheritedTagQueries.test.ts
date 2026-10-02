import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { expandScriptHelpers } from '../../utils/taskQueryHelpers.js';

const readScript = (name: string) => expandScriptHelpers(readFileSync(
  new URL('../../utils/omnifocusScripts/' + name, import.meta.url), 'utf8'));
const tagScript = readScript('tasksByTag.js');
const dumpScript = readScript('omnifocusDump.js');
const statuses = (...names: string[]) => Object.fromEntries(names.map(name => [name, name]));
const enums = {
  Task: { Status: statuses('Available', 'Blocked', 'Completed', 'Dropped', 'DueSoon', 'Next', 'Overdue') },
  Project: { Status: statuses('Active', 'OnHold', 'Done', 'Dropped') },
  Folder: { Status: statuses('Active', 'Dropped') }
};

function tag(id: string, status = 'Active', parent: any = null): any {
  return {
    id: { primaryKey: id }, name: 'Tag ' + id, status, parent, tasks: [],
    get active() { return this.status !== 'Dropped'; },
    get effectiveActive() { return this.active && (!this.parent || this.parent.effectiveActive); }
  };
}

function database() {
  const active = tag('active');
  const activeChild = tag('active-child', 'Active', active);
  const onHold = tag('on-hold', 'OnHold');
  const onHoldChild = tag('on-hold-child', 'Active', onHold);
  const dropped = tag('dropped');
  dropped.status = 'Dropped';
  const nested = tag('nested', 'Active', dropped);
  const deep = tag('deep', 'Active', nested);
  const nestedOnHold = tag('nested-on-hold', 'OnHold', dropped);
  const droppedChild = tag('dropped-child', 'Dropped', active);
  const retained = [active, activeChild, onHold, onHoldChild];
  const excluded = [dropped, nested, deep, nestedOnHold, droppedChild];
  const all = [...excluded, ...retained];
  function task(id: string, taskStatus: string, tag: any): any {
    const t = { id: { primaryKey: id }, name: id, taskStatus, tags: [tag],
      project: null, containingProject: null, parent: null, children: [] };
    tag.tasks.push(t);
    return t;
  }
  return {
    retained, excluded, dropped,
    flattenedTags: all,
    flattenedTasks: [...all.map(t => task(t.id.primaryKey + '-task', 'Blocked', t)),
      task('active-completed', 'Completed', active), task('nested-completed', 'Completed', nested)],
    flattenedProjects: [], flattenedFolders: []
  };
}

function run(script: string, db: ReturnType<typeof database>, args: Record<string, unknown> = {}) {
  const result = JSON.parse(runInNewContext(script, {
    ...enums, ...db, injectedArgs: args, console: { log() {}, error() {} }
  }));
  assert.notEqual(result.success, false, result.error);
  return result;
}

const ids = (items: any[]) => items.map(item => item.id.primaryKey);
const names = (items: any[]) => items.map(item => item.name);

test('tag queries exclude dropped tag branches and retain active and on-hold tags', () => {
  const db = database();
  const result = run(tagScript, db, { tagName: 'Tag' });
  assert.deepEqual(result.matchedTags, names(db.retained));
  assert.deepEqual(result.availableTags, names(db.retained).sort());
  assert.deepEqual(result.tasks.map((t: any) => t.id), ids(db.retained).map(id => id + '-task'));
  for (const tag of db.excluded) {
    const exact = run(tagScript, db, { tagName: tag.name, exactMatch: true });
    assert.deepEqual(exact.matchedTags, []);
    assert.deepEqual(exact.tasks, []);
  }
});

test('showing completed tasks does not re-enable direct or inherited dropped tags', () => {
  const db = database();
  const result = run(tagScript, db, { tagName: 'Tag', hideCompleted: false });
  assert.deepEqual(result.matchedTags, names(db.retained));
  assert.deepEqual(result.tasks.map((t: any) => t.id),
    ['active-task', 'active-completed', 'active-child-task', 'on-hold-task', 'on-hold-child-task']);
});

test('default export excludes dropped tag branches without hiding tasks that carry those tags', () => {
  const db = database();
  const result = run(dumpScript, db);
  assert.deepEqual(Object.keys(result.tags), ids(db.retained));
  assert.equal(result.tags['active-child'].parentTagID, 'active');
  assert.equal(result.tags['on-hold-child'].parentTagID, 'on-hold');
  assert.deepEqual(result.tasks.map((t: any) => t.id), ids(db.flattenedTags).map(id => id + '-task'));
});

test('history export restores dropped tag names, hierarchy and task relationships', () => {
  const db = database();
  const result = run(dumpScript, db, { hideCompleted: false });
  assert.deepEqual(Object.keys(result.tags), ids(db.flattenedTags));
  for (const tag of db.flattenedTags) {
    const exported = result.tags[tag.id.primaryKey];
    assert.equal(exported.name, tag.name);
    assert.equal(exported.parentTagID, tag.parent ? tag.parent.id.primaryKey : null);
    assert.equal(exported.active, tag.active);
    assert.deepEqual(exported.tasks, ids(tag.tasks));
  }
  for (const task of result.tasks) {
    assert.ok(task.tags.every((id: string) => result.tags[id]), 'every historical task tag resolves to its name');
  }
});

test('restoring a dropped tag ancestor restores active and on-hold descendants', () => {
  const db = database();
  db.dropped.status = 'Active';
  const expected = ['dropped', 'nested', 'deep', 'nested-on-hold', ...ids(db.retained)];
  assert.deepEqual(Object.keys(run(dumpScript, db).tags), expected);
  assert.deepEqual(run(tagScript, db, { tagName: 'Tag' }).matchedTags, expected.map(id => 'Tag ' + id));
});
