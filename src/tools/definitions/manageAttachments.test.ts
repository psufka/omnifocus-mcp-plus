import assert from 'node:assert/strict';
import test from 'node:test';

import { formatBytes, schema } from './manageAttachments.js';

function issues(result: ReturnType<typeof schema.safeParse>): string {
  return result.success ? '' : JSON.stringify(result.error.issues);
}

test('manage_attachments schema accepts each operation with its own shape', () => {
  const valid: Array<Record<string, unknown>> = [
    { operation: 'list', taskId: 't1' },
    { operation: 'list', projectName: 'Home Reno' },
    { operation: 'read', taskName: 'Buy milk', index: 0 },
    { operation: 'read', taskId: 't1', index: 2, savePath: '/tmp/out.pdf' },
    { operation: 'add', taskId: 't1', filename: 'receipt.pdf', base64: 'aGk=' },
    { operation: 'add', projectId: 'p1', filename: 'plan.md', filePath: '/tmp/plan.md' },
    { operation: 'remove', taskId: 't1', index: 1 }
  ];
  for (const args of valid) {
    const result = schema.safeParse(args);
    assert.equal(result.success, true, `${JSON.stringify(args)} rejected: ${issues(result)}`);
  }
});

test('manage_attachments schema rejects unknown top-level fields', () => {
  const result = schema.safeParse({ operation: 'list', taskId: 't1', bogusUnknownField: 1 });
  assert.equal(result.success, false);
  assert.match(issues(result), /bogusUnknownField|unrecognized/i);
});

test('manage_attachments schema requires exactly one item selector', () => {
  assert.equal(schema.safeParse({ operation: 'list' }).success, false);
  assert.equal(schema.safeParse({ operation: 'list', taskId: 't1', projectId: 'p1' }).success, false);
});

test('manage_attachments schema ties index to read and remove', () => {
  assert.equal(schema.safeParse({ operation: 'read', taskId: 't1' }).success, false);
  assert.equal(schema.safeParse({ operation: 'remove', taskId: 't1' }).success, false);
  assert.equal(schema.safeParse({ operation: 'list', taskId: 't1', index: 0 }).success, false);
  assert.equal(schema.safeParse({ operation: 'read', taskId: 't1', index: -1 }).success, false);
});

test('manage_attachments schema enforces the add contract', () => {
  // no filename
  assert.equal(schema.safeParse({ operation: 'add', taskId: 't1', base64: 'aGk=' }).success, false);
  // no source
  assert.equal(schema.safeParse({ operation: 'add', taskId: 't1', filename: 'a.txt' }).success, false);
  // both sources
  assert.equal(
    schema.safeParse({ operation: 'add', taskId: 't1', filename: 'a.txt', base64: 'aGk=', filePath: '/tmp/a.txt' }).success,
    false
  );
  // add-only fields on another operation
  assert.equal(schema.safeParse({ operation: 'list', taskId: 't1', filename: 'a.txt' }).success, false);
  assert.equal(schema.safeParse({ operation: 'list', taskId: 't1', base64: 'aGk=' }).success, false);
});

test('manage_attachments schema restricts savePath to read', () => {
  const result = schema.safeParse({ operation: 'remove', taskId: 't1', index: 0, savePath: '/tmp/x' });
  assert.equal(result.success, false);
  assert.match(issues(result), /only valid for operation 'read'/);
});

test('formatBytes renders human-readable sizes and an honest unknown', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB');
  assert.equal(formatBytes(null), 'size unknown');
  assert.equal(formatBytes(undefined), 'size unknown');
});
