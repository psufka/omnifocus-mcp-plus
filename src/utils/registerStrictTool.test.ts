import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { registerStrictTool, READ_ONLY_TOOL, MUTATING_TOOL } from './registerStrictTool.js';
import { cacheClear } from './cache.js';

async function connectedClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

test('strict tool rejects unknown fields end-to-end over the protocol', async () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerStrictTool(server, 'probe', 'Probe', z.object({ x: z.string() }).strict(), async (args: any) => ({
    content: [{ type: 'text' as const, text: `got ${args.x}` }],
  }));
  const client = await connectedClient(server);

  const ok = await client.callTool({ name: 'probe', arguments: { x: 'ok' } });
  assert.equal((ok.content as any)[0].text, 'got ok');

  const bogus = await client.callTool({ name: 'probe', arguments: { x: 'ok', bogus: 1 } });
  assert.equal(bogus.isError, true, 'unknown field must fail');
  assert.match((bogus.content as any)[0].text, /bogus|unrecognized/i);

  const missing = await client.callTool({ name: 'probe', arguments: {} });
  assert.equal(missing.isError, true, 'missing required field must fail');
});

test('effects-wrapped schema: refinement rejects, transform reaches handler', async () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const schema = z
    .object({ a: z.string().optional(), b: z.string().optional() })
    .strict()
    .refine((d) => d.a || d.b, { message: 'a or b required' })
    .transform((d) => ({ ...d, resolved: d.a ?? d.b }));

  registerStrictTool(server, 'probe2', 'Probe2', schema, async (args: any) => ({
    content: [{ type: 'text' as const, text: `resolved=${args.resolved}` }],
  }));
  const client = await connectedClient(server);

  const ok = await client.callTool({ name: 'probe2', arguments: { a: 'hello' } });
  assert.equal((ok.content as any)[0].text, 'resolved=hello');

  const refineFail = await client.callTool({ name: 'probe2', arguments: {} });
  assert.equal(refineFail.isError, true);
  assert.match((refineFail.content as any)[0].text, /a or b required/);

  const bogus = await client.callTool({ name: 'probe2', arguments: { a: 'hello', bogus: 1 } });
  assert.equal(bogus.isError, true, 'unknown field must fail even on effects-wrapped schema');
  assert.match((bogus.content as any)[0].text, /bogus|unrecognized/i);
});

test('tools/list serializes the full JSON schema, including for effects-wrapped tools', async () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerStrictTool(server, 'plain', 'Plain', z.object({ x: z.string() }).strict(), async () => ({
    content: [{ type: 'text' as const, text: 'ok' }],
  }));
  const effectsSchema = z
    .object({ a: z.string().optional(), b: z.string().optional() })
    .strict()
    .refine((d) => d.a || d.b, { message: 'a or b required' });
  registerStrictTool(server, 'effects', 'Effects', effectsSchema, async () => ({
    content: [{ type: 'text' as const, text: 'ok' }],
  }));
  const client = await connectedClient(server);

  const { tools } = await client.listTools();
  const plain = tools.find((t) => t.name === 'plain')!;
  const effects = tools.find((t) => t.name === 'effects')!;

  assert.ok(plain.inputSchema.properties && 'x' in (plain.inputSchema.properties as any));
  assert.equal((plain.inputSchema as any).additionalProperties, false);

  const effectsProps = effects.inputSchema.properties as any;
  assert.ok(effectsProps && 'a' in effectsProps && 'b' in effectsProps,
    'effects-wrapped tool must not serialize as an empty schema');
  assert.equal((effects.inputSchema as any).additionalProperties, false);
});

test('tolerant input: stringified booleans/numbers/arrays coerce, garbage still rejects', async () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const seen: any[] = [];
  registerStrictTool(
    server,
    'coerce',
    'Coerce',
    z.object({
      flag: z.boolean().optional(),
      count: z.number().optional(),
      tags: z.array(z.string()).optional(),
      label: z.string().optional(),
    }).strict(),
    async (args: any) => {
      seen.push(args);
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    }
  );
  const client = await connectedClient(server);

  const ok = await client.callTool({
    name: 'coerce',
    arguments: { flag: 'true', count: '42', tags: '["a","b"]' } as any,
  });
  assert.notEqual(ok.isError, true, 'coercible strings must be accepted');
  assert.deepEqual(seen[0], { flag: true, count: 42, tags: ['a', 'b'] });

  // A string field must NOT get coerced sideways.
  await client.callTool({ name: 'coerce', arguments: { label: 'true' } });
  assert.deepEqual(seen[1], { label: 'true' });

  const garbage = await client.callTool({ name: 'coerce', arguments: { flag: 'maybe' } as any });
  assert.equal(garbage.isError, true, 'non-coercible value must still fail validation');

  const badJson = await client.callTool({ name: 'coerce', arguments: { tags: '[not json' } as any });
  assert.equal(badJson.isError, true, 'unparseable JSON string must still fail validation');
});

test('tolerant input: coercion does not change the advertised JSON schema', async () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerStrictTool(
    server,
    'coerce2',
    'Coerce2',
    z.object({ flag: z.boolean(), count: z.number().optional() }).strict(),
    async () => ({ content: [{ type: 'text' as const, text: 'ok' }] })
  );
  const client = await connectedClient(server);

  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'coerce2')!;
  const props = tool.inputSchema.properties as any;
  assert.equal(props.flag.type, 'boolean', 'preprocess wrapper must serialize as the inner type');
  assert.equal(props.count.type, 'number');
  assert.deepEqual(tool.inputSchema.required, ['flag'], 'required/optional must survive coercion wrapping');
});

test('annotations and title are surfaced in tools/list', async () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerStrictTool(
    server,
    'annotated',
    'Annotated',
    z.object({}).strict(),
    async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    { annotations: { ...MUTATING_TOOL, idempotentHint: true }, title: 'Fancy Title' }
  );
  const client = await connectedClient(server);

  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === 'annotated')!;
  assert.equal(tool.annotations?.readOnlyHint, false);
  assert.equal(tool.annotations?.destructiveHint, true);
  assert.equal(tool.annotations?.idempotentHint, true);
  assert.equal(tool.title, 'Fancy Title');
});

test('cacheable read tool caches; a mutating call busts the cache', async () => {
  cacheClear();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  let reads = 0;
  registerStrictTool(
    server,
    'cached_read',
    'Cached read',
    z.object({ which: z.string().optional() }).strict(),
    async (args: any) => {
      reads++;
      return { content: [{ type: 'text' as const, text: `read ${args.which ?? ''} #${reads}` }] };
    },
    { annotations: READ_ONLY_TOOL, cacheable: true }
  );
  registerStrictTool(
    server,
    'mutate',
    'Mutate',
    z.object({}).strict(),
    async () => ({ content: [{ type: 'text' as const, text: 'mutated' }] }),
    { annotations: MUTATING_TOOL }
  );
  const client = await connectedClient(server);

  const first = await client.callTool({ name: 'cached_read', arguments: {} });
  const second = await client.callTool({ name: 'cached_read', arguments: {} });
  assert.equal(reads, 1, 'second identical call must be served from cache');
  assert.equal((first.content as any)[0].text, (second.content as any)[0].text);

  // Different args must not share a cache key.
  await client.callTool({ name: 'cached_read', arguments: { which: 'other' } });
  assert.equal(reads, 2);

  await client.callTool({ name: 'mutate', arguments: {} });
  await client.callTool({ name: 'cached_read', arguments: {} });
  assert.equal(reads, 3, 'a mutating tool call must clear cached reads');
  cacheClear();
});

test('cacheable without readOnly annotation is a registration error', () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  assert.throws(
    () =>
      registerStrictTool(
        server,
        'bad',
        'Bad',
        z.object({}).strict(),
        async () => ({ content: [] }),
        { annotations: MUTATING_TOOL, cacheable: true }
      ),
    /cacheable but not annotated readOnlyHint/
  );
});
