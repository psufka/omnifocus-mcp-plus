import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectToolResult } from '../../utils/toolResult.js';
import { handler } from './editItem.js';

test('edit_item preserves preview and write outcomes through the result wrapper', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ofmcp-edit-item-'));
  const bin = join(dir, 'osascript');
  const output = join(dir, 'result.json');
  // Exercise the real primitive and handler without contacting OmniFocus.
  writeFileSync(bin, '#!/bin/sh\ncat > /dev/null\ncat "$(dirname "$0")/result.json"\n', { mode: 0o755 });
  const previousBin = process.env.OMNIFOCUS_OSASCRIPT_BIN;
  const previousState = process.env.OMNIFOCUS_MCP_STATE_DIR;
  process.env.OMNIFOCUS_OSASCRIPT_BIN = bin;
  process.env.OMNIFOCUS_MCP_STATE_DIR = join(dir, 'state');

  const item = { success: true, id: 'item-1', name: 'Original' };
  const changes = { newName: 'Updated' };
  const mismatches = [{ field: 'newName', expected: 'Updated', actual: 'Original' }];
  const cases = [
    ...(['task', 'project'] as const).map(itemType => ({
      name: `${itemType} preview`, itemType, dryRun: true,
      response: { ...item, dryRun: true, changes },
      success: true, verified: undefined, text: /^Would edit /
    })),
    {
      name: 'verified write', response: { ...item, verified: true },
      success: true, verified: true, text: /updated successfully/
    },
    {
      name: 'mismatched write', response: { ...item, verified: false, mismatches },
      success: false, verified: false, text: /newName: expected "Updated", got "Original"/
    },
    {
      name: 'write missing verification', response: item,
      success: false, verified: false, text: /read-back verification failed/
    },
    ...[false, true].map(dryRun => ({
      name: `${dryRun ? 'preview' : 'write'} lookup failure`, dryRun,
      response: { success: false, error: 'task not found with ID: item-1' },
      success: false, verified: undefined, text: /task not found/
    }))
  ];

  try {
    for (const scenario of cases) {
      await t.test(scenario.name, async () => {
        writeFileSync(output, JSON.stringify(scenario.response));
        const result = await collectToolResult('edit_item', () => handler({
          id: 'item-1', itemType: 'itemType' in scenario ? scenario.itemType : 'task',
          ...changes, dryRun: 'dryRun' in scenario ? scenario.dryRun : false
        }, {} as any));

        assert.equal(result.structuredContent.success, scenario.success);
        assert.equal(result.isError === true, !scenario.success);
        assert.equal(result.structuredContent.data.verified, scenario.verified);
        assert.match(result.content[0].text, scenario.text);
        if ('changes' in scenario.response) {
          assert.equal(result.structuredContent.data.dryRun, true);
          assert.deepEqual(result.structuredContent.data.changes, changes);
        }
        if ('mismatches' in scenario.response) {
          assert.deepEqual(result.structuredContent.data.mismatches, mismatches);
        }
      });
    }
  } finally {
    if (previousBin === undefined) delete process.env.OMNIFOCUS_OSASCRIPT_BIN;
    else process.env.OMNIFOCUS_OSASCRIPT_BIN = previousBin;
    if (previousState === undefined) delete process.env.OMNIFOCUS_MCP_STATE_DIR;
    else process.env.OMNIFOCUS_MCP_STATE_DIR = previousState;
    rmSync(dir, { recursive: true, force: true });
  }
});
