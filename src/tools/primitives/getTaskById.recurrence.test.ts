import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./getTaskById.ts', import.meta.url), 'utf8');
const script = source.split('    const task = lookup.item;')[1].split('\n  `;')[0];
const Task = { Status: { Available: 'Available', Blocked: 'Blocked', Completed: 'Completed', Dropped: 'Dropped', DueSoon: 'DueSoon', Next: 'Next', Overdue: 'Overdue' } };
function read(rule: unknown, error = false) {
  const task = Object.freeze({ id: { primaryKey: 'test' }, name: 'Test', note: '', parent: null, containingProject: null, children: [], tags: [], taskStatus: 'Available', flagged: false, dueDate: new Date('2026-10-06T10:45:00Z'), get repetitionRule() { if (error) throw new Error('not supported'); return rule; } });
  return JSON.parse(new Function('task', 'Task', script)(task, Task)).task;
}
test('returns fixed recurrence with due anchor without mutating the task', () => {
  const rule = Object.freeze({ ruleString: 'FREQ=DAILY;INTERVAL=2', method: '[Task.RepetitionMethod: Fixed]', scheduleType: '[Task.RepetitionScheduleType: Regularly]', anchorDateKey: '[Task.RepetitionAnchor: DueDate]', catchUpAutomatically: false });
  const result = read(rule);
  assert.deepEqual(result.repetitionRule, { ruleString: 'FREQ=DAILY;INTERVAL=2', method: 'Fixed', scheduleType: 'Regularly', anchorDateKey: 'DueDate', catchUpAutomatically: false });
  assert.equal(result.dueDate, '2026-10-06T10:45:00.000Z');
});
test('keeps completion-based recurrence distinct', () => {
  assert.equal(read({ ruleString: 'FREQ=WEEKLY;BYDAY=MO,FR', method: 'DueDate', scheduleType: 'FromCompletion', anchorDateKey: 'DueDate', catchUpAutomatically: true }).repetitionRule.scheduleType, 'FromCompletion');
});
test('distinguishes no recurrence from unavailable recurrence', () => {
  assert.equal(read(null).repetitionRule, null);
  const result = read(null, true);
  assert.equal('repetitionRule' in result, false);
  assert.match(result.repetitionRuleError, /not supported/);
});
