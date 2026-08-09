import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { batchAddItems, prepareBatchItems } from './batchAddItems.js';
import { batchRemoveItems, prepareRemoveItems } from './batchRemoveItems.js';
import { batchMoveTasks, validateBatchMoveParams } from './batchMoveTasks.js';

// The scripts themselves need the OmniFocus runtime, so (as elsewhere in this
// repo) the structural guarantees are asserted against the source text; the
// pure TS helpers are exercised directly. No test here may reach runOmniJs.

const here = dirname(fileURLToPath(import.meta.url));
const BATCH_PRIMITIVES = ['batchAddItems.ts', 'batchRemoveItems.ts', 'batchMoveTasks.ts'];

function readPrimitive(name: string): string {
  return readFileSync(join(here, name), 'utf8');
}

for (const name of BATCH_PRIMITIVES) {
  test(`${name} calls runOmniJs exactly once (no per-item round-trip)`, () => {
    const src = readPrimitive(name);
    const calls = src.match(/runOmniJs\(/g) || [];
    assert.equal(calls.length, 1, `${name} makes ${calls.length} runOmniJs calls; a batch must be a single script`);
  });

  test(`${name} does not await a per-item primitive inside a loop`, () => {
    const src = readPrimitive(name);
    // The old implementations looped `for (const item of items) { await removeItem(item) }`.
    assert.doesNotMatch(src, /for \([^)]*\)[\s\S]{0,400}?await (runOmniJs|addOmniFocusTask|addProject|removeItem|moveTask)\(/);
  });

  test(`${name} iterates the items inside the script with a per-item try/catch`, () => {
    const src = readPrimitive(name);
    assert.match(src, /for \(let i = 0; i < args\.(items|tasks)\.length; i\+\+\)/, `${name} script does not loop over the injected array`);
    assert.match(src, /try \{[\s\S]*\} catch \(e\) \{[\s\S]*results\.push\(\{[\s\S]*index: i/, `${name} script lacks a per-item catch that still records a result`);
    assert.match(src, /continue;/, `${name} script does not continue past a failed item`);
  });

  test(`${name} tags every result with its input index`, () => {
    const src = readPrimitive(name);
    assert.match(src, /index: i/, `${name} results are not index-tagged, so order cannot be guaranteed`);
  });

  test(`${name} builds a batch-level error summary when nothing succeeded`, () => {
    const src = readPrimitive(name);
    assert.match(src, /summarizeBatchErrors/, `${name} still leaves error undefined when every item fails`);
  });

  test(`${name} never interpolates user data into the script text`, () => {
    const src = readPrimitive(name);
    const scriptStart = src.search(/export const [A-Z_]+_SCRIPT = `/);
    assert.ok(scriptStart > 0, `${name} does not declare its OmniJS script as a static constant`);
    const scriptBody = src.slice(scriptStart);
    // Only the shared OmniJS helper constants may be interpolated into a script.
    const interpolations = scriptBody.match(/\$\{[^}]*\}/g) || [];
    for (const interpolation of interpolations) {
      assert.match(
        interpolation,
        /^\$\{OMNIJS_[A-Z_]+\}$/,
        `${name} interpolates ${interpolation} into script text; user data must arrive via the args object`
      );
    }
  });
}

test('batchRemoveItems uses the strict shared lookup helper', () => {
  const src = readPrimitive('batchRemoveItems.ts');
  assert.match(src, /OMNIJS_LOOKUP_HELPERS/);
  assert.match(src, /__resolveByIdOrName\(collection, item\.id, item\.name, item\.itemType\)/);
  // The old path went through removeItem(), which fell back from a stale ID to
  // a name match.
  assert.doesNotMatch(src, /from '\.\/removeItem\.js'/);
});

test('batchAddItems reuses the single-task creation helper', () => {
  const src = readPrimitive('batchAddItems.ts');
  assert.match(src, /OMNIJS_CREATE_TASK_HELPER/, 'batch task creation must share addOmniFocusTask logic');
  assert.match(src, /__createProject/, 'batch must be able to create projects in the same script');
});

test('batchMoveTasks resolves the shared destination once, outside the loop', () => {
  const src = readPrimitive('batchMoveTasks.ts');
  const destIndex = src.indexOf("'Destination project'");
  const loopIndex = src.indexOf('for (let i = 0; i < args.tasks.length; i++)');
  assert.ok(destIndex > 0 && loopIndex > 0);
  assert.ok(destIndex < loopIndex, 'destination must be resolved before the per-task loop');
});

test('batchMoveTasks preserves cycle prevention', () => {
  const src = readPrimitive('batchMoveTasks.ts');
  assert.match(src, /cannot move a task into itself or its descendants/);
});

// --- pure helpers ---

test('prepareBatchItems resolves itemType and its legacy alias', () => {
  const prepared = prepareBatchItems([
    { itemType: 'task', type: 'task', name: 'A' },
    { type: 'project', name: 'B' }
  ] as any);

  assert.equal(prepared[0].kind, 'task');
  assert.equal(prepared[1].kind, 'project');
  assert.equal(prepared[0].preflightError, undefined);
  assert.equal(prepared[1].preflightError, undefined);
});

test('prepareBatchItems normalizes bare dates to local midnight', () => {
  const prepared = prepareBatchItems([
    { itemType: 'task', type: 'task', name: 'A', dueDate: '2026-03-05', deferDate: '2026-03-04', plannedDate: '2026-03-03' }
  ] as any);

  assert.equal(prepared[0].dueDate, '2026-03-05T00:00:00');
  assert.equal(prepared[0].deferDate, '2026-03-04T00:00:00');
  assert.equal(prepared[0].plannedDate, '2026-03-03T00:00:00');
});

test('prepareBatchItems leaves timestamped dates alone', () => {
  const prepared = prepareBatchItems([
    { itemType: 'task', type: 'task', name: 'A', dueDate: '2026-03-05T09:00:00-06:00' }
  ] as any);
  assert.equal(prepared[0].dueDate, '2026-03-05T09:00:00-06:00');
});

test('prepareBatchItems flags per-item validation failures without dropping the item', () => {
  const prepared = prepareBatchItems([
    { itemType: 'task', type: 'task', name: 'A', parentTaskId: 'p1', parentTaskName: 'P' },
    { itemType: 'task', type: 'task', name: 'B', parentTaskId: 'p1', projectName: 'Proj' },
    { itemType: 'task', type: 'task', name: 'C' }
  ] as any);

  assert.equal(prepared.length, 3);
  assert.match(prepared[0].preflightError || '', /Cannot specify both parentTaskId and parentTaskName/);
  assert.match(prepared[1].preflightError || '', /Cannot specify both parent task and project/);
  assert.equal(prepared[2].preflightError, undefined);
});

test('prepareBatchItems rejects an unknown item type per item', () => {
  const prepared = prepareBatchItems([{ type: 'folder', name: 'X' }] as any);
  assert.match(prepared[0].preflightError || '', /Invalid item type: folder/);
});

test('prepareRemoveItems flags items with neither id nor name', () => {
  const prepared = prepareRemoveItems([
    { itemType: 'task' },
    { itemType: 'task', id: 't1' }
  ] as any);

  assert.match(prepared[0].preflightError || '', /Either id or name must be provided/);
  assert.equal(prepared[1].preflightError, undefined);
});

test('validateBatchMoveParams enforces exactly one destination', () => {
  assert.equal(validateBatchMoveParams({ tasks: [{ id: 't' }] }).valid, false);
  assert.equal(validateBatchMoveParams({ tasks: [{ id: 't' }], targetInbox: true, targetProjectName: 'P' }).valid, false);
  assert.equal(validateBatchMoveParams({ tasks: [{ id: 't' }], targetInbox: true }).valid, true);
});

test('validateBatchMoveParams rejects both id and name for one destination', () => {
  const result = validateBatchMoveParams({ tasks: [{ id: 't' }], targetProjectId: 'p1', targetProjectName: 'P' });
  assert.equal(result.valid, false);
  assert.match(result.error || '', /Cannot specify both targetProjectId and targetProjectName/);
});

test('validateBatchMoveParams requires at least one task', () => {
  const result = validateBatchMoveParams({ tasks: [], targetInbox: true });
  assert.equal(result.valid, false);
  assert.match(result.error || '', /At least one task/);
});

// Empty-input paths return before any script runs, so they are safe to call.
test('batch primitives reject an empty batch without touching OmniFocus', async () => {
  const add = await batchAddItems([]);
  assert.equal(add.success, false);
  assert.deepEqual(add.results, []);
  assert.match(add.error || '', /At least one item/);

  const remove = await batchRemoveItems([]);
  assert.equal(remove.success, false);
  assert.match(remove.error || '', /At least one item/);

  const move = await batchMoveTasks({ tasks: [], targetInbox: true });
  assert.equal(move.success, false);
  assert.match(move.error || '', /At least one task/);
});
