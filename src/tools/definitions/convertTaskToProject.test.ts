import assert from 'node:assert/strict';
import test from 'node:test';
import { schema } from './convertTaskToProject.js';

test('convert_task_to_project schema accepts a task id or name', () => {
  assert.equal(schema.safeParse({ taskId: 't1' }).success, true);
  assert.equal(schema.safeParse({ taskName: 'Plan the trip' }).success, true);
});

test('convert_task_to_project schema requires a task', () => {
  const r = schema.safeParse({});
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /Either taskId or taskName/);
});

test('convert_task_to_project schema rejects both task identifiers', () => {
  const r = schema.safeParse({ taskId: 't1', taskName: 'Plan the trip' });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /Cannot specify both taskId and taskName/);
});

test('convert_task_to_project schema rejects both folder identifiers', () => {
  const r = schema.safeParse({ taskId: 't1', folderId: 'f1', folderName: 'Travel' });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /Cannot specify both folderId and folderName/);
});

test('convert_task_to_project schema accepts an optional destination folder', () => {
  assert.equal(schema.safeParse({ taskId: 't1', folderName: 'Travel' }).success, true);
  assert.equal(schema.safeParse({ taskId: 't1', folderId: 'f1' }).success, true);
});

test('convert_task_to_project schema accepts keepTags and rejects unknown fields', () => {
  assert.equal(schema.safeParse({ taskId: 't1', keepTags: false }).success, true);
  const r = schema.safeParse({ taskId: 't1', bogus: true });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /bogus|unrecognized/i);
});
