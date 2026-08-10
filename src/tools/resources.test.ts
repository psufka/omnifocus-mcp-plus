import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerResources, formatStats, RESOURCE_MIME_TYPE, type ResourceDeps } from './resources.js';

// Stub every primitive: these tests must never touch a live OmniFocus.
function stubDeps(overrides: Partial<ResourceDeps> = {}): ResourceDeps {
  return {
    getInboxTasks: async () => '# INBOX TASKS\n\nstub inbox\n',
    getForecastTasks: async () => '# 📅 FORECAST\n\nstub forecast\n',
    getFlaggedTasks: async () => '# 🚩 FLAGGED TASKS\n\nstub flagged\n',
    getTaskCounts: async () => ({
      success: true,
      total: 10,
      available: 4,
      completed: 3,
      overdue: 2,
      dueSoon: 1,
      flagged: 5,
      deferred: 0,
    }),
    getProjectCounts: async () => ({
      success: true,
      total: 6,
      active: 3,
      onHold: 1,
      completed: 1,
      dropped: 1,
      stalled: 2,
    }),
    ...overrides,
  } as ResourceDeps;
}

async function connectedClient(deps: ResourceDeps): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerResources(server, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** A resource content block is text-or-blob in the SDK types; ours are always text. */
function textOf(contents: unknown, index = 0): string {
  const block = (contents as any[])[index];
  assert.ok(typeof block?.text === 'string', 'expected a text content block');
  return block.text as string;
}

const EXPECTED_URIS = [
  'omnifocus://inbox',
  'omnifocus://today',
  'omnifocus://flagged',
  'omnifocus://stats',
];

test('registers exactly the four documented resources', async () => {
  const client = await connectedClient(stubDeps());
  const { resources } = await client.listResources();

  assert.deepEqual(
    resources.map((r) => r.uri).sort(),
    [...EXPECTED_URIS].sort()
  );
  for (const resource of resources) {
    assert.equal(resource.mimeType, RESOURCE_MIME_TYPE, `${resource.uri} must be markdown`);
    assert.ok(resource.name && resource.name.length > 0, `${resource.uri} needs a name`);
    assert.ok(resource.description && resource.description.length > 0, `${resource.uri} needs a description`);
  }
  await client.close();
});

test('each resource reads through its primitive and echoes the requested uri', async () => {
  const calls: string[] = [];
  const client = await connectedClient(
    stubDeps({
      getInboxTasks: async () => {
        calls.push('inbox');
        return 'inbox body';
      },
      getForecastTasks: async (options) => {
        calls.push(`forecast:${options?.days}`);
        return 'today body';
      },
      getFlaggedTasks: async () => {
        calls.push('flagged');
        return 'flagged body';
      },
    })
  );

  for (const uri of EXPECTED_URIS) {
    const result = await client.readResource({ uri });
    assert.equal(result.contents.length, 1, `${uri} returns one content block`);
    assert.equal(result.contents[0].uri, uri);
    assert.equal(result.contents[0].mimeType, RESOURCE_MIME_TYPE);
    assert.ok(textOf(result.contents).length > 0, `${uri} returns a non-empty body`);
  }

  // today uses the single-day forecast window
  assert.deepEqual(calls, ['inbox', 'forecast:1', 'flagged']);
  await client.close();
});

test('stats resource renders both count tables', async () => {
  const client = await connectedClient(stubDeps());
  const result = await client.readResource({ uri: 'omnifocus://stats' });
  const text = textOf(result.contents);

  assert.match(text, /## Tasks/);
  assert.match(text, /## Projects/);
  assert.match(text, /\| Available \| 4 \|/);
  assert.match(text, /\| Stalled \| 2 \|/);
  await client.close();
});

test('a throwing primitive yields an error body, not a protocol error', async () => {
  const client = await connectedClient(
    stubDeps({
      getInboxTasks: async () => {
        throw new Error('OmniFocus did not respond');
      },
    })
  );

  const result = await client.readResource({ uri: 'omnifocus://inbox' });
  const text = textOf(result.contents);
  assert.match(text, /Could not read this resource/);
  assert.match(text, /OmniFocus did not respond/);
  await client.close();
});

test('a script-level failure in the counts primitives becomes an error body', async () => {
  const client = await connectedClient(
    stubDeps({
      getTaskCounts: async () => ({ success: false, error: 'script blew up' }),
    })
  );

  const result = await client.readResource({ uri: 'omnifocus://stats' });
  const text = textOf(result.contents);
  assert.match(text, /Could not read this resource/);
  assert.match(text, /script blew up/);
  await client.close();
});

test('an empty primitive response still produces a readable body', async () => {
  const client = await connectedClient(stubDeps({ getFlaggedTasks: async () => '   ' }));
  const result = await client.readResource({ uri: 'omnifocus://flagged' });
  assert.match(textOf(result.contents), /No content returned/);
  await client.close();
});

test('formatStats rejects a non-object counts payload', () => {
  assert.throws(() => formatStats(undefined, { success: true }), /unexpected result/i);
});
