import assert from 'node:assert/strict';
import test from 'node:test';

import { schema as batchAddItemsSchema } from './batchAddItems.js';

// The cross-item rules live in the schema (not the handler) so a malformed
// batch is rejected before any OmniJS runs — a forward parentTempId reference
// would otherwise resolve to nothing halfway through a partially applied batch.

function parse(args: any) {
  return batchAddItemsSchema.safeParse(args);
}

function issues(result: ReturnType<typeof parse>): string {
  return result.success ? '' : JSON.stringify(result.error.issues);
}

// --- tempId / parentTempId ---------------------------------------------------

test('a child may reference an earlier item tempId', () => {
  const r = parse({
    items: [
      { itemType: 'project', name: 'Launch', tempId: 'proj' },
      { itemType: 'task', name: 'Phase 1', parentTempId: 'proj' }
    ]
  });
  assert.equal(r.success, true, issues(r));
});

test('tempIds must be unique within the batch', () => {
  const r = parse({
    items: [
      { itemType: 'task', name: 'A', tempId: 'dup' },
      { itemType: 'task', name: 'B', tempId: 'dup' }
    ]
  });
  assert.equal(r.success, false);
  assert.match(issues(r), /Duplicate tempId .{0,2}dup/);
});

test('a forward parentTempId reference is rejected', () => {
  const r = parse({
    items: [
      { itemType: 'task', name: 'Child', parentTempId: 'later' },
      { itemType: 'task', name: 'Parent', tempId: 'later' }
    ]
  });
  assert.equal(r.success, false);
  assert.match(issues(r), /must reference an EARLIER item/);
});

test('a self parentTempId reference is rejected', () => {
  const r = parse({
    items: [{ itemType: 'task', name: 'Ouroboros', tempId: 'me', parentTempId: 'me' }]
  });
  assert.equal(r.success, false);
  assert.match(issues(r), /itself/);
});

test('an unknown parentTempId is rejected', () => {
  const r = parse({
    items: [{ itemType: 'task', name: 'Orphan', parentTempId: 'nobody' }]
  });
  assert.equal(r.success, false);
  assert.match(issues(r), /does not match any tempId in this batch/);
});

test('parentTempId is rejected on a project item', () => {
  const r = parse({
    items: [
      { itemType: 'task', name: 'Parent', tempId: 'p' },
      { itemType: 'project', name: 'Nested project', parentTempId: 'p' }
    ]
  });
  assert.equal(r.success, false);
  assert.match(issues(r), /only valid on task items/);
});

test('parentTempId cannot be combined with parentTaskId/parentTaskName/projectName', () => {
  for (const conflicting of [{ parentTaskId: 'x' }, { parentTaskName: 'x' }, { projectName: 'x' }]) {
    const r = parse({
      items: [
        { itemType: 'task', name: 'Parent', tempId: 'p' },
        { itemType: 'task', name: 'Child', parentTempId: 'p', ...conflicting }
      ]
    });
    assert.equal(r.success, false, `accepted parentTempId with ${JSON.stringify(conflicting)}`);
    assert.match(issues(r), /Cannot combine parentTempId/);
  }
});

// --- atomic / stopOnError ----------------------------------------------------

test('atomic: true with an explicit stopOnError: false is rejected', () => {
  const r = parse({
    items: [{ itemType: 'task', name: 'A' }],
    atomic: true,
    stopOnError: false
  });
  assert.equal(r.success, false);
  assert.match(issues(r), /atomic: true implies stop-on-error/);
});

test('atomic: true on its own is accepted (stopOnError is implied)', () => {
  const r = parse({ items: [{ itemType: 'task', name: 'A' }], atomic: true });
  assert.equal(r.success, true, issues(r));
});

test('atomic: true with stopOnError: true is accepted', () => {
  const r = parse({ items: [{ itemType: 'task', name: 'A' }], atomic: true, stopOnError: true });
  assert.equal(r.success, true, issues(r));
});

// --- dryRun ------------------------------------------------------------------

test('all three batch flags are optional and default to absent', () => {
  const r = parse({ items: [{ itemType: 'task', name: 'A' }] });
  assert.equal(r.success, true, issues(r));
  if (r.success) {
    assert.equal(r.data.dryRun, undefined);
    assert.equal(r.data.stopOnError, undefined);
    assert.equal(r.data.atomic, undefined);
  }
});

test('dryRun is accepted on batch_add_items', () => {
  const r = parse({ items: [{ itemType: 'task', name: 'A' }], dryRun: true });
  assert.equal(r.success, true, issues(r));
});

test('unknown top-level flags are still rejected after superRefine', () => {
  const r = parse({ items: [{ itemType: 'task', name: 'A' }], dryrun: true });
  assert.equal(r.success, false);
  assert.match(issues(r), /dryrun|unrecognized/i);
});
