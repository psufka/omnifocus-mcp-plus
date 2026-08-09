import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { schema as addTaskSchema } from './addOmniFocusTask.js';
import { schema as batchAddItemsSchema } from './batchAddItems.js';

// add_omnifocus_task warned "bare dates like YYYY-MM-DD will display on the
// wrong day" while batch_add_items recommended exactly that format. Both are
// now normalized to local midnight (utils/localDate.ts), so the guidance has to
// say the same safe thing in both places.

function unwrapObject(schema: z.ZodTypeAny): z.ZodObject<any> {
  let current: any = schema;
  while (current && !(current instanceof z.ZodObject)) {
    current = current._def?.schema ?? current._def?.innerType;
  }
  assert.ok(current, 'could not unwrap to a ZodObject');
  return current;
}

const batchItemShape = unwrapObject((batchAddItemsSchema.shape.items as z.ZodArray<any>).element).shape;
const DATE_FIELDS = ['dueDate', 'deferDate', 'plannedDate'] as const;

for (const field of DATE_FIELDS) {
  test(`add_omnifocus_task and batch_add_items describe ${field} identically`, () => {
    const single = (addTaskSchema.shape as any)[field].description as string;
    const batch = (batchItemShape as any)[field].description as string;
    assert.ok(single, `add_omnifocus_task ${field} has no description`);
    assert.equal(single, batch, `${field} guidance differs between the single and batch tools`);
  });

  test(`${field} guidance calls a bare date LOCAL midnight, not a bug`, () => {
    const single = (addTaskSchema.shape as any)[field].description as string;
    assert.match(single, /LOCAL midnight/, `${field} does not explain how a bare date is interpreted`);
    assert.doesNotMatch(single, /wrong day/i, `${field} still carries the stale "wrong day" warning`);
  });
}

test('bare YYYY-MM-DD is accepted by both tools', () => {
  assert.equal(addTaskSchema.safeParse({ name: 'T', dueDate: '2026-03-05' }).success, true);
  assert.equal(
    batchAddItemsSchema.safeParse({ items: [{ itemType: 'task', name: 'T', dueDate: '2026-03-05' }] }).success,
    true
  );
});
