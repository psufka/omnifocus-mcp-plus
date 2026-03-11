import assert from 'node:assert/strict';
import test from 'node:test';
import { addOmniFocusTask } from './addOmniFocusTask.js';

test('addOmniFocusTask rejects both parentTaskId and parentTaskName', async () => {
  const result = await addOmniFocusTask({
    name: 'Test Task',
    parentTaskId: 'id-1',
    parentTaskName: 'Parent Name'
  });

  assert.equal(result.success, false);
  assert.match(result.error || '', /Cannot specify both parentTaskId and parentTaskName/);
});

test('addOmniFocusTask rejects parent task with project', async () => {
  const result = await addOmniFocusTask({
    name: 'Test Task',
    parentTaskId: 'id-1',
    projectName: 'My Project'
  });

  assert.equal(result.success, false);
  assert.match(result.error || '', /Cannot specify both parent task and project/);
});
