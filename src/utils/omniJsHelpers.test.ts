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

// Model the native effectiveActive property: on-hold objects stay active,
// while a dropped ancestor makes an otherwise active child inactive.
function mockContainer(id: string, kind = 'Folder', status = 'Active', parent: any = null): any {
  return {
    ...mockItem(id, 'Shared'),
    status: `[object ${kind}.Status: ${status}]`,
    parent,
    get effectiveActive(): boolean {
      return status !== 'Dropped' && (!parent || parent.effectiveActive);
    },
  };
}

function mockProject(id: string, status = 'Active', rootStatus = 'Blocked', parentFolder: any = null) {
  return {
    ...mockItem(id, 'Shared'),
    status: `[object Project.Status: ${status}]`,
    parentFolder,
    task: {
      get taskStatus() {
        const effective = parentFolder && !parentFolder.effectiveActive ? 'Dropped' : rootStatus;
        return `[object Task.Status: ${effective}]`;
      },
    },
  };
}

for (const method of ['resolveByIdOrName', 'resolveByNameOrId'] as const) {
  const byName = (items: any[], label: string) => {
    const helpers = loadHelpers();
    return method === 'resolveByIdOrName'
      ? helpers.resolveByIdOrName(items, null, 'Shared', label)
      : helpers.resolveByNameOrId(items, 'SHARED', label);
  };
  const byId = (items: any[], id: string, label: string) => {
    const helpers = loadHelpers();
    return method === 'resolveByIdOrName'
      ? helpers.resolveByIdOrName(items, id, 'Shared', label)
      : helpers.resolveByNameOrId(items, id, label);
  };

  test(`${method}: folder and tag ties account for direct and nested dropping`, () => {
    for (const kind of ['Folder', 'Tag']) {
      const droppedParent = mockContainer('archive', kind, 'Dropped');
      const nestedParent = mockContainer('nested', kind, 'Active', droppedParent);
      const inactive = [
        mockContainer('directly-dropped', kind, 'Dropped'),
        mockContainer('in-dropped-parent', kind, 'Active', droppedParent),
        mockContainer('in-dropped-ancestor', kind, 'Active', nestedParent),
      ];
      // On-hold tags are still live targets, just as on-hold projects are.
      const live = mockContainer('live', kind, kind === 'Tag' ? 'OnHold' : 'Active');
      assert.equal(byName([...inactive, live], kind).item, live);
      for (const historical of inactive) {
        assert.equal(byId([historical, live], historical.id.primaryKey, kind).item, historical);
        assert.equal(byName([historical], kind).item, historical);
      }
      assert.match(byName(inactive, kind).error, /Ambiguous/);
      assert.match(byName([...inactive, live, mockContainer('other-live', kind)], kind).error, /Ambiguous/);
    }
  });

  test(`${method}: project ties exclude dropped ancestors without excluding blocked or deferred work`, () => {
    const droppedParent = mockContainer('archive', 'Folder', 'Dropped');
    const nestedParent = mockContainer('nested', 'Folder', 'Active', droppedParent);
    const historical = [
      mockProject('dropped', 'Dropped', 'Dropped'),
      mockProject('completed', 'Done', 'Completed'),
      mockProject('dropped-parent', 'Active', 'Blocked', droppedParent),
      mockProject('dropped-ancestor', 'OnHold', 'Blocked', nestedParent),
    ];
    for (const [status, rootStatus, deferred] of [
      ['Active', 'Available', false],
      ['Active', 'Blocked', false],
      ['Active', 'Blocked', true],
      ['OnHold', 'Blocked', false],
    ] as const) {
      const live = {
        ...mockProject('live', status, rootStatus),
        deferDate: deferred ? new Date('2099-01-01') : null,
      };
      assert.equal(byName([...historical, live], 'project').item, live, `${status}/${rootStatus}/deferred=${deferred}`);
      assert.match(byName([live, mockProject('other-live')], 'project').error, /Ambiguous/);
      for (const old of historical) {
        assert.equal(byId([old, live], old.id.primaryKey, 'project').item, old);
        assert.equal(byName([old], 'project').item, old);
      }
    }
    assert.match(byName(historical, 'project').error, /Ambiguous/);
  });
}
