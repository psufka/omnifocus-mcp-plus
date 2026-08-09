import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { registerStrictTool } from './registerStrictTool.js';

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
