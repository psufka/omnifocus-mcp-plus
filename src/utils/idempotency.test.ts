import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withIdempotency } from './idempotency.js';

test('request keys coordinate concurrent creates, reject conflicts and preserve uncertain outcomes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ofmcp-requests-'));
  const old = process.env.OMNIFOCUS_MCP_STATE_DIR; process.env.OMNIFOCUS_MCP_STATE_DIR = dir;
  let calls = 0;
  const create = async () => {
    calls++; await new Promise(r => setTimeout(r, 100));
    return { content: [], structuredContent: { success: true, tool: 'add_project', data: { projectId: 'p1', verified: true } } };
  };
  try {
    const [first, second] = await Promise.all([
      withIdempotency('add_project', 'key', { name: 'Project', flagged: true }, create),
      withIdempotency('add_project', 'key', { flagged: true, name: 'Project' }, create)
    ]);
    assert.equal(calls, 1);
    assert.equal(first.structuredContent.data.projectId, 'p1');
    assert.equal(second.structuredContent.meta.idempotency.replayed, true);
    await assert.rejects(withIdempotency('add_project', 'key', { name: 'different' }, create), /different arguments/);
    await assert.rejects(withIdempotency('add_project', 'uncertain', {}, async () => { throw new Error('connection lost'); }), /connection lost/);
    await assert.rejects(withIdempotency('add_project', 'uncertain', {}, create), /uncertain outcome/);
    assert.equal(calls, 1);
    await assert.rejects(withIdempotency('add_project', 'preview', { dryRun: true }, create), /dry run/);
    for (const entry of readdirSync(join(dir, 'requests'))) assert.equal(statSync(join(dir, 'requests', entry)).mode & 0o777, 0o600);
  } finally {
    if (old === undefined) delete process.env.OMNIFOCUS_MCP_STATE_DIR; else process.env.OMNIFOCUS_MCP_STATE_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  }
});
