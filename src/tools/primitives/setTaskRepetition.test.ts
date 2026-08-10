import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema, baseSchema } from '../definitions/setTaskRepetition.js';
import { SET_TASK_REPETITION_SCRIPT } from './setTaskRepetition.js';
import { rulesEquivalent as rulesEquivalentNode } from '../../utils/rrule.js';

/**
 * Compile the comparator the SCRIPT carries (its own copy of rulesEquivalent,
 * so the rollback decision can happen inside the single OmniJS evaluation).
 */
function inScriptRulesEquivalent(): (a: string, b: string) => boolean {
  return new Function(
    'a', 'b',
    `${SET_TASK_REPETITION_SCRIPT.slice(
      SET_TASK_REPETITION_SCRIPT.indexOf('var __RRULE_LIST_KEYS'),
      SET_TASK_REPETITION_SCRIPT.indexOf('// "[object Task.RepetitionMethod')
    )}\nreturn __rulesEquivalent(a, b);`
  ) as (a: string, b: string) => boolean;
}

// The repetition mapping lives inside an OmniJS script string, so it cannot be
// executed without the OmniFocus runtime. As with omniJsScriptPatches.test.ts,
// the regression check asserts on the source.

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'setTaskRepetition.ts'), 'utf8');

test('setTaskRepetition never references the non-existent DueAfterCompletion method', () => {
  // Verified against OmniFocus 185.19: Task.RepetitionMethod members are
  // None / Fixed / DeferUntilDate / DueDate. DueAfterCompletion is undefined,
  // and `new Task.RepetitionRule(rule, undefined)` silently builds a FIXED
  // rule — so the old mapping made "repeat after completion" repeat on a
  // fixed schedule.
  assert.doesNotMatch(src, /DueAfterCompletion/, 'setTaskRepetition still references Task.RepetitionMethod.DueAfterCompletion');
});

test("setTaskRepetition maps 'from_completion' to Task.RepetitionMethod.DueDate", () => {
  assert.match(
    src,
    /args\.schedule_type === 'from_completion'\s*\)\s*\{\s*method = Task\.RepetitionMethod\.DueDate;/,
    "from_completion must map to Task.RepetitionMethod.DueDate ('Due Again')"
  );
});

test("setTaskRepetition maps 'defer_from_completion' to Task.RepetitionMethod.DeferUntilDate", () => {
  assert.match(
    src,
    /args\.schedule_type === 'defer_from_completion'\s*\)\s*\{\s*method = Task\.RepetitionMethod\.DeferUntilDate;/,
    "defer_from_completion must map to Task.RepetitionMethod.DeferUntilDate ('Defer Another')"
  );
});

test('setTaskRepetition falls back to Fixed only for the regular schedule', () => {
  assert.match(src, /else \{\s*method = Task\.RepetitionMethod\.Fixed;/, 'missing Fixed fallback branch');
});

test('setTaskRepetition rejects an undefined method instead of silently building a Fixed rule', () => {
  assert.match(src, /if \(!method\)/, 'missing guard against an undefined RepetitionMethod');
  assert.match(src, /Unsupported schedule_type for this OmniFocus version/, 'missing unsupported-method error message');
});

test('set_task_repetition schema accepts all four schedule types', () => {
  for (const schedule_type of ['regularly', 'from_completion', 'defer_from_completion', 'none']) {
    const r = schema.safeParse({ task_id: 'abc', rule_string: 'FREQ=DAILY;INTERVAL=1', schedule_type });
    assert.equal(r.success, true, `schedule_type "${schedule_type}" should be accepted`);
  }
});

test('set_task_repetition schema rejects an unknown schedule type', () => {
  const r = schema.safeParse({ task_id: 'abc', schedule_type: 'after_completion' });
  assert.equal(r.success, false);
});

test('set_task_repetition schema documents the completion-based methods', () => {
  // `schema` is a ZodEffects once the cross-field refinements are attached, so
  // per-field descriptions are read from the unrefined base object.
  const described = JSON.stringify(baseSchema.shape.schedule_type.description);
  assert.match(described, /Due Again/, 'from_completion should be documented as OmniFocus "Due Again"');
  assert.match(described, /Defer Another/, 'defer_from_completion should be documented as OmniFocus "Defer Another"');
});

// ---------------------------------------------------------------------------
// Probe-derived invariants (OmniFocus 4.8.13)
// ---------------------------------------------------------------------------

test('setTaskRepetition never passes a third argument to the RepetitionRule constructor', () => {
  // Probed live: the constructor declares a third parameter typed
  // Task.RepetitionScheduleType, but supplying ANY value for it — including a
  // valid ScheduleType member — throws a bare `Error`.
  const constructorCalls = src.match(/new Task\.RepetitionRule\([^)]*\)/g) ?? [];
  assert.ok(constructorCalls.length > 0, 'expected at least one RepetitionRule construction');
  for (const call of constructorCalls) {
    const argCount = call.slice(call.indexOf('(') + 1, -1).split(',').length;
    assert.equal(argCount, 2, `RepetitionRule must be constructed with exactly 2 args, got: ${call}`);
  }
});

test('setTaskRepetition never tries to assign the read-only rule properties', () => {
  // Probed live: ruleString / method / scheduleType / anchorDateKey /
  // catchUpAutomatically all throw "The property X is read-only." on assignment,
  // on a detached rule and on one already attached to a task.
  for (const prop of ['anchorDateKey', 'catchUpAutomatically', 'scheduleType', 'ruleString']) {
    assert.doesNotMatch(
      src,
      new RegExp(`\\.${prop}\\s*=[^=]`),
      `${prop} is read-only in OmniJS — assigning it throws`
    );
  }
});

test('set_task_repetition schema exposes no anchor or catch-up parameter', () => {
  // Reject-loud: the platform cannot honour them, so the schema must not offer
  // them. (Task.AnchorDateKey.PlannedDate exists as an enum member but is
  // unreachable — anchor is derived from `method`.)
  const fields = Object.keys(baseSchema.shape);
  assert.ok(!fields.includes('anchor'), 'anchor is not writable in OmniJS and must not be a parameter');
  assert.ok(!fields.includes('catchUpAutomatically'), 'catchUpAutomatically is not writable in OmniJS and must not be a parameter');
});

// ---------------------------------------------------------------------------
// Structured rule parameters
// ---------------------------------------------------------------------------

test('set_task_repetition schema accepts structured fields without rule_string', () => {
  const r = schema.safeParse({
    task_id: 'abc',
    schedule_type: 'regularly',
    frequency: 'weekly',
    interval: 2,
    daysOfWeek: ['monday', 'wednesday']
  });
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
});

test('set_task_repetition schema accepts ordinal weekday specs', () => {
  const r = schema.safeParse({
    task_id: 'abc',
    schedule_type: 'from_completion',
    frequency: 'monthly',
    daysOfWeek: [{ day: 'tuesday', position: 2 }]
  });
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
});

test('set_task_repetition schema rejects rule_string together with structured fields', () => {
  const r = schema.safeParse({
    task_id: 'abc',
    schedule_type: 'regularly',
    rule_string: 'FREQ=DAILY',
    frequency: 'daily'
  });
  assert.equal(r.success, false);
  assert.match(JSON.stringify((r as any).error.issues), /not both/);
});

test('set_task_repetition schema rejects a schedule with neither rule_string nor structured fields', () => {
  const r = schema.safeParse({ task_id: 'abc', schedule_type: 'regularly' });
  assert.equal(r.success, false);
  assert.match(JSON.stringify((r as any).error.issues), /rule_string or the structured fields/);
});

test('set_task_repetition schema requires frequency when other structured fields are used', () => {
  const r = schema.safeParse({ task_id: 'abc', schedule_type: 'regularly', interval: 3 });
  assert.equal(r.success, false);
  assert.match(JSON.stringify((r as any).error.issues), /frequency is required/);
});

test('set_task_repetition schema rejects structured fields alongside schedule_type none', () => {
  const r = schema.safeParse({ task_id: 'abc', schedule_type: 'none', frequency: 'daily' });
  assert.equal(r.success, false);
  assert.match(JSON.stringify((r as any).error.issues), /clears repetition/);
});

test('set_task_repetition schema still tolerates rule_string with schedule_type none (back-compat)', () => {
  const r = schema.safeParse({ task_id: 'abc', schedule_type: 'none', rule_string: 'FREQ=DAILY' });
  assert.equal(r.success, true);
});

test('set_task_repetition schema surfaces rrule composition errors at validation time', () => {
  const bad = [
    { frequency: 'daily', daysOfWeek: ['monday'] },
    { frequency: 'weekly', daysOfWeek: [{ day: 'tuesday', position: 2 }] },
    { frequency: 'weekly', daysOfMonth: [1] },
    { frequency: 'daily', count: 2, endDate: '2026-12-31' },
    { frequency: 'monthly', daysOfWeek: ['monday'], daysOfMonth: [1] }
  ];
  for (const extra of bad) {
    const r = schema.safeParse({ task_id: 'abc', schedule_type: 'regularly', ...extra });
    assert.equal(r.success, false, `expected rejection for ${JSON.stringify(extra)}`);
  }
});

test('set_task_repetition schema rejects an out-of-range weekday position', () => {
  const r = schema.safeParse({
    task_id: 'abc',
    schedule_type: 'regularly',
    frequency: 'monthly',
    daysOfWeek: [{ day: 'tuesday', position: 9 }]
  });
  assert.equal(r.success, false);
});

test('set_task_repetition daysOfWeek entries reject unknown nested keys', () => {
  // A non-strict nested object would silently drop a typo'd `positon`, turning
  // "2nd Tuesday" into "every Tuesday".
  const r = schema.safeParse({
    task_id: 'abc',
    schedule_type: 'regularly',
    frequency: 'monthly',
    daysOfWeek: [{ day: 'tuesday', positon: 2 }]
  });
  assert.equal(r.success, false);
});

test('set_task_repetition schema rejects an unparseable endDate', () => {
  const r = schema.safeParse({
    task_id: 'abc',
    schedule_type: 'regularly',
    frequency: 'daily',
    endDate: 'next tuesday'
  });
  assert.equal(r.success, false);
});

// ---------------------------------------------------------------------------
// Script safety
// ---------------------------------------------------------------------------

test('set_task_repetition script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', SET_TASK_REPETITION_SCRIPT));
});

test('set_task_repetition script survives the runOmniJs escaping round-trip', () => {
  assert.ok(!SET_TASK_REPETITION_SCRIPT.includes('`'), 'script contains a backtick');
  assert.ok(!SET_TASK_REPETITION_SCRIPT.includes('$'), 'script contains a dollar sign');
  assert.ok(!SET_TASK_REPETITION_SCRIPT.includes('\\'), 'script contains a backslash');
});

test('set_task_repetition script reads user data only from the args object', () => {
  assert.match(SET_TASK_REPETITION_SCRIPT, /\bargs\.task_id\b/);
  assert.match(SET_TASK_REPETITION_SCRIPT, /\bargs\.rule_string\b/);
});

test('set_task_repetition script uses the shared lookup helper, not an ad-hoc scan', () => {
  assert.match(SET_TASK_REPETITION_SCRIPT, /__findById\(flattenedTasks, args\.task_id, 'Task'\)/);
});

test('set_task_repetition script verifies the write and rolls back in the same evaluation', () => {
  assert.match(SET_TASK_REPETITION_SCRIPT, /__rulesEquivalent\(/, 'missing read-back comparison');
  assert.match(SET_TASK_REPETITION_SCRIPT, /rolledBack/, 'missing rollback reporting');
  assert.match(SET_TASK_REPETITION_SCRIPT, /verified/, 'missing verified flag');
});

test('the in-script RRULE comparison agrees with the canonical Node implementation', () => {
  // The script carries its own copy of rulesEquivalent so rollback can happen
  // inside the single OmniJS evaluation. If the copies ever disagree, a write
  // would be rolled back (or accepted) for the wrong reason.
  const scriptEquiv = inScriptRulesEquivalent();

  const pairs: Array<[string, string]> = [
    ['FREQ=DAILY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=1'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', 'BYDAY=MO;INTERVAL=2;FREQ=WEEKLY'],
    ['FREQ=WEEKLY;BYDAY=SU,TU', 'FREQ=WEEKLY;BYDAY=TU,SU'],
    ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=1'],
    ['RRULE:FREQ=DAILY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=1'],
    ['freq=daily;interval=1', 'FREQ=DAILY;INTERVAL=1'],
    ['FREQ=DAILY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=2'],
    ['FREQ=WEEKLY;BYDAY=MO', 'FREQ=WEEKLY'],
    ['FREQ=WEEKLY', 'FREQ=WEEKLY;COUNT=3'],
    ['FREQ=MONTHLY;BYDAY=2TU', 'FREQ=MONTHLY;BYDAY=-1TU'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,15', 'FREQ=MONTHLY;BYMONTHDAY=15,1'],
    ['  FREQ=DAILY ; INTERVAL=1 ; ', 'FREQ=DAILY;INTERVAL=1'],
    // Whitespace AROUND the '=' and inside a list value: the in-script parser
    // trimmed only whole segments, so it produced the key 'FREQ ' and the list
    // value 'MO, TU' where Node produced 'FREQ' and 'MO,TU' — the two
    // implementations then disagreed about whether the write round-tripped.
    ['FREQ = DAILY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=1'],
    ['FREQ=WEEKLY;BYDAY=MO, TU', 'FREQ=WEEKLY;BYDAY=TU,MO'],
    ['FREQ=WEEKLY ; BYDAY = MO , TU ; INTERVAL = 2', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,MO'],
    ['FREQ = DAILY', 'FREQ=WEEKLY']
  ];

  for (const [a, b] of pairs) {
    assert.equal(
      scriptEquiv(a, b),
      rulesEquivalentNode(a, b),
      `in-script and Node comparison disagree for "${a}" vs "${b}"`
    );
  }
});

test('both RRULE comparators treat whitespace around = and inside lists as insignificant', () => {
  // Pinning the two against each other only proves they AGREE; this pins what
  // they agree on, so "both wrong in the same way" still fails.
  const scriptEquiv = inScriptRulesEquivalent();
  for (const [a, b] of [
    ['FREQ = DAILY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=1'],
    ['FREQ=WEEKLY;BYDAY=MO, TU', 'FREQ=WEEKLY;BYDAY=TU,MO']
  ] as Array<[string, string]>) {
    assert.equal(scriptEquiv(a, b), true, `in-script comparator failed on "${a}"`);
    assert.equal(rulesEquivalentNode(a, b), true, `Node comparator failed on "${a}"`);
  }
});
