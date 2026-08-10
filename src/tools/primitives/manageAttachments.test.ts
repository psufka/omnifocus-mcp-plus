import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  INLINE_BASE64_LIMIT_BYTES,
  MANAGE_ATTACHMENTS_SCRIPT,
  MAX_ATTACHMENT_BYTES,
  base64ByteLength,
  manageAttachments,
  resolveAddPayload,
  saveDecodedAttachment,
  validateManageAttachmentsParams
} from './manageAttachments.js';

const scratch = mkdtempSync(join(tmpdir(), 'of-attach-test-'));

// --- script hygiene ---

test('manage_attachments script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', MANAGE_ATTACHMENTS_SCRIPT));
});

test('manage_attachments script survives the runOmniJs escaping round-trip', () => {
  assert.ok(!MANAGE_ATTACHMENTS_SCRIPT.includes('`'), 'script contains a backtick');
  assert.ok(!MANAGE_ATTACHMENTS_SCRIPT.includes('$'), 'script contains a dollar sign');
  assert.ok(!MANAGE_ATTACHMENTS_SCRIPT.includes('\\'), 'script contains a backslash');
});

test('manage_attachments script reads user data only from the args object', () => {
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /\bargs\b/);
});

test('manage_attachments script uses the shared lookup helpers', () => {
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /__resolveByIdOrName\(flattenedTasks/);
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /__resolveByIdOrName\(flattenedProjects/);
});

test('manage_attachments script falls back across the unverified FileWrapper name fields', () => {
  // A wrapper built in memory has filename === null and only preferredFilename.
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /a\.filename/);
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /a\.preferredFilename/);
});

test('manage_attachments script reports an introspection error rather than throwing', () => {
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /Object\.getOwnPropertyNames/);
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /Data\.fromBase64 is missing/);
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /FileWrapper\.withContents is missing/);
});

test('manage_attachments script caps read size before encoding', () => {
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /size > MAX_BYTES/);
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /dataOmitted: true/);
});

test('manage_attachments script verifies the attachment count after every write', () => {
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /verified: afterAdd\.length === countBeforeAdd \+ 1/);
  assert.match(MANAGE_ATTACHMENTS_SCRIPT, /verified: afterRemove\.length === countBefore - 1/);
});

// --- validation ---

test('validateManageAttachmentsParams requires exactly one item selector', () => {
  assert.equal(validateManageAttachmentsParams({ operation: 'list' }).valid, false);
  assert.equal(validateManageAttachmentsParams({ operation: 'list', taskId: 't1', projectId: 'p1' }).valid, false);
  assert.equal(validateManageAttachmentsParams({ operation: 'list', taskId: 't1' }).valid, true);
  assert.equal(validateManageAttachmentsParams({ operation: 'list', projectName: 'Work' }).valid, true);
});

test('validateManageAttachmentsParams requires an index for read and remove only', () => {
  assert.equal(validateManageAttachmentsParams({ operation: 'read', taskId: 't1' }).valid, false);
  assert.equal(validateManageAttachmentsParams({ operation: 'remove', taskId: 't1', index: -1 }).valid, false);
  assert.equal(validateManageAttachmentsParams({ operation: 'remove', taskId: 't1', index: 0 }).valid, true);
  assert.equal(validateManageAttachmentsParams({ operation: 'list', taskId: 't1', index: 0 }).valid, false);
});

test('validateManageAttachmentsParams enforces the add contract', () => {
  assert.equal(validateManageAttachmentsParams({ operation: 'add', taskId: 't1', base64: 'aGk=' }).valid, false, 'filename required');
  assert.equal(
    validateManageAttachmentsParams({ operation: 'add', taskId: 't1', filename: 'a.txt' }).valid,
    false,
    'a source is required'
  );
  assert.equal(
    validateManageAttachmentsParams({ operation: 'add', taskId: 't1', filename: 'a.txt', base64: 'aGk=', filePath: '/tmp/a.txt' }).valid,
    false,
    'base64 and filePath are mutually exclusive'
  );
  assert.equal(
    validateManageAttachmentsParams({ operation: 'add', taskId: 't1', filename: 'a.txt', base64: 'aGk=' }).valid,
    true
  );
});

test('validateManageAttachmentsParams restricts savePath to read and to absolute paths', () => {
  assert.equal(validateManageAttachmentsParams({ operation: 'list', taskId: 't1', savePath: '/tmp/x' }).valid, false);
  const relative = validateManageAttachmentsParams({ operation: 'read', taskId: 't1', index: 0, savePath: 'out.pdf' });
  assert.equal(relative.valid, false);
  assert.match(relative.error || '', /absolute path/);
  assert.equal(
    validateManageAttachmentsParams({ operation: 'read', taskId: 't1', index: 0, savePath: '/tmp/out.pdf' }).valid,
    true
  );
});

// --- payload helpers ---

test('base64ByteLength computes the decoded size without allocating', () => {
  assert.equal(base64ByteLength(''), 0);
  assert.equal(base64ByteLength('aGk='), 2);            // "hi"
  assert.equal(base64ByteLength('aGVsbG8='), 5);        // "hello"
  assert.equal(base64ByteLength('YWJjZA=='.replace('YWJjZA==', 'YWJj')), 3); // "abc"
  assert.equal(base64ByteLength(Buffer.from('a'.repeat(1000)).toString('base64')), 1000);
});

test('resolveAddPayload accepts inline base64 and rejects malformed input', () => {
  const ok = resolveAddPayload({ operation: 'add', taskId: 't1', filename: 'a.txt', base64: 'aGk=' });
  assert.equal(ok.base64, 'aGk=');
  assert.equal(ok.byteSize, 2);

  const bad = resolveAddPayload({ operation: 'add', taskId: 't1', filename: 'a.txt', base64: 'not base64!!' });
  assert.match(bad.error || '', /not valid base64/);
});

test('resolveAddPayload enforces the 10MB cap on inline base64', () => {
  const oversized = 'A'.repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 1024) * 4 / 3));
  const result = resolveAddPayload({ operation: 'add', taskId: 't1', filename: 'big.bin', base64: oversized });
  assert.match(result.error || '', /over the .* byte limit/);
});

test('resolveAddPayload reads an absolute filePath from disk', () => {
  const path = join(scratch, 'note.txt');
  writeFileSync(path, 'hello attachments');
  const result = resolveAddPayload({ operation: 'add', taskId: 't1', filename: 'note.txt', filePath: path });
  assert.equal(result.byteSize, 17);
  assert.equal(Buffer.from(result.base64 as string, 'base64').toString('utf8'), 'hello attachments');
});

test('resolveAddPayload rejects relative and missing file paths', () => {
  assert.match(
    resolveAddPayload({ operation: 'add', taskId: 't1', filename: 'a.txt', filePath: 'relative.txt' }).error || '',
    /absolute path/
  );
  assert.match(
    resolveAddPayload({ operation: 'add', taskId: 't1', filename: 'a.txt', filePath: join(scratch, 'nope.txt') }).error || '',
    /No file at/
  );
});

test('saveDecodedAttachment writes the decoded bytes and refuses to overwrite', () => {
  const path = join(scratch, 'saved.txt');
  const saved = saveDecodedAttachment(path, Buffer.from('payload').toString('base64'));
  assert.equal(saved.path, path);
  assert.equal(saved.byteSize, 7);
  assert.equal(readFileSync(path, 'utf8'), 'payload');

  const again = saveDecodedAttachment(path, Buffer.from('other').toString('base64'));
  assert.match(again.error || '', /already exists/);
  assert.equal(readFileSync(path, 'utf8'), 'payload', 'the original file must be untouched');
});

test('saveDecodedAttachment rejects relative paths and missing directories', () => {
  assert.match(saveDecodedAttachment('out.txt', 'aGk=').error || '', /absolute path/);
  const missingDir = join(scratch, 'no-such-dir', 'x.txt');
  assert.match(saveDecodedAttachment(missingDir, 'aGk=').error || '', /Directory does not exist/);
  assert.equal(existsSync(missingDir), false);
});

// --- Node layer, with runOmniJs mocked ---

interface RunCall { script: string; args: any; options: any }

function mockRunner(response: any) {
  const calls: RunCall[] = [];
  const run = async (script: string, args?: any, options?: any) => {
    calls.push({ script, args, options });
    return response;
  };
  return { run: run as any, calls };
}

test('manageAttachments marks list and read read-only, add and remove not', async () => {
  const list = mockRunner({ success: true, count: 0, attachments: [] });
  await manageAttachments({ operation: 'list', taskId: 't1' }, list.run);
  assert.deepEqual(list.calls[0].options, { readOnly: true });

  const remove = mockRunner({ success: true, count: 0, attachments: [], verified: true });
  await manageAttachments({ operation: 'remove', taskId: 't1', index: 0 }, remove.run);
  assert.equal(remove.calls[0].options, undefined);
});

test('manageAttachments sends the size policy into the script', async () => {
  const { run, calls } = mockRunner({ success: true, count: 0, attachments: [] });
  await manageAttachments({ operation: 'list', taskId: 't1' }, run);
  assert.equal(calls[0].args.maxBytes, MAX_ATTACHMENT_BYTES);
  assert.equal(calls[0].args.inlineLimitBytes, INLINE_BASE64_LIMIT_BYTES);
  assert.equal(calls[0].args.savePathProvided, false);
});

test('manageAttachments converts filePath to base64 before the script runs', async () => {
  const path = join(scratch, 'attach-me.txt');
  writeFileSync(path, 'from disk');
  const { run, calls } = mockRunner({ success: true, addedIndex: 0, count: 1, attachments: [], verified: true });
  await manageAttachments({ operation: 'add', taskId: 't1', filename: 'attach-me.txt', filePath: path }, run);
  assert.equal(calls[0].args.base64, Buffer.from('from disk').toString('base64'));
  assert.equal(calls[0].args.filename, 'attach-me.txt');
  assert.equal(calls[0].args.filePath, undefined, 'the host path must never reach OmniJS');
});

test('manageAttachments fails an add whose file is missing, without running a script', async () => {
  const { run, calls } = mockRunner({ success: true });
  const result = await manageAttachments(
    { operation: 'add', taskId: 't1', filename: 'x.txt', filePath: join(scratch, 'absent.txt') },
    run
  );
  assert.equal(result.success, false);
  assert.match(result.error || '', /No file at/);
  assert.equal(calls.length, 0);
});

test('manageAttachments writes a read to savePath and drops the inline base64', async () => {
  const target = join(scratch, 'downloaded.txt');
  const { run } = mockRunner({
    success: true,
    operation: 'read',
    filename: 'downloaded.txt',
    byteSize: 7,
    base64: Buffer.from('payload').toString('base64')
  });
  const result = await manageAttachments(
    { operation: 'read', taskId: 't1', index: 0, savePath: target },
    run
  );
  assert.equal(result.success, true);
  assert.equal(result.savedPath, target);
  assert.equal(result.base64, undefined, 'base64 must not also be returned inline');
  assert.equal(readFileSync(target, 'utf8'), 'payload');
});

test('manageAttachments turns an omitted oversize payload into an actionable error', async () => {
  const { run } = mockRunner({
    success: true,
    operation: 'read',
    filename: 'scan.pdf',
    byteSize: 4_000_000,
    dataOmitted: true
  });
  const result = await manageAttachments({ operation: 'read', taskId: 't1', index: 0 }, run);
  assert.equal(result.success, false);
  assert.match(result.error || '', /too large to return inline/);
  assert.match(result.error || '', /savePath/);
});

test('manageAttachments keeps small inline reads intact', async () => {
  const { run } = mockRunner({
    success: true,
    operation: 'read',
    filename: 'tiny.txt',
    byteSize: 2,
    base64: 'aGk='
  });
  const result = await manageAttachments({ operation: 'read', taskId: 't1', index: 0 }, run);
  assert.equal(result.success, true);
  assert.equal(result.base64, 'aGk=');
});

test('manageAttachments reports a failed save without claiming success', async () => {
  const target = join(scratch, 'occupied.txt');
  writeFileSync(target, 'already here');
  const { run } = mockRunner({
    success: true,
    operation: 'read',
    filename: 'occupied.txt',
    byteSize: 7,
    base64: Buffer.from('payload').toString('base64')
  });
  const result = await manageAttachments({ operation: 'read', taskId: 't1', index: 0, savePath: target }, run);
  assert.equal(result.success, false);
  assert.match(result.error || '', /already exists/);
  assert.equal(readFileSync(target, 'utf8'), 'already here');
});

test('manageAttachments short-circuits invalid input without touching OmniFocus', async () => {
  const { run, calls } = mockRunner({ success: true });
  const result = await manageAttachments({ operation: 'read', taskId: 't1' }, run);
  assert.equal(result.success, false);
  assert.match(result.error || '', /index/);
  assert.equal(calls.length, 0);
});
