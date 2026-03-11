import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEditItemParams } from './editItem.js';

test('validateEditItemParams requires id or name', () => {
  const validation = validateEditItemParams({
    itemType: 'task',
    newFlagged: true
  });
  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Either id or name must be provided/);
});

test('validateEditItemParams rejects task move parameters for project edits', () => {
  const validation = validateEditItemParams({
    id: 'project-1',
    itemType: 'project',
    newProjectName: 'ShouldFail'
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /only supported when itemType is "task"/);
});

test('validateEditItemParams rejects conflicting destination types', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newProjectId: 'proj-1',
    moveToInbox: true
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Invalid destination selection/);
});

test('validateEditItemParams rejects both newProjectId and newProjectName', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newProjectId: 'proj-1',
    newProjectName: 'Project'
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Cannot specify both newProjectId and newProjectName/);
});

test('validateEditItemParams rejects both newParentTaskId and newParentTaskName', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newParentTaskId: 'parent-1',
    newParentTaskName: 'Parent'
  });

  assert.equal(validation.valid, false);
  assert.match(validation.error || '', /Cannot specify both newParentTaskId and newParentTaskName/);
});

test('validateEditItemParams accepts valid task edit', () => {
  const validation = validateEditItemParams({
    id: 'task-1',
    itemType: 'task',
    newName: 'Updated Name',
    newFlagged: true,
    newProjectName: 'Destination'
  });

  assert.equal(validation.valid, true);
});

test('validateEditItemParams accepts valid project edit', () => {
  const validation = validateEditItemParams({
    name: 'My Project',
    itemType: 'project',
    newSequential: true,
    newProjectStatus: 'onHold'
  });

  assert.equal(validation.valid, true);
});
