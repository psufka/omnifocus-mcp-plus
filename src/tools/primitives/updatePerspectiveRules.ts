import { runOmniJs } from '../../utils/scriptExecution.js';

/**
 * The complete perspective filter-rule key vocabulary.
 *
 * Source of truth: the contiguous coding-key string table inside
 * `OmniFocus.app/Contents/Frameworks/OmniFocusModel.framework` (OmniFocus
 * 4.8.13) — the same table that also holds `disabledRule`, `aggregateType` and
 * `aggregateRules` — cross-checked against a live read of
 * `Perspective.Custom.all[].archivedFilterRules`.
 *
 * This list matters because OmniFocus performs NO validation on assignment: an
 * unrecognized key is dropped silently, and a rule object left with no
 * recognized keys degrades to "matches everything", turning a narrow
 * perspective into a firehose with no error anywhere.
 *
 * `actionHasPlannedDate` is present in the binary but absent from Omni's
 * published documentation — it is real and accepted here.
 */
export const KNOWN_RULE_KEYS: readonly string[] = [
  // Availability / status
  'actionAvailability',
  'actionStatus',
  // Duration
  'actionHasDuration',
  'actionWithinDuration',
  // Tags
  'actionIsUntagged',
  'actionHasTagWithStatus',
  'actionHasAnyOfTags',
  'actionHasAllOfTags',
  // Project / container
  'actionHasNoProject',
  'actionHasProjectWithStatus',
  'actionIsInSingleActionsList',
  'actionWithinFocus',
  // Search
  'actionMatchingSearch',
  // Item shape
  'actionIsLeaf',
  'actionIsProject',
  'actionIsGroup',
  'actionIsProjectOrGroup',
  'actionRepeats',
  // Presence of a specific date
  'actionHasDueDate',
  'actionHasDeferDate',
  'actionHasPlannedDate',
  // "has any date" family
  'actionHasDateYesterday',
  'actionHasDateToday',
  'actionHasDateTomorrow',
  'actionHasDateOnDateSpec',
  'actionHasDateInTheNext',
  'actionHasDateInThePast',
  'actionHasDateBetweenDateSpecs',
  // Date-field-scoped family (pair with actionDateField)
  'actionDateField',
  'actionDateIsYesterday',
  'actionDateIsToday',
  'actionDateIsTomorrow',
  'actionDateIsOnDateSpec',
  'actionDateIsBeforeDateSpec',
  'actionDateIsAfterDateSpec',
  'actionDateIsInTheNext',
  'actionDateIsInThePast'
];

/** Structural keys that nest or disable other rules rather than filtering. */
export const STRUCTURAL_RULE_KEYS: readonly string[] = ['aggregateRules', 'aggregateType', 'disabledRule'];

const KNOWN = new Set<string>([...KNOWN_RULE_KEYS, ...STRUCTURAL_RULE_KEYS]);
const AGGREGATE_TYPES = new Set(['all', 'any', 'none']);
const MAX_RULE_DEPTH = 10;

export interface ValidateRulesOptions {
  allowUnknownKeys?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a perspective rule array BEFORE it is written.
 *
 * Returns every problem found rather than the first, so a malformed rule set is
 * fixed in one round trip. An empty array means the rules are safe to write.
 */
export function validatePerspectiveRules(
  rules: unknown,
  options: ValidateRulesOptions = {}
): string[] {
  const { allowUnknownKeys = false } = options;
  const errors: string[] = [];

  if (!Array.isArray(rules)) {
    return ['rules must be an array of rule objects.'];
  }
  if (rules.length === 0) {
    return ['rules must contain at least one rule — an empty rule array makes the perspective match everything.'];
  }

  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_RULE_DEPTH) {
      errors.push(`${path}: rules are nested more than ${MAX_RULE_DEPTH} levels deep.`);
      return;
    }
    if (!isPlainObject(node)) {
      errors.push(`${path}: each rule must be a JSON object, got ${Array.isArray(node) ? 'an array' : typeof node}.`);
      return;
    }

    const keys = Object.keys(node);
    if (keys.length === 0) {
      errors.push(`${path}: empty rule object — OmniFocus would treat it as "match everything".`);
      return;
    }

    if (!allowUnknownKeys) {
      const unknown = keys.filter(k => !KNOWN.has(k));
      if (unknown.length > 0) {
        errors.push(
          `${path}: unknown rule key(s) ${unknown.map(k => `"${k}"`).join(', ')}. ` +
          `OmniFocus ignores unrecognized keys silently, which can turn this rule into "match everything". ` +
          `Known keys: ${[...KNOWN_RULE_KEYS, ...STRUCTURAL_RULE_KEYS].join(', ')}. ` +
          `Pass allowUnknownKeys: true to write it anyway.`
        );
      }
    }

    // `changed` is documented by Omni as an actionDateField value but the
    // filter engine ignores it — the resulting rule matches nothing useful and
    // reports no error, so it is rejected regardless of allowUnknownKeys.
    if (typeof node.actionDateField === 'string' && node.actionDateField.toLowerCase() === 'changed') {
      errors.push(
        `${path}.actionDateField: "changed" is documented but ignored by the OmniFocus filter engine — ` +
        `the rule will not filter as written. Use 'due', 'defer', 'completed', 'dropped', or 'added'.`
      );
    }

    const hasAggregate = Object.prototype.hasOwnProperty.call(node, 'aggregateRules');
    const hasDisabled = Object.prototype.hasOwnProperty.call(node, 'disabledRule');

    if (hasAggregate) {
      const nested = node.aggregateRules;
      if (!Array.isArray(nested) || nested.length === 0) {
        errors.push(`${path}.aggregateRules must be a non-empty array of rule objects.`);
      } else {
        nested.forEach((child, i) => walk(child, `${path}.aggregateRules[${i}]`, depth + 1));
      }
      const aggType = node.aggregateType;
      if (aggType !== undefined && (typeof aggType !== 'string' || !AGGREGATE_TYPES.has(aggType))) {
        errors.push(`${path}.aggregateType must be 'all', 'any', or 'none'; got ${JSON.stringify(aggType)}.`);
      }
    } else if (Object.prototype.hasOwnProperty.call(node, 'aggregateType')) {
      errors.push(`${path}.aggregateType has no effect without aggregateRules.`);
    }

    if (hasDisabled) {
      walk(node.disabledRule, `${path}.disabledRule`, depth + 1);
    }

    if (!hasAggregate && !hasDisabled) {
      // A leaf rule must actually filter on something recognized.
      const recognized = keys.filter(k => KNOWN_RULE_KEYS.includes(k));
      if (recognized.length === 0 && !allowUnknownKeys) {
        errors.push(
          `${path}: no recognized filter key. A rule object with only unrecognized keys makes the ` +
          `perspective match every item. Expected at least one of: ${KNOWN_RULE_KEYS.join(', ')}.`
        );
      }
    }
  };

  rules.forEach((rule, i) => walk(rule, `rules[${i}]`, 1));
  return errors;
}

export interface UpdatePerspectiveRulesParams {
  perspectiveName?: string;
  perspectiveId?: string;
  rules: unknown[];
  /** Explicit flag so `aggregation: null` (clear it) is distinguishable from "leave it alone". */
  setAggregation: boolean;
  aggregation?: 'all' | 'any' | null;
}

export interface UpdatePerspectiveRulesResult {
  success: boolean;
  verified?: boolean;
  name?: string;
  identifier?: string;
  before?: unknown[];
  after?: unknown[];
  beforeAggregation?: string | null;
  afterAggregation?: string | null;
  restored?: boolean;
  error?: string;
}

/**
 * Replace a custom perspective's filter rules, verifying the write and rolling
 * back inside the same OmniJS evaluation if it did not land exactly.
 *
 * Probed live against OmniFocus 4.8.13:
 *  - `archivedFilterRules` and `archivedTopLevelFilterAggregation` both carry a
 *    real setter (`hasSet: true` on the property descriptor; the framework
 *    exports `OFMPerspective.set_archivedFilterRules` /
 *    `setArchivedFilterRules:`).
 *  - `Perspective.Custom.byName` and `.byIdentifier` return `null` on a miss.
 *  - Every read of `archivedFilterRules` returns a fresh array, so the snapshot
 *    taken before the write is a genuine copy and is safe to restore.
 *
 * Verification compares canonical JSON (object keys sorted recursively) because
 * a round trip through OmniFocus does not promise to preserve key order.
 *
 * Written with no template literals, `$`, or backslashes so it survives the
 * runOmniJs escaping layer untouched.
 */
export const UPDATE_PERSPECTIVE_RULES_SCRIPT = `
  // Canonical JSON: object keys sorted recursively, array order preserved
  // (rule order is meaningful, key order is not).
  function __canon(v) {
    if (v === null || typeof v !== 'object') { return JSON.stringify(v); }
    if (Array.isArray(v)) {
      return '[' + v.map(__canon).join(',') + ']';
    }
    var keys = Object.keys(v).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      parts.push(JSON.stringify(keys[i]) + ':' + __canon(v[keys[i]]));
    }
    return '{' + parts.join(',') + '}';
  }

  var all = Perspective.Custom.all;
  var target = null;

  if (args.perspectiveId) {
    target = Perspective.Custom.byIdentifier(args.perspectiveId);
    if (!target) {
      return JSON.stringify({ success: false, error: 'Custom perspective not found with ID: ' + args.perspectiveId });
    }
  } else {
    var matches = all.filter(function (p) { return p.name === args.perspectiveName; });
    if (matches.length === 0) {
      var names = all.map(function (p) { return '"' + p.name + '"'; }).join(', ');
      return JSON.stringify({
        success: false,
        error: 'Custom perspective not found with name: "' + args.perspectiveName + '". Available: ' + (names || '(none)')
      });
    }
    if (matches.length > 1) {
      var listed = matches.map(function (p) { return '"' + p.name + '" (id: ' + p.identifier + ')'; }).join(', ');
      return JSON.stringify({
        success: false,
        error: 'Ambiguous perspective name "' + args.perspectiveName + '": ' + matches.length + ' matches — ' + listed + '. Use perspectiveId instead.'
      });
    }
    target = matches[0];
  }

  var beforeRules = target.archivedFilterRules;
  var beforeAgg = target.archivedTopLevelFilterAggregation;
  if (beforeAgg === undefined) { beforeAgg = null; }
  var beforeCanon = __canon(beforeRules);

  try {
    target.archivedFilterRules = args.rules;
    if (args.setAggregation) {
      target.archivedTopLevelFilterAggregation = args.aggregation;
    }
  } catch (e) {
    return JSON.stringify({
      success: false,
      name: target.name,
      identifier: target.identifier,
      before: beforeRules,
      beforeAggregation: beforeAgg,
      error: 'OmniFocus rejected the rule assignment: ' + (e.message || String(e))
    });
  }

  var afterRules = target.archivedFilterRules;
  var afterAgg = target.archivedTopLevelFilterAggregation;
  if (afterAgg === undefined) { afterAgg = null; }

  var rulesMatch = __canon(afterRules) === __canon(args.rules);
  var aggMatch = !args.setAggregation || afterAgg === args.aggregation;

  if (rulesMatch && aggMatch) {
    return JSON.stringify({
      success: true,
      verified: true,
      name: target.name,
      identifier: target.identifier,
      before: beforeRules,
      after: afterRules,
      beforeAggregation: beforeAgg,
      afterAggregation: afterAgg
    });
  }

  // The write did not land as written, so we no longer know what the
  // perspective filters on. Restore the snapshot inside this same evaluation.
  var restored = false;
  var restoreError = null;
  try {
    target.archivedFilterRules = beforeRules;
    if (args.setAggregation) {
      target.archivedTopLevelFilterAggregation = beforeAgg;
    }
    restored = __canon(target.archivedFilterRules) === beforeCanon;
    if (!restored) { restoreError = 'restored rules still do not match the snapshot'; }
  } catch (e2) {
    restoreError = e2.message || String(e2);
  }

  return JSON.stringify({
    success: false,
    verified: false,
    restored: restored,
    name: target.name,
    identifier: target.identifier,
    before: beforeRules,
    after: afterRules,
    beforeAggregation: beforeAgg,
    afterAggregation: afterAgg,
    error: 'Perspective rule write could not be verified' +
           (rulesMatch ? '' : ' (rules read back differently than they were written)') +
           (aggMatch ? '' : ' (aggregation read back as ' + String(afterAgg) + ' instead of ' + String(args.aggregation) + ')') +
           '. ' +
           (restored
             ? 'The perspective was restored to its previous rules.'
             : 'RESTORE ALSO FAILED (' + (restoreError || 'unknown error') + ') — the perspective may be in an unexpected state; its previous rules are in the "before" field.')
  });
`;

export async function updatePerspectiveRules(
  params: UpdatePerspectiveRulesParams
): Promise<UpdatePerspectiveRulesResult> {
  if (!params.perspectiveName && !params.perspectiveId) {
    return { success: false, error: 'Either perspectiveName or perspectiveId must be provided.' };
  }

  return await runOmniJs(UPDATE_PERSPECTIVE_RULES_SCRIPT, {
    perspectiveName: params.perspectiveName ?? null,
    perspectiveId: params.perspectiveId ?? null,
    rules: params.rules,
    setAggregation: params.setAggregation === true,
    aggregation: params.aggregation ?? null
  });
}
