import assert from 'node:assert/strict';
import test from 'node:test';
import { handler, schema } from './moveTask.js';

test('move_task schema accepts source and destination fields', () => {
  const parsed = schema.parse({
    id: 'task-1',
    targetProjectId: 'project-1'
  }) as any;

  assert.equal(parsed.id, 'task-1');
  assert.equal(parsed.targetProjectId, 'project-1');
});

test('move_task schema preserves targetInbox boolean', () => {
  const parsed = schema.parse({
    name: 'My Task',
    targetInbox: true
  }) as any;

  assert.equal(parsed.targetInbox, true);
});

test('move_task handler returns validation errors for conflicting destinations', async () => {
  const result = await handler({
    id: 'task-1',
    targetProjectId: 'project-1',
    targetInbox: true
  }, {} as any);

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Exactly one destination/);
});

// --- Post-write verification -------------------------------------------------
// editItem (which move_task delegates to) read-back verifies the container.
// move_task used to drop `verified`/`mismatches` on the floor and print
// "moved successfully to <the destination you asked for>" whenever the write
// itself did not throw.

const editItemResult = (over: Record<string, any> = {}) => ({
  success: true,
  id: 'task-1',
  name: 'Wandering task',
  changedProperties: 'project',
  ...over
});

test('move_task reports a failed read-back as an error, naming the ACTUAL destination', async () => {
  const result: any = await handler(
    { id: 'task-1', targetProjectName: 'Work' },
    {} as any,
    {
      moveTask: async () => editItemResult({
        verified: false,
        mismatches: [{ field: 'project', expected: 'Work', actual: 'Personal' }]
      })
    } as any
  );

  assert.equal(result.isError, true, 'a task that never moved was reported as a success');
  const text = result.content[0].text;
  assert.match(text, /NOT moved to project "Work"/);
  assert.match(text, /It is in "Personal"/, 'the actual destination is missing');
  assert.match(text, /project: expected "Work", got "Personal"/, 'the mismatch list is missing');
  assert.doesNotMatch(text, /moved successfully/);
});

test('move_task reports a failed move to the inbox with the container it is actually in', async () => {
  const result: any = await handler(
    { id: 'task-1', targetInbox: true },
    {} as any,
    {
      moveTask: async () => editItemResult({
        verified: false,
        mismatches: [{ field: 'moveToInbox', expected: 'inbox', actual: 'Work' }]
      })
    } as any
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /NOT moved to inbox.*It is in "Work"/s);
});

test('move_task still reports a verified move as a success', async () => {
  const result: any = await handler(
    { id: 'task-1', targetProjectName: 'Work' },
    {} as any,
    { moveTask: async () => editItemResult({ verified: true }) } as any
  );

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /moved successfully to project "Work"/);
});

test('move_task renders a date mismatch locally, with no Z timestamp', async () => {
  const result: any = await handler(
    { id: 'task-1', targetProjectName: 'Work' },
    {} as any,
    {
      moveTask: async () => editItemResult({
        verified: false,
        mismatches: [
          { field: 'project', expected: 'Work', actual: null },
          { field: 'newDueDate', expected: new Date(2026, 2, 6).getTime(), actual: null, kind: 'date' as const }
        ]
      })
    } as any
  );

  const text = result.content[0].text;
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/);
  assert.match(text, /It is in no project/);
});

test('move_task passes verified and mismatches through the primitive', async () => {
  const { moveTask } = await import('../primitives/moveTask.js');
  const mismatches = [{ field: 'project', expected: 'Work', actual: 'Personal' }];

  const result = await moveTask(
    { id: 'task-1', targetProjectName: 'Work' },
    {
      editItem: async () => ({
        success: true,
        id: 'task-1',
        name: 'Wandering task',
        verified: false,
        mismatches
      })
    } as any
  );

  assert.equal(result.verified, false, 'the primitive dropped the verification flag');
  assert.deepEqual(result.mismatches, mismatches, 'the primitive dropped the mismatch list');
});
