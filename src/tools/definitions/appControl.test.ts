import assert from 'node:assert/strict';
import test from 'node:test';

import { schema } from './appControl.js';

function issues(result: ReturnType<typeof schema.safeParse>): string {
  return result.success ? '' : JSON.stringify(result.error.issues);
}

test('app_control schema accepts each operation with its own shape', () => {
  const valid: Array<Record<string, unknown>> = [
    { operation: 'sync' },
    { operation: 'undo' },
    { operation: 'undo', confirm: true },
    { operation: 'redo', confirm: false },
    { operation: 'get_focus' },
    { operation: 'clear_focus' },
    { operation: 'set_focus', folderNames: ['Work'] },
    { operation: 'set_focus', projectIds: ['p1'], folderIds: ['f1'] },
    { operation: 'reveal', taskId: 't1' },
    { operation: 'reveal', projectName: 'Home Reno' }
  ];
  for (const args of valid) {
    const result = schema.safeParse(args);
    assert.equal(result.success, true, `${JSON.stringify(args)} rejected: ${issues(result)}`);
  }
});

test('app_control schema rejects unknown top-level fields', () => {
  const result = schema.safeParse({ operation: 'sync', bogusUnknownField: true });
  assert.equal(result.success, false);
  assert.match(issues(result), /bogusUnknownField|unrecognized/i);
});

test('app_control schema requires a target for set_focus', () => {
  assert.equal(schema.safeParse({ operation: 'set_focus' }).success, false);
  assert.equal(schema.safeParse({ operation: 'set_focus', folderNames: [] }).success, false);
});

test('app_control schema catches the singular/plural field mix-up in both directions', () => {
  // set_focus given the reveal fields
  const singularOnFocus = schema.safeParse({ operation: 'set_focus', projectId: 'p1' });
  assert.equal(singularOnFocus.success, false);
  assert.match(issues(singularOnFocus), /only valid with operation 'reveal'/);

  // reveal given the set_focus fields
  const pluralOnReveal = schema.safeParse({ operation: 'reveal', projectIds: ['p1'] });
  assert.equal(pluralOnReveal.success, false);
  assert.match(issues(pluralOnReveal), /only valid with operation 'set_focus'/);
});

test('app_control schema requires exactly one reveal target', () => {
  assert.equal(schema.safeParse({ operation: 'reveal' }).success, false);
  assert.equal(schema.safeParse({ operation: 'reveal', taskId: 't1', taskName: 'X' }).success, false);
});

test('app_control schema rejects confirm on operations that cannot be confirmed', () => {
  const result = schema.safeParse({ operation: 'sync', confirm: true });
  assert.equal(result.success, false);
  assert.match(issues(result), /only meaningful for operation 'undo' or 'redo'/);
});

test('app_control schema rejects an unknown operation', () => {
  assert.equal(schema.safeParse({ operation: 'quit' }).success, false);
});
