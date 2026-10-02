import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildPerspectiveWindowScript } from './perspectiveWindow.js';
import { injectScriptParameters } from './scriptExecution.js';
import { collectToolResult } from './toolResult.js';
import { handler } from '../tools/definitions/getCustomPerspectiveTasks.js';

const source = readFileSync(new URL('./omnifocusScripts/getCustomPerspectiveTasks.js', import.meta.url), 'utf8');

type Outline = { id: string | null; children: Outline[] };
const row = (id: string | null, children: Outline[] = []): Outline => ({ id, children });

function fixture(options: {
  name?: string; nodes?: Outline[]; known?: boolean; noWindows?: boolean;
  readError?: boolean; detailError?: boolean; closeError?: boolean;
  creationError?: boolean; inheritedSearch?: string;
} = {}) {
  const name = options.name ?? 'Today';
  const nodes = options.nodes ?? [row(null, [row('task')])];
  const perspective = { name, identifier: 'saved-perspective' };
  const user = Object.freeze({ id: () => 10, searchTerm: () => 'qrg',
    perspectiveName: () => 'Search', focus: ['unrelated-project'], selected: ['other-task'] });
  const windows: any[] = options.noWindows ? [] : [user];
  const events: string[] = [];
  const tasks: Record<string, any> = {};
  const statuses = { Available: Symbol('Available'), Completed: Symbol('Completed'), Dropped: Symbol('Dropped') };
  const addTask = (id: string, project: any = null) => {
    tasks[id] = { id: { primaryKey: id }, name: id, project, containingProject: { name: 'Project' },
      note: '', tags: [], completed: false, flagged: false, taskStatus: statuses.Available };
    return tasks[id];
  };
  for (const id of ['task', 'child', 'other']) addTask(id);
  addTask('project-root', { name: 'Project' });
  const Task = { Status: statuses, byIdentifier: (id: string) => {
    if (options.detailError) throw new Error('task detail failure');
    return tasks[id] ?? null;
  } };
  const nativeNode = (n: Outline): any => ({ id: () => n.id, trees: () => n.children.map(nativeNode) });
  let temp: any;
  const doc = { documentWindows: {
    push(w: any) {
      events.push('create');
      if (options.creationError) throw new Error('window creation failure');
      windows.push(w); // Deliberately NOT first: collection must use its ID.
    },
    byId(id: number) { events.push(`lookup:${id}`); return windows.find(w => w.id() === id); }
  } };
  const app = {
    defaultDocument: doc,
    DocumentWindow(properties: any) {
      assert.equal(properties.perspectiveName, name);
      let search = options.inheritedSearch ?? '';
      temp = {
        id: () => 20,
        exists: () => windows.includes(temp),
        get searchTerm() { return () => search; },
        set searchTerm(value: any) { search = value; },
        content: { trees() {
          events.push('read');
          if (options.readError) throw new Error('outline read failure');
          return search ? [] : nodes.map(nativeNode);
        } },
        close() {
          events.push('close');
          if (options.closeError) throw new Error('close failure');
          windows.splice(windows.indexOf(temp), 1);
        }
      };
      return temp;
    },
    evaluateJavascript(script: string) {
      // The real collector must not inspect or change the user's window.
      return runInNewContext(script, {
        Perspective: { Custom: { byName: (n: string) => options.known === false || n !== name ? null : perspective } },
        Task,
        document: { get windows() { throw new Error('User window must not be accessed'); } }
      });
    }
  };
  return { user, windows, events, tasks, run() {
    const injected = injectScriptParameters(source, { perspectiveName: name });
    const wrapper = buildPerspectiveWindowScript(injected, name);
    return JSON.parse(runInNewContext(wrapper + '\nrun();', { Application: () => app }));
  } };
}

test('active user search, focus and selection do not filter a saved perspective', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.success, true, result.error);
  assert.equal(result.count, 1);
  assert.equal(result.taskMap.task.name, 'task');
  assert.deepEqual(f.windows, [f.user]);
  assert.equal(f.user.searchTerm(), 'qrg');
  assert.equal(f.user.perspectiveName(), 'Search');
  assert.deepEqual(f.events, ['create', 'lookup:20', 'read', 'close']);
});

test('clears a search inherited by the temporary window only', () => {
  const f = fixture({ inheritedSearch: 'stale search' });
  assert.equal(f.run().count, 1);
  assert.equal(f.user.searchTerm(), 'qrg');
});

test('preserves hierarchy through group headings and skips project roots and non-task IDs', () => {
  const f = fixture({ nodes: [row('project-root', [row('task', [row(null, [row('child')])])]), row('tag', [row('other')])] });
  const result = f.run();
  assert.equal(result.count, 3);
  assert.equal(result.taskMap.task.parent, null);
  assert.deepEqual(result.taskMap.task.children, ['child']);
  assert.equal(result.taskMap.child.parent, 'task');
  assert.equal(result.taskMap.other.parent, null);
});

test('an actually empty perspective is still a successful empty result', () => {
  const f = fixture({ nodes: [] });
  const result = f.run();
  assert.equal(result.success, true);
  assert.equal(result.count, 0);
  assert.deepEqual(f.windows, [f.user]);
});

test('works with no pre-existing document window', () => {
  const f = fixture({ noWindows: true });
  assert.equal(f.run().count, 1);
  assert.deepEqual(f.windows, []);
});

test('unknown perspective fails before creating a window', () => {
  const f = fixture({ known: false });
  const result = f.run();
  assert.equal(result.success, false);
  assert.match(result.error, /No custom perspective/);
  assert.deepEqual(f.events, []);
});

for (const kind of ['readError', 'detailError', 'creationError'] as const) {
  test(`${kind} returns an error and leaves the original windows intact`, () => {
    const f = fixture({ [kind]: true });
    const result = f.run();
    assert.equal(result.success, false);
    assert.match(result.error, /failure/);
    assert.deepEqual(f.windows, [f.user]);
    if (kind !== 'creationError') assert.equal(f.events.at(-1), 'close');
  });
}

test('cleanup failure is reported rather than returning silent success', () => {
  const f = fixture({ closeError: true });
  const result = f.run();
  assert.equal(result.success, false);
  assert.match(result.error, /Could not close the temporary perspective window/);
  assert.equal(f.windows[0], f.user);
});

test('cleanup failure retains the original read failure', () => {
  const result = fixture({ readError: true, closeError: true }).run();
  assert.match(result.error, /outline read failure/);
  assert.match(result.error, /close failure/);
});

test('cleanup failure retains an error returned by the OmniJS collector', () => {
  const result = fixture({ detailError: true, closeError: true }).run();
  assert.match(result.error, /task detail failure/);
  assert.match(result.error, /close failure/);
});

test('perspective names and task text survive quotes, backticks, dollars and newlines', () => {
  const special = 'Today " \\ ` ${notCode} $&\nnext';
  const f = fixture({ name: special });
  f.tasks.task.note = special;
  const result = f.run();
  assert.equal(result.success, true, result.error);
  assert.equal(result.perspectiveName, special);
  assert.equal(result.taskMap.task.note, special);
});

test('collector refuses to fall back to a user window without an isolated outline', () => {
  const injected = injectScriptParameters(source, { perspectiveName: 'Today' });
  const result = JSON.parse(runInNewContext(injected, {
    Perspective: { Custom: { byName: () => ({ identifier: 'perspective' }) } },
    document: { get windows() { throw new Error('Do not read the user window'); } }
  }));
  assert.equal(result.success, false);
  assert.match(result.error, /isolated perspective outline/);
});

test('perspective read failures are MCP errors, not successful empty results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'perspective-error-'));
  const bin = join(dir, 'osascript');
  writeFileSync(bin, '#!/bin/sh\ncat >/dev/null\nprintf \'%s\' \'{"success":false,"error":"mock outline failure"}\'\n', { mode: 0o700 });
  const beforeBin = process.env.OMNIFOCUS_OSASCRIPT_BIN;
  const beforeState = process.env.OMNIFOCUS_MCP_STATE_DIR;
  process.env.OMNIFOCUS_OSASCRIPT_BIN = bin;
  process.env.OMNIFOCUS_MCP_STATE_DIR = join(dir, 'state');
  try {
    const result = await collectToolResult('get_custom_perspective_tasks', () => handler({ perspectiveName: 'Today' }, {} as any));
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.success, false);
    assert.equal(result.structuredContent.data.error, 'mock outline failure');
  } finally {
    if (beforeBin === undefined) delete process.env.OMNIFOCUS_OSASCRIPT_BIN;
    else process.env.OMNIFOCUS_OSASCRIPT_BIN = beforeBin;
    if (beforeState === undefined) delete process.env.OMNIFOCUS_MCP_STATE_DIR;
    else process.env.OMNIFOCUS_MCP_STATE_DIR = beforeState;
    rmSync(dir, { recursive: true, force: true });
  }
});
