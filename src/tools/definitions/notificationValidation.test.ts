import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { addNotificationSchema, removeNotificationSchema } from './notificationTools.js';

// add_notification's `date` used to be a plain z.string(): "tomorrow" was
// accepted at the boundary and became an Invalid Date deep inside OmniJS.

test('add_notification rejects date "tomorrow"', () => {
  const r = addNotificationSchema.safeParse({ taskId: 't', type: 'absolute', date: 'tomorrow' });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /ISO 8601/i);
});

test('add_notification accepts a full ISO date and a bare local date', () => {
  for (const date of ['2026-03-15T09:00:00-05:00', '2026-03-15']) {
    const r = addNotificationSchema.safeParse({ taskId: 't', type: 'absolute', date });
    assert.equal(r.success, true, `rejected ${date}`);
  }
});

test('add_notification requires date when type is absolute', () => {
  const r = addNotificationSchema.safeParse({ taskId: 't', type: 'absolute' });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /date is required/i);
});

test('add_notification requires minutesBefore when type is relative', () => {
  const r = addNotificationSchema.safeParse({ taskId: 't', type: 'relative' });
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /minutesBefore is required/i);
});

test('add_notification rejects negative minutesBefore', () => {
  const r = addNotificationSchema.safeParse({ taskId: 't', type: 'relative', minutesBefore: -30 });
  assert.equal(r.success, false);
});

test('add_notification accepts minutesBefore of 0 (fires at the due time)', () => {
  const r = addNotificationSchema.safeParse({ taskId: 't', type: 'relative', minutesBefore: 0 });
  assert.equal(r.success, true);
});

test('remove_notification rejects a negative or fractional index', () => {
  assert.equal(removeNotificationSchema.safeParse({ taskId: 't', index: -1 }).success, false);
  assert.equal(removeNotificationSchema.safeParse({ taskId: 't', index: 1.5 }).success, false);
  assert.equal(removeNotificationSchema.safeParse({ taskId: 't', index: 0 }).success, true);
});

// --- primitive-source guarantees (the OmniJS runtime is not available here) ---

const primitiveSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'primitives', 'notificationTools.ts'),
  'utf8'
);

test('add_notification errors in-script when a relative reminder has no due date', () => {
  assert.match(primitiveSrc, /if \(!task\.dueDate\)/, 'no due-date guard for relative notifications');
  assert.match(primitiveSrc, /the task has no due date/);
});

test('add_notification normalizes the date before OmniJS parses it', () => {
  assert.match(primitiveSrc, /toLocalDateTimeString\(params\.date\)/);
});

test('remove_notification returns the post-removal notification list', () => {
  assert.match(primitiveSrc, /remainingNotifications: remaining/);
  assert.match(primitiveSrc, /__describeNotifications\(task\)/);
});

test('remove_notification reports the valid index range on an out-of-range index', () => {
  assert.match(primitiveSrc, /is out of range/);
  assert.match(primitiveSrc, /valid indices are 0-/);
});

test('notification lookups use the strict shared helper', () => {
  assert.match(primitiveSrc, /OMNIJS_LOOKUP_HELPERS/);
  const lookups = primitiveSrc.match(/__resolveByIdOrName\(flattenedTasks, args\.taskId, args\.taskName, 'Task'\)/g) || [];
  assert.equal(lookups.length, 3, 'all three notification tools should share the lookup helper');
});
