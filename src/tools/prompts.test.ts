import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerPrompts } from './prompts.js';
import { buildServer } from '../server.js';

async function connectedClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerPrompts(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const EXPECTED_PROMPTS = ['weekly_review', 'inbox_processing', 'daily_planning', 'task_health_scan'];

// Every tool name a prompt is allowed to mention, read from the REAL server
// registration. A hand-maintained allowlist went stale three tools at a time
// and then silently permitted names that no longer had to exist; deriving it
// means a prompt naming a deleted or misspelled tool fails here.
async function registeredToolNames(): Promise<Set<string>> {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tool-name-probe', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return new Set(tools.map((tool) => tool.name));
}

// Sub-operations of the 0.5.0 multiplexed tools, also written in snake_case.
const KNOWN_OPERATIONS = new Set([
  'list_due', 'mark_reviewed',
  'health_snapshot', 'overdue_clusters', 'stalled_projects', 'velocity',
]);

// No `= {}` default: passing an empty arguments object hides the bug where a
// spec-legal prompts/get with NO arguments key is rejected outright.
async function promptText(client: Client, name: string, args?: Record<string, string>): Promise<string> {
  const result = await client.getPrompt(args === undefined ? { name } : { name, arguments: args });
  assert.equal(result.messages.length, 1, `${name} returns one message`);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].content.type, 'text');
  return String((result.messages[0].content as any).text);
}

test('registers exactly the four documented prompts with titles and descriptions', async () => {
  const client = await connectedClient();
  const { prompts } = await client.listPrompts();

  assert.deepEqual(prompts.map((p) => p.name).sort(), [...EXPECTED_PROMPTS].sort());
  for (const prompt of prompts) {
    assert.ok(prompt.description && prompt.description.length > 10, `${prompt.name} needs a description`);
    assert.ok((prompt as any).title, `${prompt.name} needs a title`);
  }
  await client.close();
});

test('every prompt renders and mentions only real tool names', async () => {
  const client = await connectedClient();
  const knownTools = await registeredToolNames();

  for (const name of EXPECTED_PROMPTS) {
    const text = await promptText(client, name);
    assert.ok(text.length > 200, `${name} should be a substantive prompt`);
    assert.ok(text.split('\n').length <= 40, `${name} must stay under ~40 lines`);

    // Any snake_case identifier in backticks is treated as a tool reference.
    const referenced = [...text.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
    const toolish = referenced.filter((token) => token.includes('_'));
    assert.ok(toolish.length > 0, `${name} should reference tools`);
    for (const token of toolish) {
      // Schema field names are camelCase; only snake_case tokens are tools or
      // the sub-operations of the multiplexed 0.5.0 tools.
      assert.ok(
        knownTools.has(token) || KNOWN_OPERATIONS.has(token),
        `${name} references unknown tool "${token}"`
      );
    }
  }
  await client.close();
});

test('mutation-flow prompts end with the sync-once instruction', async () => {
  const client = await connectedClient();

  for (const name of ['weekly_review', 'inbox_processing', 'daily_planning']) {
    const text = await promptText(client, name);
    assert.match(text.trimEnd(), /finish by calling `app_control` sync once\.$/);
  }

  // The health scan is read-only: it must NOT tell the model to sync.
  const scan = await promptText(client, 'task_health_scan');
  assert.ok(!scan.includes('app_control'), 'task_health_scan is read-only');
  assert.match(scan, /read-only/);
  await client.close();
});

test('weekly_review covers the full GTD loop', async () => {
  const client = await connectedClient();
  const text = await promptText(client, 'weekly_review');

  for (const needle of ['list_due', 'stalled_projects', 'mark_reviewed', 'get_inbox_tasks', 'get_forecast_tasks']) {
    assert.ok(text.includes(needle), `weekly_review should cover ${needle}`);
  }
  await client.close();
});

test('task_health_scan requests all four analyses and forbids invented scores', async () => {
  const client = await connectedClient();
  const text = await promptText(client, 'task_health_scan');

  for (const needle of ['health_snapshot', 'overdue_clusters', 'stalled_projects', 'velocity']) {
    assert.ok(text.includes(needle), `task_health_scan should request ${needle}`);
  }
  assert.match(text, /Do not invent a score/i);
  await client.close();
});

test('optional arguments are interpolated into the prompt when supplied', async () => {
  const client = await connectedClient();

  const scoped = await promptText(client, 'weekly_review', { folder: 'Work' });
  assert.match(scoped, /Scope: Work/);

  const unscoped = await promptText(client, 'weekly_review');
  assert.ok(!unscoped.includes('Scope:'), 'omitted argument leaves no empty scope line');

  const day = await promptText(client, 'daily_planning', { date: '2026-08-12', hours: '5' });
  assert.match(day, /Planning date \(local\): 2026-08-12/);
  assert.match(day, /Available hours: 5/);

  const inbox = await promptText(client, 'inbox_processing', { limit: '10' });
  assert.match(inbox, /Stop after this many items: 10/);
  await client.close();
});

test('every prompt answers a prompts/get that omits the arguments key entirely', async () => {
  // `arguments` is optional in the MCP spec and the SDK's own client omits it
  // when no arguments are passed. The SDK validates request.params.arguments
  // against z.object(argsSchema), which rejects `undefined` however optional
  // its fields are — so every prompt that declared an argument used to fail
  // with -32602 (Invalid arguments) on the most ordinary call there is.
  const client = await connectedClient();

  for (const name of EXPECTED_PROMPTS) {
    const result = await client.getPrompt({ name });
    assert.equal(result.messages.length, 1, `${name} returned no message for an argument-less get`);
    assert.ok(
      String((result.messages[0].content as any).text).length > 200,
      `${name} rendered nothing for an argument-less get`
    );
  }
  await client.close();
});

test('an argument-less get renders the same text as an empty arguments object', async () => {
  const client = await connectedClient();

  for (const name of EXPECTED_PROMPTS) {
    const omitted = await promptText(client, name);
    const empty = await promptText(client, name, {});
    assert.equal(omitted, empty, `${name} renders differently when arguments is omitted`);
  }
  await client.close();
});

test('prompts still advertise their optional arguments and still type-check them', async () => {
  const client = await connectedClient();
  const { prompts } = await client.listPrompts();
  const byName = new Map(prompts.map((p) => [p.name, p]));

  assert.deepEqual(
    byName.get('daily_planning')?.arguments?.map((a) => a.name).sort(),
    ['date', 'hours'],
    'making the arguments object optional must not erase the advertised argument list'
  );
  for (const argument of byName.get('daily_planning')?.arguments ?? []) {
    assert.equal(argument.required, false, `${argument.name} should be optional`);
    assert.ok(argument.description, `${argument.name} should keep its description`);
  }

  // The wrapper must not turn validation off: a non-string argument is still
  // an error, it is only the MISSING object that is now tolerated.
  await assert.rejects(
    () => client.getPrompt({ name: 'daily_planning', arguments: { date: 5 as any } }),
    /date/i
  );
  await client.close();
});
