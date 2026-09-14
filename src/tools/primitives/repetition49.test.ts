import assert from 'node:assert/strict';
import test from 'node:test';
import { schema } from '../definitions/setTaskRepetition.js';
import { buildRuleString } from '../../utils/rrule.js';

test('structured next-to-last weekday and calendar day produce distinct recurrence rules', () => {
  const base = { task_id: 'schema-only', schedule_type: 'regularly' as const, frequency: 'monthly' as const };
  const friday = schema.parse({ ...base, daysOfWeek: [{ day: 'friday', position: -2 }] });
  const day = schema.parse({ ...base, daysOfMonth: [-2] });
  assert.equal(buildRuleString(friday as any), 'FREQ=MONTHLY;INTERVAL=1;BYDAY=-2FR');
  assert.equal(buildRuleString(day as any), 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-2');
});

test('new ordinals preserve existing validation and last-day behavior', () => {
  const base = { task_id: 'schema-only', schedule_type: 'regularly', frequency: 'monthly' };
  for (const position of [-3, 0, 5, -1.5]) {
    assert.equal(schema.safeParse({ ...base, daysOfWeek: [{ day: 'friday', position }] }).success, false);
  }
  for (const day of [-3, 0, 32]) assert.equal(schema.safeParse({ ...base, daysOfMonth: [day] }).success, false);
  assert.equal(schema.safeParse({ ...base, frequency: 'weekly', daysOfWeek: [{ day: 'friday', position: -2 }] }).success, false);
  assert.equal(schema.safeParse({ ...base, daysOfMonth: [-2], daysOfWeek: ['friday'] }).success, false);
  assert.equal(buildRuleString({ frequency: 'monthly', daysOfMonth: [-1] }), 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
});
