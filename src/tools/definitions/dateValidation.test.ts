import assert from 'node:assert/strict';
import test from 'node:test';

import { schema as editItemSchema } from './editItem.js';
import { schema as addTaskSchema } from './addOmniFocusTask.js';
import { schema as addProjectSchema } from './addProject.js';
import { schema as batchAddItemsSchema } from './batchAddItems.js';

// Bug 2 (v0.3.3): all four mutation schemas previously accepted any string for
// date fields and silently produced an Invalid Date inside OmniJS, leaving the
// task/project unchanged while reporting success. After the fix, garbage like
// "tomorrow" should be rejected at the schema boundary.

test('edit_item rejects newDueDate "tomorrow"', () => {
  const r = editItemSchema.safeParse({ id: 'X', itemType: 'task', newDueDate: 'tomorrow' });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /ISO 8601/i);
});

test('edit_item accepts newDueDate empty string (clear sentinel)', () => {
  const r = editItemSchema.safeParse({ id: 'X', itemType: 'task', newDueDate: '' });
  assert.equal(r.success, true);
});

test('edit_item accepts newDueDate with full ISO timestamp', () => {
  const r = editItemSchema.safeParse({ id: 'X', itemType: 'task', newDueDate: '2026-03-05T09:00:00-06:00' });
  assert.equal(r.success, true);
});

test('edit_item rejects newDeferDate and newPlannedDate garbage', () => {
  for (const field of ['newDeferDate', 'newPlannedDate']) {
    const r = editItemSchema.safeParse({ id: 'X', itemType: 'task', [field]: 'next week' });
    assert.equal(r.success, false, `${field} accepted garbage`);
  }
});

test('add_omnifocus_task rejects dueDate garbage', () => {
  const r = addTaskSchema.safeParse({ name: 'T', dueDate: 'not-a-date' });
  assert.equal(r.success, false);
});

test('add_omnifocus_task accepts valid ISO dueDate', () => {
  const r = addTaskSchema.safeParse({ name: 'T', dueDate: '2026-03-05T09:00:00-06:00' });
  assert.equal(r.success, true);
});

test('add_project rejects deferDate garbage', () => {
  const r = addProjectSchema.safeParse({ name: 'P', deferDate: 'someday' });
  assert.equal(r.success, false);
});

test('batch_add_items rejects items[].dueDate garbage', () => {
  const r = batchAddItemsSchema.safeParse({
    items: [{ itemType: 'task', name: 'T', dueDate: 'tomorrow' }],
  });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /ISO 8601/i);
});

test('batch_add_items accepts items[].dueDate full ISO', () => {
  const r = batchAddItemsSchema.safeParse({
    items: [{ itemType: 'task', name: 'T', dueDate: '2026-03-05T09:00:00-06:00' }],
  });
  assert.equal(r.success, true);
});
