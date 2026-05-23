import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerStrictTool } from './registerStrictTool.js';

function makeServer(): McpServer {
  return new McpServer({ name: 'test', version: '0.0.0' });
}

function getInputSchema(server: McpServer, name: string): z.ZodTypeAny {
  return (server as any)._registeredTools[name].inputSchema as z.ZodTypeAny;
}

test('registerStrictTool installs strict inputSchema that rejects unknown fields', () => {
  const server = makeServer();
  const schema = z.object({ x: z.string() }).strict();
  registerStrictTool(server, 'probe', 'Probe', schema, async () => ({
    content: [{ type: 'text' as const, text: 'ok' }],
  }));

  const inputSchema = getInputSchema(server, 'probe');
  assert.equal(inputSchema.safeParse({ x: 'ok' }).success, true);

  const withExtra = inputSchema.safeParse({ x: 'ok', bogus: 1 });
  assert.equal(withExtra.success, false);
  if (!withExtra.success) {
    const text = JSON.stringify(withExtra.error.issues);
    assert.match(text, /bogus|unrecognized/i);
  }

  const missing = inputSchema.safeParse({});
  assert.equal(missing.success, false);
});

test('registerStrictTool unwraps ZodEffects (refine/transform) to find shape', () => {
  const server = makeServer();
  const schema = z.object({
    a: z.string().optional(),
    b: z.string().optional(),
  })
    .strict()
    .refine(d => d.a || d.b, { message: 'a or b required' })
    .transform(d => ({ ...d, resolved: d.a ?? d.b }));

  registerStrictTool(server, 'probe2', 'Probe2', schema, async () => ({
    content: [{ type: 'text' as const, text: 'ok' }],
  }));

  const inputSchema = getInputSchema(server, 'probe2');
  const ok = inputSchema.safeParse({ a: 'hello' });
  assert.equal(ok.success, true);
  if (ok.success) {
    assert.equal((ok.data as any).resolved, 'hello');
  }

  const neither = inputSchema.safeParse({});
  assert.equal(neither.success, false);

  const extra = inputSchema.safeParse({ a: 'hello', bogus: 1 });
  assert.equal(extra.success, false);
});
