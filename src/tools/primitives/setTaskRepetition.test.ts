import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { schema } from '../definitions/setTaskRepetition.js';

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
  const described = JSON.stringify(schema.shape.schedule_type.description);
  assert.match(described, /Due Again/, 'from_completion should be documented as OmniFocus "Due Again"');
  assert.match(described, /Defer Another/, 'defer_from_completion should be documented as OmniFocus "Defer Another"');
});
