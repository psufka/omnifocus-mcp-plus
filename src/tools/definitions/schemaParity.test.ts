import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { schema as addTaskSchema } from './addOmniFocusTask.js';
import { batchAddItemObjectSchema } from './batchAddItems.js';

// Schema parity: batch_add_items' item spec must be a SUPERSET of
// add_omnifocus_task's schema.
//
// The bug this locks out: upstream shipped a batch item schema that had drifted
// from the single-add schema, so fields the caller sent were silently dropped
// and every batched task landed in the inbox while the tool reported success.
// A field can only be dropped like that if the two surfaces disagree about it —
// so the two shapes are compared field by field, by base zod type.
//
// Direction is one-way on purpose: batch-only extras (itemType/type,
// folderName, sequential, tempId, parentTempId) are expected and allowed.

/** Strip optional/nullable/default/effects wrappers down to the base type. */
function baseType(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def: any = (schema as any)._def;
  const typeName = def?.typeName;
  if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault') {
    return baseType(def.innerType);
  }
  if (typeName === 'ZodEffects' && def.schema) {
    return baseType(def.schema);
  }
  return schema;
}

function typeNameOf(schema: z.ZodTypeAny): string {
  return (baseType(schema) as any)._def?.typeName ?? 'unknown';
}

/** For arrays, the element's base type name — so string[] vs number[] differ. */
function elementTypeNameOf(schema: z.ZodTypeAny): string | null {
  const base: any = baseType(schema);
  if (base?._def?.typeName !== 'ZodArray') return null;
  return typeNameOf(base._def.type);
}

/** Enum members, sorted — so two enums with different members differ. */
function enumValuesOf(schema: z.ZodTypeAny): string | null {
  const base: any = baseType(schema);
  if (base?._def?.typeName !== 'ZodEnum') return null;
  return [...(base._def.values as string[])].sort().join('|');
}

const singleShape = addTaskSchema.shape as z.ZodRawShape;
const batchShape = batchAddItemObjectSchema.shape as z.ZodRawShape;

const singleKeys = Object.keys(singleShape);

test('add_omnifocus_task exposes the fields this parity test is meant to cover', () => {
  // Guards against the test silently passing because one side became empty.
  assert.ok(singleKeys.length >= 10, `expected add_omnifocus_task to have >=10 fields, got ${singleKeys.length}`);
  assert.ok(singleKeys.includes('name'));
  assert.ok(singleKeys.includes('projectName'));
  assert.ok(singleKeys.includes('parentTaskId'));
});

for (const key of singleKeys) {
  test(`batch_add_items item spec has add_omnifocus_task's "${key}"`, () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(batchShape, key),
      `batch_add_items item spec is missing "${key}" — a caller sending it to batch_add_items would have it silently dropped (or rejected by .strict()) while add_omnifocus_task accepts it.`
    );
  });

  test(`batch_add_items "${key}" has the same base type as add_omnifocus_task`, () => {
    if (!Object.prototype.hasOwnProperty.call(batchShape, key)) return; // reported by the test above
    const single = singleShape[key] as z.ZodTypeAny;
    const batch = batchShape[key] as z.ZodTypeAny;

    assert.equal(
      typeNameOf(batch),
      typeNameOf(single),
      `"${key}" is ${typeNameOf(single)} in add_omnifocus_task but ${typeNameOf(batch)} in batch_add_items`
    );

    assert.equal(
      elementTypeNameOf(batch),
      elementTypeNameOf(single),
      `"${key}" array element type differs between add_omnifocus_task and batch_add_items`
    );

    assert.equal(
      enumValuesOf(batch),
      enumValuesOf(single),
      `"${key}" enum members differ between add_omnifocus_task and batch_add_items`
    );
  });
}

test('batch-only extras are allowed (parity is one-way: batch superset of single)', () => {
  const batchOnly = Object.keys(batchShape).filter(k => !singleKeys.includes(k));
  // Documents the intended extras; a NEW unexpected extra is fine, but the
  // known ones must not disappear silently.
  for (const expected of ['itemType', 'type', 'folderName', 'sequential', 'tempId', 'parentTempId']) {
    assert.ok(batchOnly.includes(expected), `batch_add_items lost its batch-only field "${expected}"`);
  }
});

test('both schemas reject unknown fields (strict on the item spec too)', () => {
  assert.equal(addTaskSchema.safeParse({ name: 'T', bogus: 1 }).success, false);
  assert.equal(batchAddItemObjectSchema.safeParse({ itemType: 'task', name: 'T', bogus: 1 }).success, false);
});
