import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { rulesEquivalent } from '../../utils/rrule.js';

export type RepetitionScheduleType = 'regularly' | 'from_completion' | 'defer_from_completion' | 'none';

export interface SetTaskRepetitionParams {
  task_id: string;
  rule_string?: string;
  schedule_type: RepetitionScheduleType;
}

export interface SetTaskRepetitionResult {
  success: boolean;
  id?: string;
  name?: string;
  /** The rule string OmniFocus actually stored (read back after the write). */
  repetitionRule?: string | null;
  /** Requested rule string, for comparison when verification fails. */
  requestedRule?: string | null;
  scheduleType?: string;
  /** Read back from the rule object: 'Fixed' | 'DueDate' | 'DeferUntilDate'. */
  method?: string | null;
  /** Derived by OmniFocus from `method`: 'Regularly' | 'FromCompletion'. */
  repetitionScheduleType?: string | null;
  /** Derived by OmniFocus from `method`: 'DueDate' | 'DeferDate'. Read-only. */
  anchorDateKey?: string | null;
  /** Always false on a freshly built rule; read-only in OmniJS. */
  catchUpAutomatically?: boolean | null;
  /** The rule the task carried before this call, so a change can be undone. */
  previousRule?: string | null;
  /** True when the post-write read-back matched the request. */
  verified?: boolean;
  /** Set when a failed verification was rolled back to the previous rule. */
  rolledBack?: boolean;
  error?: string;
}

/**
 * Order-independent RRULE comparison, in OmniJS.
 *
 * This mirrors `rulesEquivalent` in src/utils/rrule.ts. It is duplicated here
 * (rather than compared in Node) because the single-script rule requires the
 * rollback decision to happen inside the same OmniJS evaluation as the write —
 * background sync can mutate the database between two script invocations. Node
 * re-runs the canonical comparison on the returned values as a cross-check.
 *
 * Written in ES5 style with no template literals, `$`, or backslashes so it
 * survives the runOmniJs escaping layer untouched.
 */
const OMNIJS_RRULE_COMPARE = `
  var __RRULE_LIST_KEYS = ['BYDAY','BYMONTHDAY','BYMONTH','BYYEARDAY','BYWEEKNO','BYHOUR','BYMINUTE','BYSECOND','BYSETPOS'];

  function __parseRule(input) {
    var out = {};
    if (typeof input !== 'string') { return out; }
    var body = String(input);
    while (body.length && body.charAt(0) === ' ') { body = body.slice(1); }
    while (body.length && body.charAt(body.length - 1) === ' ') { body = body.slice(0, -1); }
    if (body.toUpperCase().indexOf('RRULE:') === 0) { body = body.slice(6); }
    var segments = body.split(';');
    for (var i = 0; i < segments.length; i++) {
      var part = segments[i];
      while (part.length && part.charAt(0) === ' ') { part = part.slice(1); }
      while (part.length && part.charAt(part.length - 1) === ' ') { part = part.slice(0, -1); }
      if (part === '') { continue; }
      var eq = part.indexOf('=');
      if (eq <= 0) { out[part.toUpperCase()] = ''; continue; }
      // Trim around the '=' exactly like the Node parseRuleString: without it
      // 'FREQ = DAILY' produces the key 'FREQ ' and the two implementations
      // disagree about whether a rule round-tripped.
      out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
    }
    return out;
  }

  function __comparableValue(key, value) {
    var upper = String(value).toUpperCase();
    if (__RRULE_LIST_KEYS.indexOf(key) === -1) { return upper; }
    return upper.split(',').map(function (v) { return v.trim(); }).filter(function (v) { return v !== ''; }).sort().join(',');
  }

  function __rulesEquivalent(a, b) {
    var left = __parseRule(a);
    var right = __parseRule(b);
    if (left.INTERVAL === undefined) { left.INTERVAL = '1'; }
    if (right.INTERVAL === undefined) { right.INTERVAL = '1'; }
    var keys = {};
    var k;
    for (k in left) { if (Object.prototype.hasOwnProperty.call(left, k)) { keys[k] = true; } }
    for (k in right) { if (Object.prototype.hasOwnProperty.call(right, k)) { keys[k] = true; } }
    for (k in keys) {
      if (!Object.prototype.hasOwnProperty.call(keys, k)) { continue; }
      if (left[k] === undefined || right[k] === undefined) { return false; }
      if (__comparableValue(k, left[k]) !== __comparableValue(k, right[k])) { return false; }
    }
    return true;
  }
`;

/**
 * Set or clear a task's repetition rule.
 *
 * Probed live against OmniFocus 4.8.13:
 *
 *  - `Task.RepetitionRule` takes EXACTLY `(ruleString: String, method)`. It
 *    declares a third parameter typed `Task.RepetitionScheduleType`, but
 *    passing any value for it — including a valid ScheduleType member — throws
 *    a bare `Error`. There is no options-object form, and
 *    `Task.RepetitionRule.constructInstance()` takes no arguments (it returns a
 *    default FREQ=DAILY;INTERVAL=1 Fixed rule).
 *  - `ruleString`, `method`, `scheduleType`, `anchorDateKey` and
 *    `catchUpAutomatically` are ALL read-only on the rule object ("The property
 *    X is read-only."), both before and after assignment to a task. Reading
 *    `task.repetitionRule` returns a fresh object each time, so in-place
 *    mutation could not persist even if it were permitted.
 *  - `scheduleType` and `anchorDateKey` are therefore DERIVED from `method`:
 *      Fixed          -> Regularly      / anchor DueDate
 *      DueDate        -> FromCompletion / anchor DueDate
 *      DeferUntilDate -> FromCompletion / anchor DeferDate
 *    `Task.AnchorDateKey.PlannedDate` exists as an enum member but is
 *    unreachable through this API, and `catchUpAutomatically` is always false
 *    on a rule built here.
 *  - `new Task.RepetitionRule(rule, undefined)` silently builds a *Fixed* rule,
 *    which is why an undefined method is rejected explicitly below.
 *  - OmniFocus stores `ruleString` verbatim (an `RRULE:` prefix is preserved
 *    as-is) and validates FREQ at construction — an unknown FREQ throws
 *    `Unknown value "..." for FREQ`.
 */
export const SET_TASK_REPETITION_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${OMNIJS_RRULE_COMPARE}

  // "[object Task.RepetitionMethod: Fixed]" -> "Fixed"
  function __enumLabel(v) {
    if (v === undefined || v === null) { return null; }
    var s = String(v);
    var i = s.indexOf(': ');
    if (i >= 0 && s.charAt(s.length - 1) === ']') { return s.slice(i + 2, -1); }
    return s;
  }

  function __methodFromLabel(label) {
    if (label === 'Fixed') { return Task.RepetitionMethod.Fixed; }
    if (label === 'DueDate') { return Task.RepetitionMethod.DueDate; }
    if (label === 'DeferUntilDate') { return Task.RepetitionMethod.DeferUntilDate; }
    return null;
  }

  function __describe(t) {
    var r = t.repetitionRule;
    if (!r) { return null; }
    return {
      ruleString: r.ruleString,
      method: __enumLabel(r.method),
      repetitionScheduleType: __enumLabel(r.scheduleType),
      anchorDateKey: __enumLabel(r.anchorDateKey),
      catchUpAutomatically: r.catchUpAutomatically
    };
  }

  var task = __findById(flattenedTasks, args.task_id, 'Task');
  if (!task) {
    return JSON.stringify({ success: false, error: 'Task not found with ID: ' + args.task_id });
  }

  var before = __describe(task);

  if (args.schedule_type === 'none') {
    task.repetitionRule = null;
    var clearedOk = !task.repetitionRule;
    return JSON.stringify({
      success: clearedOk,
      error: clearedOk ? undefined : 'Repetition rule was still present after clearing it.',
      id: task.id.primaryKey,
      name: task.name,
      repetitionRule: null,
      scheduleType: 'none',
      previousRule: before ? before.ruleString : null,
      verified: clearedOk
    });
  }

  if (!args.rule_string) {
    return JSON.stringify({ success: false, error: 'rule_string is required when schedule_type is not none' });
  }

  // 'from_completion' -> DueDate ("Due Again"), 'defer_from_completion' ->
  // DeferUntilDate ("Defer Another"), anything else -> Fixed.
  var method;
  if (args.schedule_type === 'from_completion') {
    method = Task.RepetitionMethod.DueDate;
  } else if (args.schedule_type === 'defer_from_completion') {
    method = Task.RepetitionMethod.DeferUntilDate;
  } else {
    method = Task.RepetitionMethod.Fixed;
  }

  // A missing method would silently construct a Fixed rule — fail loudly instead.
  if (!method) {
    return JSON.stringify({ success: false, error: 'Unsupported schedule_type for this OmniFocus version: ' + args.schedule_type });
  }

  var rule;
  try {
    rule = new Task.RepetitionRule(args.rule_string, method);
  } catch (e) {
    return JSON.stringify({
      success: false,
      error: 'OmniFocus rejected the repetition rule "' + args.rule_string + '": ' + (e.message || String(e))
    });
  }

  task.repetitionRule = rule;
  var actual = __describe(task);

  // Verification and rollback both live inside this single evaluation: a second
  // script invocation could see a database mutated by background sync.
  var expectedMethod = __enumLabel(method);
  var landed = actual !== null &&
    __rulesEquivalent(args.rule_string, actual.ruleString) &&
    actual.method === expectedMethod;

  if (!landed) {
    var rolledBack = false;
    var rollbackError = null;
    try {
      if (!before) {
        task.repetitionRule = null;
        rolledBack = true;
      } else {
        var prevMethod = __methodFromLabel(before.method);
        if (prevMethod) {
          task.repetitionRule = new Task.RepetitionRule(before.ruleString, prevMethod);
          rolledBack = true;
        } else {
          rollbackError = 'unrecognized previous repetition method ' + before.method;
        }
      }
    } catch (e2) {
      rollbackError = e2.message || String(e2);
    }

    return JSON.stringify({
      success: false,
      verified: false,
      rolledBack: rolledBack,
      id: task.id.primaryKey,
      name: task.name,
      requestedRule: args.rule_string,
      repetitionRule: actual ? actual.ruleString : null,
      method: actual ? actual.method : null,
      error: 'Repetition rule verification failed: requested "' + args.rule_string +
             '" with method ' + expectedMethod +
             ' but OmniFocus stored "' + (actual ? actual.ruleString : '(nothing)') +
             '" with method ' + (actual ? actual.method : '(none)') + '. ' +
             (rolledBack
               ? 'The task was rolled back to its previous repetition (' + (before ? before.ruleString : 'none') + ').'
               : 'Rollback ALSO failed (' + (rollbackError || 'unknown error') + ') — inspect the task in OmniFocus.')
    });
  }

  return JSON.stringify({
    success: true,
    verified: true,
    id: task.id.primaryKey,
    name: task.name,
    repetitionRule: actual.ruleString,
    requestedRule: args.rule_string,
    scheduleType: args.schedule_type,
    method: actual.method,
    repetitionScheduleType: actual.repetitionScheduleType,
    anchorDateKey: actual.anchorDateKey,
    catchUpAutomatically: actual.catchUpAutomatically,
    previousRule: before ? before.ruleString : null
  });
`;

export async function setTaskRepetition(params: SetTaskRepetitionParams): Promise<SetTaskRepetitionResult> {
  const result = await runOmniJs(SET_TASK_REPETITION_SCRIPT, params);

  // Cross-check the in-script verdict against the canonical Node-side
  // comparison. They implement the same algorithm; a disagreement means the
  // script's copy drifted, and the write is reported as unverified rather than
  // trusted.
  if (result?.success && params.schedule_type !== 'none') {
    const requested = params.rule_string ?? '';
    const stored = typeof result.repetitionRule === 'string' ? result.repetitionRule : '';
    if (!rulesEquivalent(requested, stored)) {
      return {
        ...result,
        success: false,
        verified: false,
        error:
          `Repetition rule verification failed in Node: requested "${requested}" but OmniFocus stored "${stored}". ` +
          `The write was NOT rolled back (OmniFocus reported it as matching) — inspect the task in OmniFocus.`
      };
    }
  }

  return result;
}
