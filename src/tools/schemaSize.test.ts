import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../server.js';

/**
 * Schema-size guard.
 *
 * Every tool's JSON Schema is sent to the model on every single request, so the
 * serialized tools/list payload is a permanent context tax. This test pins that
 * cost: it fails when a new tool (or a newly verbose description) pushes the
 * advertised surface past budget, which is otherwise invisible until someone
 * notices their context window shrinking.
 *
 * Nothing here touches OmniFocus — listTools only reads the registration
 * metadata.
 */

// FINAL 0.5.0 budget, measured 2026-08-10 against the complete 50-tool
// surface (after description trims): total ≈ 67.2KB, largest single tool
// filter_tasks ≈ 8.6KB (trimmed from 11.2KB — its clause schema serializes
// 3x, so its descriptions stay terse; deep docs live in
// docs/skills/omnifocus/filters.md).
// The cap is measured + ~6% headroom, NOT a growth allowance: adding a tool
// or fattening a description should trip this and force a conscious trade.
const TOTAL_BYTES_CAP = 71_000;

// A single tool this large is a design problem, not a budget problem: it means
// an enum or a description block that should have moved into docs.
// filter_tasks is already at 11,157 bytes — it is the tool to trim first.
const PER_TOOL_BYTES_CAP = 12_000;

// Tools that legitimately take no arguments. Anything else with an empty
// property set is a registration bug (schema lost in a refactor), which the
// protocol reports as a tool nobody can call correctly.
// As of 2026-08-10 no registered tool is zero-arg (every one takes at least an
// optional filter/format field), so this is deliberately empty. Add a name here
// only when a tool genuinely needs no input.
const ZERO_ARG_TOOLS = new Set<string>([]);

interface ToolSize {
  name: string;
  bytes: number;
}

async function listRegisteredTools() {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'schema-size-probe', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

function findArrayValuedItems(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findArrayValuedItems(entry, `${path}[${index}]`));
  }

  if (value === null || typeof value !== 'object') return [];

  const matches: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === 'items' && Array.isArray(child)) matches.push(childPath);
    matches.push(...findArrayValuedItems(child, childPath));
  }
  return matches;
}

test('advertised tool schemas stay within the context budget', async () => {
  const tools = await listRegisteredTools();
  assert.ok(tools.length > 0, 'buildServer registered no tools');

  const totalBytes = JSON.stringify(tools).length;
  const sizes: ToolSize[] = tools
    .map((tool) => ({ name: tool.name, bytes: JSON.stringify(tool).length }))
    .sort((a, b) => b.bytes - a.bytes);

  // Printed on every run so Phase 2 can trim the outliers without re-deriving
  // the numbers. console.error keeps it off the JSON-RPC stdout channel.
  console.error(
    `[schemaSize] ${tools.length} tools, ${totalBytes} bytes total ` +
      `(cap ${TOTAL_BYTES_CAP}, ${Math.round((totalBytes / TOTAL_BYTES_CAP) * 100)}% used)`
  );
  console.error('[schemaSize] top 10 by serialized size:');
  for (const { name, bytes } of sizes.slice(0, 10)) {
    console.error(`  ${String(bytes).padStart(6)}  ${name}`);
  }

  assert.ok(
    totalBytes <= TOTAL_BYTES_CAP,
    `tools/list payload is ${totalBytes} bytes, over the ${TOTAL_BYTES_CAP} byte cap. ` +
      `Largest: ${sizes.slice(0, 5).map((s) => `${s.name}=${s.bytes}`).join(', ')}`
  );
});

test('no single tool schema exceeds the per-tool cap', async () => {
  const tools = await listRegisteredTools();

  const oversized = tools
    .map((tool) => ({ name: tool.name, bytes: JSON.stringify(tool).length }))
    .filter((entry) => entry.bytes > PER_TOOL_BYTES_CAP);

  assert.deepEqual(
    oversized,
    [],
    `these tools exceed ${PER_TOOL_BYTES_CAP} bytes and should move detail into docs: ` +
      oversized.map((entry) => `${entry.name}=${entry.bytes}`).join(', ')
  );
});

test('every tool advertises a description and a usable input schema', async () => {
  const tools = await listRegisteredTools();

  for (const tool of tools) {
    assert.ok(
      typeof tool.description === 'string' && tool.description.trim().length > 0,
      `tool "${tool.name}" has no description`
    );

    const properties = (tool.inputSchema as any)?.properties;
    const propertyCount = properties ? Object.keys(properties).length : 0;

    if (propertyCount === 0) {
      assert.ok(
        ZERO_ARG_TOOLS.has(tool.name),
        `tool "${tool.name}" advertises no input properties. If that is intentional, ` +
          `add it to ZERO_ARG_TOOLS; otherwise its schema was lost during registration.`
      );
    }
  }
});

test('tool schemas avoid tuple-style array-valued items', async () => {
  const tools = await listRegisteredTools();
  const incompatibleSchemas = tools.flatMap((tool) =>
    findArrayValuedItems(tool.inputSchema).map((path) => `${tool.name}:${path}`)
  );

  assert.deepEqual(
    incompatibleSchemas,
    [],
    'array-valued JSON Schema items are rejected by clients that require items to be a schema object'
  );
});

test('every allowlisted zero-arg tool is actually registered and actually zero-arg', async () => {
  const tools = await listRegisteredTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const name of ZERO_ARG_TOOLS) {
    const tool = byName.get(name);
    assert.ok(tool, `ZERO_ARG_TOOLS lists "${name}", which is not registered — stale allowlist entry`);
    const propertyCount = Object.keys((tool!.inputSchema as any)?.properties ?? {}).length;
    assert.equal(
      propertyCount,
      0,
      `"${name}" now takes ${propertyCount} argument(s); remove it from ZERO_ARG_TOOLS`
    );
  }
});
