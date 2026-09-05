import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './utils/buildInfo.js';

function cli(args: string[], input?: string) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./cli.ts', import.meta.url)), ...args], {
    encoding: 'utf8', input, timeout: 20_000,
    env: { ...process.env, OMNIFOCUS_OSASCRIPT_BIN: '/nonexistent-omnifocus-cli-test' }
  });
  assert.ifError(child.error);
  return { status: child.status, result: JSON.parse(child.stdout) };
}

test('CLI stdin uses MCP validation and structured diagnostic output without Automation access', () => {
  const { status, result } = cli(['call', 'server_info', '--stdin'], '{"probe":false}');
  assert.equal(status, 0);
  assert.equal(result.structuredContent.success, true);
  assert.equal(result.structuredContent.tool, 'server_info');
  assert.equal(result.structuredContent.data.version, VERSION);
  assert.equal(result.structuredContent.data.omnifocus.probed, false);
});

test('CLI rejects invalid dates and unknown fields before reaching OmniFocus', () => {
  for (const args of [{ dueBefore: '2026-02-31' }, { unknownField: true }]) {
    const { status, result } = cli(['call', 'filter_tasks', JSON.stringify(args)]);
    assert.equal(status, 1);
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /ISO|Unrecognized|unrecognized/i);
    assert.doesNotMatch(JSON.stringify(result), /nonexistent-omnifocus-cli-test/);
  }
});

test('CLI emits one JSON error and a failing exit status for malformed input', () => {
  const { status, result } = cli(['call', 'server_info', '--stdin'], '{');
  assert.equal(status, 1);
  assert.equal(result.isError, true);
  assert.equal(typeof result.error, 'string');
});
