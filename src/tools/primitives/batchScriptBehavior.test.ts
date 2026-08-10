import assert from 'node:assert/strict';
import test from 'node:test';

import { BATCH_ADD_ITEMS_SCRIPT, prepareBatchItems } from './batchAddItems.js';
import { BATCH_REMOVE_ITEMS_SCRIPT, prepareRemoveItems } from './batchRemoveItems.js';
import { BATCH_MOVE_TASKS_SCRIPT } from './batchMoveTasks.js';

// ---------------------------------------------------------------------------
// A fake OmniFocus object model.
//
// The batch scripts are plain JavaScript that only reference OmniJS globals, so
// they can be compiled with `new Function` and handed those globals as
// parameters. That runs the REAL script source — dry-run gating, tempId
// hierarchy, atomic rollback, post-write verification — with no OmniFocus and
// no osascript anywhere. Nothing here mutates a real database.
//
// The model mirrors the API facts the scripts rely on:
//   - Task/Project.byIdentifier returns the object or null (never throws)
//   - a project's root task shares the project's primaryKey
//   - inInbox is true only for a DIRECT child of the inbox
//   - flattenedX excludes project root tasks
// ---------------------------------------------------------------------------

type Loc =
  | { kind: 'inbox' }
  | { kind: 'library' }
  | { kind: 'task'; obj: any }
  | { kind: 'project'; obj: any }
  | { kind: 'folder'; obj: any };

function makeWorld() {
  const tasks: any[] = [];
  const projects: any[] = [];
  const tags: any[] = [];
  const folders: any[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${++seq}`;

  class Task {
    id: { primaryKey: string };
    name: string;
    parent: any = null;
    containingProject: any = null;
    inInbox = false;
    tags: any[] = [];

    constructor(name: string, location: Loc) {
      this.id = { primaryKey: nextId('t') };
      this.name = name;
      attach(this, location);
      tasks.push(this);
    }

    get ending(): Loc {
      return { kind: 'task', obj: this };
    }

    addTag(tag: any) {
      this.tags.push(tag);
    }
  }

  class Project {
    id: { primaryKey: string };
    name: string;
    parentFolder: any = null;
    task: any;
    tags: any[] = [];

    constructor(name: string, location: Loc) {
      this.id = { primaryKey: nextId('p') };
      this.name = name;
      this.parentFolder = location.kind === 'folder' ? location.obj : null;
      // The project's root task shares the project's primaryKey.
      this.task = Object.create(Task.prototype);
      this.task.id = this.id;
      this.task.name = name;
      projects.push(this);
    }

    get ending(): Loc {
      return { kind: 'project', obj: this };
    }

    addTag(tag: any) {
      this.tags.push(tag);
    }
  }

  class Tag {
    id: { primaryKey: string };
    name: string;
    constructor(name: string) {
      this.id = { primaryKey: nextId('g') };
      this.name = name;
      tags.push(this);
    }
  }

  class Folder {
    id: { primaryKey: string };
    name: string;
    constructor(name: string) {
      this.id = { primaryKey: nextId('f') };
      this.name = name;
      folders.push(this);
    }
    get ending(): Loc {
      return { kind: 'folder', obj: this };
    }
  }

  function attach(task: any, location: Loc) {
    if (location.kind === 'inbox') {
      task.parent = null;
      task.containingProject = null;
      task.inInbox = true;
      return;
    }
    if (location.kind === 'task') {
      task.parent = location.obj;
      task.containingProject = location.obj.containingProject;
      task.inInbox = false;
      return;
    }
    if (location.kind === 'project') {
      task.parent = location.obj.task;
      task.containingProject = location.obj;
      task.inInbox = false;
      return;
    }
    throw new Error(`tasks cannot be attached to ${location.kind}`);
  }

  (Task as any).byIdentifier = (id: string) => tasks.find(t => t.id.primaryKey === id) ?? null;
  (Project as any).byIdentifier = (id: string) => projects.find(p => p.id.primaryKey === id) ?? null;
  (Tag as any).byIdentifier = (id: string) => tags.find(t => t.id.primaryKey === id) ?? null;
  (Folder as any).byIdentifier = (id: string) => folders.find(f => f.id.primaryKey === id) ?? null;

  function deleteObject(obj: any) {
    for (const collection of [tasks, projects, tags, folders]) {
      const at = collection.indexOf(obj);
      if (at !== -1) {
        collection.splice(at, 1);
        return;
      }
    }
    throw new Error('object is not in the database');
  }

  function moveTasks(list: any[], location: Loc) {
    for (const task of list) attach(task, location);
  }

  const globals = {
    flattenedTasks: tasks,
    flattenedProjects: projects,
    flattenedTags: tags,
    flattenedFolders: folders,
    inbox: { get ending(): Loc { return { kind: 'inbox' }; } },
    library: { get ending(): Loc { return { kind: 'library' }; } },
    Task,
    Project,
    Tag,
    Folder,
    deleteObject,
    moveTasks
  };

  return {
    tasks,
    projects,
    tags,
    folders,
    globals,
    addTask(name: string, location: Loc = { kind: 'inbox' }) {
      return new Task(name, location);
    },
    addProject(name: string, location: Loc = { kind: 'library' }) {
      return new Project(name, location);
    },
    addTag(name: string) {
      return new Tag(name);
    },
    addFolder(name: string) {
      return new Folder(name);
    }
  };
}

const GLOBAL_NAMES = [
  'flattenedTasks', 'flattenedProjects', 'flattenedTags', 'flattenedFolders',
  'inbox', 'library', 'Task', 'Project', 'Tag', 'Folder', 'deleteObject', 'moveTasks'
] as const;

function runScript(script: string, world: ReturnType<typeof makeWorld>, args: any): any {
  const fn = new Function('args', ...GLOBAL_NAMES, script);
  const raw = fn(args, ...GLOBAL_NAMES.map(name => (world.globals as any)[name]));
  return JSON.parse(raw);
}

function runAdd(world: ReturnType<typeof makeWorld>, items: any[], options: any = {}) {
  return runScript(BATCH_ADD_ITEMS_SCRIPT, world, {
    items: prepareBatchItems(items),
    dryRun: options.dryRun === true,
    stopOnError: options.stopOnError === true || options.atomic === true,
    atomic: options.atomic === true
  });
}

function runRemove(world: ReturnType<typeof makeWorld>, items: any[], options: any = {}) {
  return runScript(BATCH_REMOVE_ITEMS_SCRIPT, world, {
    items: prepareRemoveItems(items),
    dryRun: options.dryRun === true
  });
}

function runMove(world: ReturnType<typeof makeWorld>, params: any) {
  return runScript(BATCH_MOVE_TASKS_SCRIPT, world, params);
}

// --- batch_add_items: dryRun ------------------------------------------------

test('batch_add dryRun writes nothing but resolves every destination', () => {
  const world = makeWorld();
  world.addProject('Work');

  const out = runAdd(world, [
    { itemType: 'task', name: 'Inbox thing' },
    { itemType: 'task', name: 'Work thing', projectName: 'Work' },
    { itemType: 'project', name: 'New project' }
  ], { dryRun: true });

  assert.equal(out.dryRun, true);
  assert.equal(world.tasks.length, 0, 'dryRun created a task');
  assert.equal(world.projects.length, 1, 'dryRun created a project');

  assert.deepEqual(out.results.map((r: any) => r.status), ['planned', 'planned', 'planned']);
  assert.equal(out.results[0].wouldCreate.destination.kind, 'inbox');
  assert.equal(out.results[1].wouldCreate.destination.kind, 'project');
  assert.equal(out.results[1].wouldCreate.destination.name, 'Work');
  assert.equal(out.results[2].wouldCreate.destination.kind, 'library');
});

test('batch_add dryRun reports an unresolvable destination per item, still writing nothing', () => {
  const world = makeWorld();

  const out = runAdd(world, [
    { itemType: 'task', name: 'A', projectName: 'Nope' },
    { itemType: 'task', name: 'B' }
  ], { dryRun: true });

  assert.equal(out.results[0].success, false);
  assert.match(out.results[0].error, /Project not found with name: Nope/);
  assert.equal(out.results[1].status, 'planned');
  assert.equal(world.tasks.length, 0);
});

test('batch_add dryRun names the tags it would create without creating them', () => {
  const world = makeWorld();
  world.addTag('existing');

  const out = runAdd(world, [
    { itemType: 'task', name: 'A', tags: ['existing', 'brand-new'] }
  ], { dryRun: true });

  assert.deepEqual(out.results[0].wouldCreate.tagsToCreate, ['brand-new']);
  assert.equal(world.tags.length, 1, 'dryRun created a tag');
});

test('batch_add dryRun resolves a parentTempId against the earlier planned item', () => {
  const world = makeWorld();

  const out = runAdd(world, [
    { itemType: 'project', name: 'Parent project', tempId: 'p1' },
    { itemType: 'task', name: 'Child', parentTempId: 'p1' }
  ], { dryRun: true });

  assert.equal(out.results[1].status, 'planned');
  assert.equal(out.results[1].wouldCreate.destination.tempId, 'p1');
  assert.equal(out.results[1].wouldCreate.destination.pending, true);
  assert.equal(world.projects.length, 0);
});

// --- batch_add_items: real writes + verification -----------------------------

test('batch_add creates items and verifies each landed where requested', () => {
  const world = makeWorld();
  world.addProject('Work');

  const out = runAdd(world, [
    { itemType: 'task', name: 'Inbox thing' },
    { itemType: 'task', name: 'Work thing', projectName: 'Work' }
  ]);

  assert.equal(out.dryRun, false);
  assert.equal(world.tasks.length, 2);
  assert.ok(out.results.every((r: any) => r.success && r.verified === true && r.status === 'ok'));
  assert.equal(out.results[0].placement.kind, 'inbox');
  assert.equal(out.results[1].placement.kind, 'project');
  assert.equal(out.results[1].placement.name, 'Work');
});

test('batch_add verification is what catches a task silently landing in the inbox', () => {
  // Simulates the upstream bug: the write goes to the inbox even though a
  // project was requested. Verification must call that out instead of
  // reporting a clean success.
  const world = makeWorld();
  world.addProject('Work');
  const inboxLocation = { kind: 'inbox' as const };
  const OriginalTask = world.globals.Task as any;
  function DriftingTask(this: any, name: string, _location: any) {
    return new OriginalTask(name, inboxLocation);
  }
  DriftingTask.prototype = OriginalTask.prototype;
  DriftingTask.byIdentifier = OriginalTask.byIdentifier;
  (world.globals as any).Task = DriftingTask;

  const out = runAdd(world, [{ itemType: 'task', name: 'Work thing', projectName: 'Work' }]);

  assert.equal(out.results[0].success, true, 'the object was created, so it is not a hard failure');
  assert.equal(out.results[0].verified, false);
  assert.match(out.results[0].warning, /requested project "Work" but the task is in the inbox/);
});

test('batch_add atomic rolls back when a placement verification fails', () => {
  // Same drift as the test above, but under atomic: the task exists and yet is
  // in the wrong container. Reporting success there strands a misplaced task in
  // a batch that promised all-or-nothing, so the failed verification has to
  // trigger the rollback.
  const world = makeWorld();
  world.addProject('Work');
  const inboxLocation = { kind: 'inbox' as const };
  const OriginalTask = world.globals.Task as any;
  function DriftingTask(this: any, name: string, _location: any) {
    return new OriginalTask(name, inboxLocation);
  }
  DriftingTask.prototype = OriginalTask.prototype;
  DriftingTask.byIdentifier = OriginalTask.byIdentifier;
  (world.globals as any).Task = DriftingTask;

  const out = runAdd(world, [
    { itemType: 'project', name: 'Launch', tempId: 'proj' },
    { itemType: 'task', name: 'Work thing', projectName: 'Work' }
  ], { atomic: true });

  assert.equal(out.rolledBack, true, 'a misplaced item did not trigger the atomic rollback');
  assert.equal(out.results[1].success, false, 'a misplaced item was reported as a success');
  assert.equal(out.results[1].status, 'failed');
  assert.equal(out.results[1].verified, false);
  assert.match(out.results[1].error, /requested project "Work" but the task is in the inbox/);
  assert.equal(out.results[0].status, 'rolledBack');
  assert.equal(world.tasks.length, 0, 'rollback left the misplaced task behind');
  assert.deepEqual(
    world.projects.map(p => p.name),
    ['Work'],
    'rollback should delete the batch-created project and leave the pre-existing one'
  );
  assert.deepEqual(out.mapping, {});
});

test('batch_add without atomic keeps a misplaced item and only warns', () => {
  // Non-atomic behavior is unchanged: the object exists, so it is kept, the
  // item still counts as a success, and the mismatch rides along as a warning.
  const world = makeWorld();
  world.addProject('Work');
  const inboxLocation = { kind: 'inbox' as const };
  const OriginalTask = world.globals.Task as any;
  function DriftingTask(this: any, name: string, _location: any) {
    return new OriginalTask(name, inboxLocation);
  }
  DriftingTask.prototype = OriginalTask.prototype;
  DriftingTask.byIdentifier = OriginalTask.byIdentifier;
  (world.globals as any).Task = DriftingTask;

  const out = runAdd(world, [{ itemType: 'task', name: 'Work thing', projectName: 'Work' }]);

  assert.equal(out.rolledBack, false);
  assert.equal(out.results[0].success, true);
  assert.equal(out.results[0].verified, false);
  assert.equal(world.tasks.length, 1);
});

test('batch_add builds a hierarchy from tempId/parentTempId and returns the mapping', () => {
  const world = makeWorld();

  const out = runAdd(world, [
    { itemType: 'project', name: 'Launch', tempId: 'proj' },
    { itemType: 'task', name: 'Phase 1', parentTempId: 'proj', tempId: 'phase' },
    { itemType: 'task', name: 'Step A', parentTempId: 'phase' }
  ]);

  assert.ok(out.results.every((r: any) => r.success), JSON.stringify(out.results));

  const project = world.projects[0];
  const phase = world.tasks.find(t => t.name === 'Phase 1');
  const step = world.tasks.find(t => t.name === 'Step A');

  assert.equal(phase.containingProject, project);
  assert.equal(step.parent, phase);
  assert.ok(out.results.every((r: any) => r.verified === true));

  assert.equal(out.mapping.proj, project.id.primaryKey);
  assert.equal(out.mapping.phase, phase.id.primaryKey);
});

// --- batch_add_items: stopOnError / atomic -----------------------------------

test('batch_add stopOnError marks the remaining items skipped', () => {
  const world = makeWorld();

  const out = runAdd(world, [
    { itemType: 'task', name: 'A' },
    { itemType: 'task', name: 'B', projectName: 'Missing' },
    { itemType: 'task', name: 'C' }
  ], { stopOnError: true });

  assert.deepEqual(out.results.map((r: any) => r.status), ['ok', 'failed', 'skipped']);
  assert.equal(out.rolledBack, false);
  assert.equal(world.tasks.length, 1, 'the item created before the failure stays without atomic');
  assert.match(out.results[2].error, /Skipped/);
});

test('batch_add continues past failures by default', () => {
  const world = makeWorld();

  const out = runAdd(world, [
    { itemType: 'task', name: 'A' },
    { itemType: 'task', name: 'B', projectName: 'Missing' },
    { itemType: 'task', name: 'C' }
  ]);

  assert.deepEqual(out.results.map((r: any) => r.status), ['ok', 'failed', 'ok']);
  assert.equal(world.tasks.length, 2);
});

test('batch_add atomic deletes everything it created, in the same script', () => {
  const world = makeWorld();

  const out = runAdd(world, [
    { itemType: 'project', name: 'Launch', tempId: 'proj' },
    { itemType: 'task', name: 'Phase 1', parentTempId: 'proj' },
    { itemType: 'task', name: 'Bad', projectName: 'Missing' },
    { itemType: 'task', name: 'Never' }
  ], { atomic: true });

  assert.equal(out.rolledBack, true);
  assert.equal(world.tasks.length, 0, 'rollback left tasks behind');
  assert.equal(world.projects.length, 0, 'rollback left projects behind');
  assert.deepEqual(out.results.map((r: any) => r.status), ['rolledBack', 'rolledBack', 'failed', 'skipped']);
  assert.ok(out.results.every((r: any) => r.success === false));
  assert.deepEqual(out.mapping, {}, 'rolled-back ids must not be handed back as a mapping');
  assert.deepEqual(out.rollbackErrors, []);
});

test('batch_add atomic rollback also removes tags it created along the way', () => {
  const world = makeWorld();
  world.addTag('keep-me');

  const out = runAdd(world, [
    { itemType: 'task', name: 'A', tags: ['keep-me', 'made-by-batch'] },
    { itemType: 'task', name: 'B', projectName: 'Missing' }
  ], { atomic: true });

  assert.equal(out.rolledBack, true);
  assert.deepEqual(world.tags.map(t => t.name), ['keep-me']);
});

test('batch_add without atomic never rolls back', () => {
  const world = makeWorld();

  const out = runAdd(world, [
    { itemType: 'task', name: 'A' },
    { itemType: 'task', name: 'B', projectName: 'Missing' }
  ]);

  assert.equal(out.rolledBack, false);
  assert.equal(world.tasks.length, 1);
});

// --- batch_remove_items ------------------------------------------------------

test('batch_remove dryRun resolves each item and deletes nothing', () => {
  const world = makeWorld();
  const keep = world.addTask('Keep me');

  const out = runRemove(world, [
    { itemType: 'task', id: keep.id.primaryKey },
    { itemType: 'task', name: 'Ghost' }
  ], { dryRun: true });

  assert.equal(out.dryRun, true);
  assert.equal(world.tasks.length, 1);
  assert.equal(out.results[0].status, 'planned');
  assert.deepEqual(out.results[0].wouldRemove, { itemType: 'task', id: keep.id.primaryKey, name: 'Keep me' });
  assert.equal(out.results[1].success, false);
  assert.match(out.results[1].error, /not found with name: Ghost/);
});

test('batch_remove deletes and verifies the id no longer resolves', () => {
  const world = makeWorld();
  const doomed = world.addTask('Doomed');
  world.addTask('Survivor');

  const out = runRemove(world, [{ itemType: 'task', id: doomed.id.primaryKey }]);

  assert.equal(out.results[0].success, true);
  assert.equal(out.results[0].verified, true);
  assert.deepEqual(world.tasks.map(t => t.name), ['Survivor']);
});

test('batch_remove reports a delete that did not take as a failure', () => {
  const world = makeWorld();
  const stubborn = world.addTask('Stubborn');
  (world.globals as any).deleteObject = () => { /* pretend the delete silently no-ops */ };

  const out = runRemove(world, [{ itemType: 'task', id: stubborn.id.primaryKey }]);

  assert.equal(out.results[0].success, false);
  assert.equal(out.results[0].verified, false);
  assert.match(out.results[0].error, /still resolves after deleteObject/);
});

// --- batch_move_tasks --------------------------------------------------------

test('batch_move dryRun reports from/to and moves nothing', () => {
  const world = makeWorld();
  const project = world.addProject('Work');
  const task = world.addTask('Wandering');

  const out = runMove(world, {
    tasks: [{ id: task.id.primaryKey }],
    targetProjectName: 'Work',
    dryRun: true
  });

  assert.equal(out.dryRun, true);
  assert.equal(out.results[0].status, 'planned');
  assert.equal(out.results[0].wouldMove.from.kind, 'inbox');
  assert.equal(out.results[0].wouldMove.to.kind, 'project');
  assert.equal(out.results[0].wouldMove.to.name, 'Work');
  assert.equal(task.containingProject, null, 'dryRun moved the task');
  assert.equal(world.projects[0], project);
});

test('batch_move moves and verifies the new container', () => {
  const world = makeWorld();
  world.addProject('Work');
  const task = world.addTask('Wandering');

  const out = runMove(world, { tasks: [{ id: task.id.primaryKey }], targetProjectName: 'Work' });

  assert.equal(out.results[0].success, true);
  assert.equal(out.results[0].verified, true);
  assert.equal(out.results[0].placement.kind, 'project');
  assert.equal(task.containingProject.name, 'Work');
});

test('batch_move flags a move that did not land in the destination', () => {
  const world = makeWorld();
  world.addProject('Work');
  const task = world.addTask('Wandering');
  (world.globals as any).moveTasks = () => { /* pretend the move silently no-ops */ };

  const out = runMove(world, { tasks: [{ id: task.id.primaryKey }], targetProjectName: 'Work' });

  assert.equal(out.results[0].verified, false);
  assert.match(out.results[0].warning, /requested project "Work" but the task is in the inbox/);
});

test('batch_move still refuses to move a task into its own descendant', () => {
  const world = makeWorld();
  const parent = world.addTask('Parent');
  const child = new (world.globals.Task as any)('Child', { kind: 'task', obj: parent });

  const out = runMove(world, {
    tasks: [{ id: parent.id.primaryKey }],
    targetParentTaskId: child.id.primaryKey
  });

  assert.equal(out.results[0].success, false);
  assert.match(out.results[0].error, /cannot move a task into itself or its descendants/);
});

test('batch_move to the inbox verifies as inbox', () => {
  const world = makeWorld();
  const project = world.addProject('Work');
  const task = new (world.globals.Task as any)('Filed', { kind: 'project', obj: project });

  const out = runMove(world, { tasks: [{ id: task.id.primaryKey }], targetInbox: true });

  assert.equal(out.results[0].verified, true);
  assert.equal(task.inInbox, true);
});
