import assert from 'node:assert/strict';
import test from 'node:test';

import { schema as editItemSchema } from './editItem.js';
import { schema as filterTasksSchema } from './filterTasks.js';
import { schema as batchAddItemsSchema } from './batchAddItems.js';
import { schema as uncompleteTaskSchema } from './uncompleteTask.js';
import { schema as completeTaskSchema } from './completeTask.js';
import { schema as appendToNoteSchema } from './appendToNote.js';
import { schema as setTaskRepetitionSchema } from './setTaskRepetition.js';
import { createFolderSchema } from './folderTools.js';
import { createTagSchema } from './tagTools.js';
import { addNotificationSchema } from './notificationTools.js';

// Each entry: (schema, minimal valid args) — strict() rejects ANY unknown key.
const cases: Array<{ name: string; schema: any; valid: Record<string, unknown> }> = [
  { name: 'edit_item',         schema: editItemSchema,         valid: { id: 'x', itemType: 'task', newFlagged: true } },
  { name: 'filter_tasks',      schema: filterTasksSchema,      valid: { flagged: true } },
  { name: 'batch_add_items',   schema: batchAddItemsSchema,    valid: { items: [{ itemType: 'task', name: 'X' }] } },
  { name: 'uncomplete_task',   schema: uncompleteTaskSchema,   valid: { task_id: 'abc' } },
  { name: 'complete_task',     schema: completeTaskSchema,     valid: { task_id: 'abc' } },
  { name: 'append_to_note',    schema: appendToNoteSchema,     valid: { itemType: 'task', id: 'abc', text: 'note' } },
  { name: 'set_task_repetition', schema: setTaskRepetitionSchema, valid: { task_id: 'abc', schedule_type: 'none' } },
  { name: 'create_folder',     schema: createFolderSchema,     valid: { name: 'F' } },
  { name: 'create_tag',        schema: createTagSchema,        valid: { name: 'T' } },
  { name: 'add_notification',  schema: addNotificationSchema,  valid: { taskId: 't', type: 'absolute', date: '2026-01-01T00:00:00Z' } },
];

for (const c of cases) {
  test(`${c.name} schema accepts minimal valid args`, () => {
    const r = c.schema.safeParse(c.valid);
    if (!r.success) {
      console.error(c.name, 'valid args failed:', JSON.stringify(r.error.issues));
    }
    assert.equal(r.success, true);
  });

  test(`${c.name} schema rejects unknown top-level field`, () => {
    const withExtra = { ...c.valid, bogusUnknownField: true };
    const r = c.schema.safeParse(withExtra);
    assert.equal(r.success, false, `${c.name} accepted unknown field`);
    if (!r.success) {
      assert.match(JSON.stringify(r.error.issues), /bogusUnknownField|unrecognized/i);
    }
  });
}

test('batch_add_items nested item schema rejects unknown fields', () => {
  const r = batchAddItemsSchema.safeParse({
    items: [{ itemType: 'task', name: 'X', bogusUnknownField: true }],
  });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /bogusUnknownField|unrecognized/i);
  }
});

test('edit_item rejects the canonical-bug case completed=true (unknown field)', () => {
  // The bug Paul confirmed: edit_item({itemType:"task", id:"X", completed:true})
  // previously returned success silently. With .strict(), it must error.
  const r = editItemSchema.safeParse({ itemType: 'task', id: 'X', completed: true });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /completed|unrecognized/i);
  }
});
