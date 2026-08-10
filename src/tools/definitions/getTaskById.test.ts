import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema } from './getTaskById.js';

const here = dirname(fileURLToPath(import.meta.url));
const definitionSource = readFileSync(join(here, 'getTaskById.ts'), 'utf8');
const primitiveSource = readFileSync(join(here, '..', 'primitives', 'getTaskById.ts'), 'utf8');

test('get_task_by_id schema accepts either identifier and rejects unknown fields', () => {
  assert.equal(schema.safeParse({ taskId: 't1' }).success, true);
  assert.equal(schema.safeParse({ taskName: 'Write report' }).success, true);
  assert.equal(schema.safeParse({ taskId: 't1', bogus: 1 }).success, false);
});

// The lookup moved to the shared helpers in v0.5.0; the rendered output is a
// public contract and must not drift with it.
test('get_task_by_id output format is unchanged by the lookup migration', () => {
  for (const marker of [
    '📋 \\*\\*Task Information\\*\\*',
    '\\*\\*Name\\*\\*',
    '\\*\\*ID\\*\\*',
    '\\*\\*Status\\*\\*',
    '\\*\\*Note\\*\\*',
    '\\*\\*Parent Task\\*\\*',
    '\\*\\*Project\\*\\*',
    '\\*\\*Due\\*\\*',
    '\\*\\*Effective Due\\*\\*',
    '\\*\\*Defer\\*\\*',
    '\\*\\*Effective Defer\\*\\*',
    '\\*\\*Planned\\*\\*',
    '\\*\\*Has Children\\*\\*'
  ]) {
    assert.match(definitionSource, new RegExp(marker), `output format lost the ${marker} line`);
  }
});

test('get_task_by_id returns every field the renderer consumes', () => {
  for (const field of [
    'taskStatus', 'flagged', 'completed', 'dropped', 'note', 'parentId', 'parentName',
    'projectId', 'projectName', 'hasChildren', 'childrenCount', 'tags',
    'dueDate', 'effectiveDueDate', 'deferDate', 'effectiveDeferDate', 'plannedDate', 'estimatedMinutes'
  ]) {
    assert.match(primitiveSource, new RegExp(`${field}:`), `primitive stopped returning ${field}`);
  }
});
