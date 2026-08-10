import assert from 'node:assert/strict';
import test from 'node:test';

import { REMOVE_ITEM_SCRIPT, removeItem } from './removeItem.js';

// ---------------------------------------------------------------------------
// remove_item behavior harness.
//
// The script only references OmniJS globals, so `new Function` plus a fake
// object model runs the REAL source — lookup rules and the post-delete
// read-back included — with no OmniFocus and no osascript. Nothing here
// touches a real database.
// ---------------------------------------------------------------------------

function makeWorld() {
  const tasks: any[] = [];
  const projects: any[] = [];
  let seq = 0;

  function add(collection: any[], prefix: string, name: string, extra: Record<string, any> = {}) {
    const item = { id: { primaryKey: `${prefix}${++seq}` }, name, ...extra };
    collection.push(item);
    return item;
  }

  const globals = {
    flattenedTasks: tasks,
    flattenedProjects: projects,
    Task: { byIdentifier: (id: string) => tasks.find(t => t.id.primaryKey === id) ?? null },
    Project: { byIdentifier: (id: string) => projects.find(p => p.id.primaryKey === id) ?? null },
    deleteObject(obj: any) {
      for (const collection of [tasks, projects]) {
        const at = collection.indexOf(obj);
        if (at !== -1) {
          collection.splice(at, 1);
          return;
        }
      }
      throw new Error('object is not in the database');
    }
  };

  return {
    tasks,
    projects,
    globals,
    addTask: (name: string, extra?: Record<string, any>) => add(tasks, 't', name, extra),
    addProject: (name: string, extra?: Record<string, any>) => add(projects, 'p', name, extra)
  };
}

const GLOBAL_NAMES = ['flattenedTasks', 'flattenedProjects', 'Task', 'Project', 'deleteObject'] as const;

function runRemove(world: ReturnType<typeof makeWorld>, args: any): any {
  const fn = new Function('args', ...GLOBAL_NAMES, REMOVE_ITEM_SCRIPT);
  return JSON.parse(fn(args, ...GLOBAL_NAMES.map(name => (world.globals as any)[name])));
}

test('remove_item deletes the task and verifies the id no longer resolves', () => {
  const world = makeWorld();
  const doomed = world.addTask('Doomed');
  world.addTask('Survivor');

  const out = runRemove(world, { itemType: 'task', id: doomed.id.primaryKey });

  assert.equal(out.success, true, JSON.stringify(out));
  assert.equal(out.verified, true);
  assert.equal(out.name, 'Doomed');
  assert.deepEqual(world.tasks.map(t => t.name), ['Survivor']);
});

test('remove_item reports a delete that did not take as a failure', () => {
  // Without the in-script read-back this returned "removed successfully" for an
  // item that is still in the database — the exact bug its batch sibling
  // already guarded against.
  const world = makeWorld();
  const stubborn = world.addTask('Stubborn');
  (world.globals as any).deleteObject = () => { /* pretend the delete silently no-ops */ };

  const out = runRemove(world, { itemType: 'task', id: stubborn.id.primaryKey });

  assert.equal(out.success, false, 'an unverified delete was reported as success');
  assert.equal(out.verified, false);
  assert.match(out.error, /still resolves after deleteObject/);
  assert.equal(world.tasks.length, 1);
});

test('remove_item verifies project deletion too', () => {
  const world = makeWorld();
  const project = world.addProject('Old project', { status: '[object Project.Status: Active]' });

  const out = runRemove(world, { itemType: 'project', id: project.id.primaryKey });

  assert.equal(out.success, true, JSON.stringify(out));
  assert.equal(out.verified, true);
  assert.equal(world.projects.length, 0);
});

test('remove_item still refuses a stale id instead of falling back to the name', () => {
  const world = makeWorld();
  world.addTask('Keep me');

  const out = runRemove(world, { itemType: 'task', id: 'no-such-id', name: 'Keep me' });

  assert.equal(out.success, false);
  assert.match(out.error, /not found with ID/i);
  assert.equal(world.tasks.length, 1, 'a stale id deleted a same-named item');
});

test('remove_item requires an id or a name before it runs any script', async () => {
  const result = await removeItem({ itemType: 'task' });
  assert.equal(result.success, false);
  assert.match(String(result.error), /Either id or name/);
});
