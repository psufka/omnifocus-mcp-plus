import assert from 'node:assert/strict';
import test from 'node:test';

import { schema as batchAddItemsSchema } from './batchAddItems.js';
import { schema as appendToNoteSchema } from './appendToNote.js';

// --- batch_add_items: items[].itemType (canonical) vs items[].type (legacy) ---

test('batch_add_items accepts canonical itemType and emits both itemType+type on transform', () => {
  const r = batchAddItemsSchema.safeParse({ items: [{ itemType: 'task', name: 'A' }] });
  assert.equal(r.success, true);
  if (r.success) {
    const item = (r.data as any).items[0];
    assert.equal(item.itemType, 'task');
    assert.equal(item.type, 'task');
  }
});

test('batch_add_items accepts legacy type and emits both itemType+type on transform', () => {
  const r = batchAddItemsSchema.safeParse({ items: [{ type: 'project', name: 'P' }] });
  assert.equal(r.success, true);
  if (r.success) {
    const item = (r.data as any).items[0];
    assert.equal(item.itemType, 'project');
    assert.equal(item.type, 'project');
  }
});

test('batch_add_items rejects items missing both itemType and type', () => {
  const r = batchAddItemsSchema.safeParse({ items: [{ name: 'X' }] });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /itemType.*required|legacy alias 'type'/i);
  }
});

// --- append_to_note: itemType/id (canonical) vs object_type/object_id (legacy) ---

test('append_to_note accepts canonical itemType+id', () => {
  const r = appendToNoteSchema.safeParse({ itemType: 'task', id: 'abc', text: 'hello' });
  assert.equal(r.success, true);
  if (r.success) {
    const d = r.data as any;
    assert.equal(d.itemType, 'task');
    assert.equal(d.id, 'abc');
    assert.equal(d.object_type, 'task');
    assert.equal(d.object_id, 'abc');
  }
});

test('append_to_note accepts legacy object_type+object_id', () => {
  const r = appendToNoteSchema.safeParse({ object_type: 'project', object_id: 'def', text: 'hi' });
  assert.equal(r.success, true);
  if (r.success) {
    const d = r.data as any;
    assert.equal(d.itemType, 'project');
    assert.equal(d.id, 'def');
    assert.equal(d.object_type, 'project');
    assert.equal(d.object_id, 'def');
  }
});

test('append_to_note accepts mixed canonical+legacy fields', () => {
  const r = appendToNoteSchema.safeParse({ itemType: 'task', object_id: 'ghi', text: 't' });
  assert.equal(r.success, true);
  if (r.success) {
    const d = r.data as any;
    assert.equal(d.itemType, 'task');
    assert.equal(d.id, 'ghi');
  }
});

test('append_to_note rejects missing both itemType and object_type', () => {
  const r = appendToNoteSchema.safeParse({ id: 'abc', text: 't' });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /itemType.*required|legacy alias 'object_type'/i);
  }
});

test('append_to_note rejects missing both id and object_id', () => {
  const r = appendToNoteSchema.safeParse({ itemType: 'task', text: 't' });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /id.*required|legacy alias 'object_id'/i);
  }
});

test('append_to_note rejects unknown field after strict+refine+transform chain', () => {
  const r = appendToNoteSchema.safeParse({ itemType: 'task', id: 'abc', text: 't', bogus: true });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /bogus|unrecognized/i);
  }
});
