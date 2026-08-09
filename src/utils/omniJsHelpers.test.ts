import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OMNIJS_LOOKUP_HELPERS } from './omniJsHelpers.js';

// The helpers are plain ES5-compatible JS, so we can evaluate them in Node
// against a mock collection to verify the lookup semantics.
function loadHelpers(): {
  resolveByIdOrName: (c: any[], id: string | null, name: string | null, label: string) => any;
  resolveByNameOrId: (c: any[], nameOrId: string, label: string) => any;
} {
  const factory = new Function(`
    ${OMNIJS_LOOKUP_HELPERS}
    return { resolveByIdOrName: __resolveByIdOrName, resolveByNameOrId: __resolveByNameOrId };
  `);
  return factory();
}

function mockItem(id: string, name: string, projectName?: string) {
  return {
    id: { primaryKey: id },
    name,
    containingProject: projectName ? { name: projectName } : null,
    parent: null,
  };
}

const collection = [
  mockItem('t1', 'Weekly review', 'Work'),
  mockItem('t2', 'Weekly review', 'Personal'),
  mockItem('t3', 'Unique task'),
  mockItem('t4', 'archive'),
  mockItem('t5', 'Archive'),
];

test('resolveByIdOrName: id match wins', () => {
  const { resolveByIdOrName } = loadHelpers();
  const result = resolveByIdOrName(collection, 't3', null, 'task');
  assert.equal(result.item.name, 'Unique task');
});

test('resolveByIdOrName: stale id NEVER falls back to name', () => {
  const { resolveByIdOrName } = loadHelpers();
  const result = resolveByIdOrName(collection, 'stale-id', 'Unique task', 'task');
  assert.ok(result.error, 'expected an error, not a name-matched item');
  assert.match(result.error, /not found with ID: stale-id/);
  assert.equal(result.item, undefined);
});

test('resolveByIdOrName: ambiguous name errors with match list', () => {
  const { resolveByIdOrName } = loadHelpers();
  const result = resolveByIdOrName(collection, null, 'Weekly review', 'task');
  assert.ok(result.error);
  assert.match(result.error, /Ambiguous/);
  assert.match(result.error, /t1/);
  assert.match(result.error, /t2/);
});

test('resolveByIdOrName: unique name resolves', () => {
  const { resolveByIdOrName } = loadHelpers();
  const result = resolveByIdOrName(collection, null, 'Unique task', 'task');
  assert.equal(result.item.id.primaryKey, 't3');
});

test('resolveByIdOrName: neither id nor name is an error', () => {
  const { resolveByIdOrName } = loadHelpers();
  const result = resolveByIdOrName(collection, null, null, 'task');
  assert.ok(result.error);
});

test('resolveByNameOrId: case-insensitive collision is an error, not first-match', () => {
  const { resolveByNameOrId } = loadHelpers();
  const result = resolveByNameOrId(collection, 'ARCHIVE', 'folder');
  assert.ok(result.error, 'expected ambiguity error for archive/Archive');
  assert.match(result.error, /Ambiguous/);
});

test('resolveByNameOrId: id match bypasses name matching', () => {
  const { resolveByNameOrId } = loadHelpers();
  const result = resolveByNameOrId(collection, 't4', 'folder');
  assert.equal(result.item.name, 'archive');
});

test('resolveByNameOrId: unique case-insensitive name resolves', () => {
  const { resolveByNameOrId } = loadHelpers();
  const result = resolveByNameOrId(collection, 'UNIQUE TASK', 'task');
  assert.equal(result.item.id.primaryKey, 't3');
});

test('helper source survives the runOmniJs escaping round-trip', () => {
  // runOmniJs escapes \ ` $ — the helper source must contain none of them
  // so the escaping layer has nothing to transform.
  assert.ok(!OMNIJS_LOOKUP_HELPERS.includes('`'));
  assert.ok(!OMNIJS_LOOKUP_HELPERS.includes('$') || !/\$(?!_)/.test(OMNIJS_LOOKUP_HELPERS));
  assert.ok(!OMNIJS_LOOKUP_HELPERS.includes('\\'));
});
