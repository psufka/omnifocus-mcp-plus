import assert from 'node:assert/strict';
import test from 'node:test';
import { AddProjectParams } from './addProject.js';

test('AddProjectParams interface accepts all expected fields', () => {
  // Type-level test: ensure the interface shape is correct
  const params: AddProjectParams = {
    name: 'Test Project',
    note: 'A note',
    dueDate: '2026-03-15T17:00:00-05:00',
    deferDate: '2026-03-10T09:00:00-05:00',
    plannedDate: '2026-03-12T09:00:00-05:00',
    flagged: true,
    estimatedMinutes: 60,
    tags: ['Work', 'Urgent'],
    folderName: 'My Folder',
    sequential: true
  };

  assert.equal(params.name, 'Test Project');
  assert.equal(params.sequential, true);
  assert.equal(params.tags?.length, 2);
});
