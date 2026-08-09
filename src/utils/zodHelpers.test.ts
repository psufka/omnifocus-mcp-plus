import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { isoDateDescription, optionalIsoDate, requiredIsoDate } from './zodHelpers.js';

// requiredIsoDate mirrors optionalIsoDate's validation without the empty-string
// escape hatch. Before it existed, add_notification's `date` was a plain
// z.string() and "tomorrow" travelled all the way into OmniJS as Invalid Date.

test('requiredIsoDate rejects "tomorrow"', () => {
  const r = requiredIsoDate('d').safeParse('tomorrow');
  assert.equal(r.success, false);
  if (!r.success) assert.match(JSON.stringify(r.error.issues), /ISO 8601/i);
});

test('requiredIsoDate rejects garbage and impossible dates', () => {
  for (const bad of ['next week', '2026-13-50', 'soon', 'null']) {
    assert.equal(requiredIsoDate('d').safeParse(bad).success, false, `accepted ${bad}`);
  }
});

test('requiredIsoDate rejects the empty string (unlike optionalIsoDate)', () => {
  assert.equal(requiredIsoDate('d').safeParse('').success, false);
  assert.equal(optionalIsoDate('d').safeParse('').success, true);
});

test('requiredIsoDate rejects a missing value', () => {
  const schema = z.object({ date: requiredIsoDate('d') });
  assert.equal(schema.safeParse({}).success, false);
});

test('requiredIsoDate accepts bare dates and full ISO timestamps', () => {
  for (const good of ['2026-03-05', '2026-03-05T09:00:00', '2026-03-05T09:00:00-06:00', '2026-03-05T15:00:00Z']) {
    assert.equal(requiredIsoDate('d').safeParse(good).success, true, `rejected ${good}`);
  }
});

test('requiredIsoDate keeps its description through .optional()', () => {
  const field = requiredIsoDate('When it fires').optional();
  const inner: any = (field as any)._def.innerType;
  assert.equal(inner.description, 'When it fires');
});

test('isoDateDescription documents bare dates as LOCAL midnight, not as a bug', () => {
  const description = isoDateDescription('The due date');
  assert.match(description, /^The due date\./);
  assert.match(description, /LOCAL midnight/);
  // The old guidance ("bare dates will display on the wrong day") contradicted
  // batch_add_items, which recommended the bare form. Neither should survive.
  assert.doesNotMatch(description, /wrong day/i);
});
