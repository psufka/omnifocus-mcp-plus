#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from './server.js';
import { VERSION } from './utils/buildInfo.js';

const MAX_INPUT_BYTES = 15_000_000;
async function readInput(): Promise<string> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error(`JSON input exceeds ${MAX_INPUT_BYTES} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function main() {
  const [command, tool, json, ...unexpected] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || !command) {
    process.stdout.write('Usage: omnifocus-mcp list | doctor [--no-probe] | call TOOL [JSON|--stdin]\nJSON arguments use the same strict schemas as MCP. Results include structuredContent.\n');
    return;
  }
  if (unexpected.length || !['list', 'doctor', 'call'].includes(command)) throw new Error('Unknown command or extra arguments; use --help.');
  if (command === 'list' && tool) throw new Error('list takes no arguments.');
  if (command === 'doctor' && (json || (tool && tool !== '--no-probe'))) throw new Error('doctor accepts only --no-probe.');
  if (command === 'call' && !tool) throw new Error('call requires a tool name.');
  let args: Record<string, unknown> = {};
  if (command === 'call') {
    const input = json === '--stdin' ? await readInput() : json || '{}';
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) throw new Error('JSON input is too large.');
    args = JSON.parse(input);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be a JSON object.');
  }
  const server = buildServer();
  const client = new Client({ name: 'omnifocus-mcp-cli', version: VERSION });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = command === 'list' ? await client.listTools() : await client.callTool({
      name: command === 'doctor' ? 'server_info' : tool,
      arguments: command === 'doctor' ? { probe: tool !== '--no-probe' } : args
    }, undefined, { timeout: 420_000 });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (result.isError) process.exitCode = 1;
  } finally { await client.close(); await server.close(); }
}
main().catch(error => {
  process.stdout.write(JSON.stringify({ isError: true, error: error.message }) + '\n');
  process.exitCode = 1;
});
