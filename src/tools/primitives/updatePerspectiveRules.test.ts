import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validatePerspectiveRules,
  KNOWN_RULE_KEYS,
  STRUCTURAL_RULE_KEYS,
  UPDATE_PERSPECTIVE_RULES_SCRIPT,
  updatePerspectiveRules
} from './updatePerspectiveRules.js';
import { schema, baseSchema } from '../definitions/updatePerspectiveRules.js';

// ---------------------------------------------------------------------------
// Known-key vocabulary
// ---------------------------------------------------------------------------

test('the rule vocabulary contains the keys observed in a live database', () => {
  // Captured read-only from Perspective.Custom.all on OmniFocus 4.8.13:
  //   Completed -> [{actionAvailability:'completed'}]
  //   Changed   -> [{disabledRule:{actionAvailability:'remaining'}}]
  //   Hotlist   -> [{actionAvailability:'remaining'},
  //                 {aggregateRules:[{actionStatus:'flagged'},{actionStatus:'due'}],
  //                  aggregateType:'any'}]
  for (const key of ['actionAvailability', 'actionStatus']) {
    assert.ok(KNOWN_RULE_KEYS.includes(key), `${key} missing from the rule vocabulary`);
  }
  for (const key of ['aggregateRules', 'aggregateType', 'disabledRule']) {
    assert.ok(STRUCTURAL_RULE_KEYS.includes(key), `${key} missing from the structural keys`);
  }
});

test('the rule vocabulary includes the undocumented actionHasPlannedDate', () => {
  // Present in OmniFocusModel.framework's rule coding-key table but absent from
  // Omni's published documentation. Rejecting it would block planned-date
  // perspectives for no reason.
  assert.ok(KNOWN_RULE_KEYS.includes('actionHasPlannedDate'));
});

test('the rule vocabulary has no duplicates and no overlap with the structural keys', () => {
  assert.equal(new Set(KNOWN_RULE_KEYS).size, KNOWN_RULE_KEYS.length);
  for (const key of STRUCTURAL_RULE_KEYS) {
    assert.ok(!KNOWN_RULE_KEYS.includes(key), `${key} is listed as both a filter key and a structural key`);
  }
});

// ---------------------------------------------------------------------------
// validatePerspectiveRules — acceptance
// ---------------------------------------------------------------------------

test('validatePerspectiveRules accepts the rules of a real perspective', () => {
  const hotlist = [
    { actionAvailability: 'remaining' },
    { aggregateRules: [{ actionStatus: 'flagged' }, { actionStatus: 'due' }], aggregateType: 'any' }
  ];
  assert.deepEqual(validatePerspectiveRules(hotlist), []);
});

test('validatePerspectiveRules accepts a disabledRule wrapper', () => {
  assert.deepEqual(validatePerspectiveRules([{ disabledRule: { actionAvailability: 'remaining' } }]), []);
});

test('validatePerspectiveRules accepts nested aggregates', () => {
  const rules = [
    {
      aggregateRules: [
        { actionStatus: 'flagged' },
        { aggregateRules: [{ actionHasDueDate: true }, { actionHasDeferDate: true }], aggregateType: 'all' }
      ],
      aggregateType: 'any'
    }
  ];
  assert.deepEqual(validatePerspectiveRules(rules), []);
});

test('validatePerspectiveRules accepts every key in the vocabulary', () => {
  for (const key of KNOWN_RULE_KEYS) {
    assert.deepEqual(validatePerspectiveRules([{ [key]: 'x' }]), [], `${key} should be accepted`);
  }
});

test('validatePerspectiveRules accepts aggregateType all/any/none', () => {
  for (const aggregateType of ['all', 'any', 'none']) {
    assert.deepEqual(
      validatePerspectiveRules([{ aggregateRules: [{ actionStatus: 'due' }], aggregateType }]),
      []
    );
  }
});

test('validatePerspectiveRules accepts aggregateRules without an explicit aggregateType', () => {
  assert.deepEqual(validatePerspectiveRules([{ aggregateRules: [{ actionStatus: 'due' }] }]), []);
});

// ---------------------------------------------------------------------------
// validatePerspectiveRules — rejection (the whole point: OmniFocus validates nothing)
// ---------------------------------------------------------------------------

test('validatePerspectiveRules rejects a non-array', () => {
  assert.match(validatePerspectiveRules({ actionStatus: 'due' } as any)[0], /must be an array/);
  assert.match(validatePerspectiveRules('rules' as any)[0], /must be an array/);
});

test('validatePerspectiveRules rejects an empty rule array', () => {
  // An empty array is exactly the "matches everything" failure mode.
  assert.match(validatePerspectiveRules([])[0], /at least one rule/);
});

test('validatePerspectiveRules rejects an empty rule object', () => {
  assert.match(validatePerspectiveRules([{}])[0], /empty rule object/);
});

test('validatePerspectiveRules rejects a non-object rule', () => {
  assert.match(validatePerspectiveRules(['actionStatus'] as any)[0], /must be a JSON object/);
  assert.match(validatePerspectiveRules([null] as any)[0], /must be a JSON object/);
  assert.match(validatePerspectiveRules([[{ actionStatus: 'due' }]] as any)[0], /must be a JSON object/);
});

test('validatePerspectiveRules names an unknown key and points at allowUnknownKeys', () => {
  const errors = validatePerspectiveRules([{ actionStatus: 'due', actionFlagged: true }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"actionFlagged"/);
  assert.match(errors[0], /allowUnknownKeys/);
  assert.match(errors[0], /rules\[0\]/);
});

test('validatePerspectiveRules reports the path of a nested unknown key', () => {
  const errors = validatePerspectiveRules([
    { aggregateRules: [{ actionStatus: 'due' }, { bogusKey: 1 }], aggregateType: 'any' }
  ]);
  assert.ok(errors.some(e => /rules\[0\]\.aggregateRules\[1\]/.test(e)), JSON.stringify(errors));
});

test('validatePerspectiveRules reports the path inside a disabledRule', () => {
  const errors = validatePerspectiveRules([{ disabledRule: { bogusKey: 1 } }]);
  assert.ok(errors.some(e => /rules\[0\]\.disabledRule/.test(e)), JSON.stringify(errors));
});

test('validatePerspectiveRules rejects a leaf rule with no recognized filter key', () => {
  const errors = validatePerspectiveRules([{ nonsense: true }]);
  assert.ok(errors.some(e => /no recognized filter key/.test(e)), JSON.stringify(errors));
});

test('allowUnknownKeys permits unknown keys but the rest of the shape is still checked', () => {
  assert.deepEqual(validatePerspectiveRules([{ futureKey: 1 }], { allowUnknownKeys: true }), []);
  assert.match(validatePerspectiveRules([{}], { allowUnknownKeys: true })[0], /empty rule object/);
  assert.match(validatePerspectiveRules([], { allowUnknownKeys: true })[0], /at least one rule/);
});

test('validatePerspectiveRules rejects the ignored `changed` date field even with allowUnknownKeys', () => {
  // Documented by Omni, but the filter engine ignores it — the rule silently
  // fails to filter, so it is rejected unconditionally.
  for (const options of [{}, { allowUnknownKeys: true }]) {
    const errors = validatePerspectiveRules([{ actionDateField: 'changed', actionDateIsToday: true }], options);
    assert.ok(errors.some(e => /ignored by the OmniFocus filter engine/.test(e)), JSON.stringify(errors));
  }
});

test('validatePerspectiveRules accepts the date fields that do work', () => {
  for (const field of ['due', 'defer', 'completed', 'dropped', 'added']) {
    assert.deepEqual(
      validatePerspectiveRules([{ actionDateField: field, actionDateIsToday: true }]),
      [],
      `${field} should be accepted`
    );
  }
});

test('validatePerspectiveRules rejects an empty or malformed aggregateRules', () => {
  assert.ok(validatePerspectiveRules([{ aggregateRules: [] }]).some(e => /non-empty array/.test(e)));
  assert.ok(validatePerspectiveRules([{ aggregateRules: 'x' }] as any).some(e => /non-empty array/.test(e)));
});

test('validatePerspectiveRules rejects an invalid aggregateType', () => {
  const errors = validatePerspectiveRules([{ aggregateRules: [{ actionStatus: 'due' }], aggregateType: 'either' }]);
  assert.ok(errors.some(e => /aggregateType must be/.test(e)), JSON.stringify(errors));
});

test('validatePerspectiveRules rejects aggregateType without aggregateRules', () => {
  const errors = validatePerspectiveRules([{ actionStatus: 'due', aggregateType: 'any' }]);
  assert.ok(errors.some(e => /no effect without aggregateRules/.test(e)), JSON.stringify(errors));
});

test('validatePerspectiveRules guards against runaway nesting', () => {
  let node: any = { actionStatus: 'due' };
  for (let i = 0; i < 15; i++) {
    node = { aggregateRules: [node], aggregateType: 'all' };
  }
  const errors = validatePerspectiveRules([node]);
  assert.ok(errors.some(e => /nested more than/.test(e)), JSON.stringify(errors));
});

test('validatePerspectiveRules reports every problem, not just the first', () => {
  const errors = validatePerspectiveRules([{ bogusA: 1 }, { bogusB: 2 }]);
  assert.ok(errors.length >= 2, JSON.stringify(errors));
  assert.ok(errors.some(e => /bogusA/.test(e)));
  assert.ok(errors.some(e => /bogusB/.test(e)));
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test('update_perspective_rules schema accepts a minimal valid call', () => {
  const r = schema.safeParse({
    perspectiveName: 'Hotlist',
    rules: [{ actionAvailability: 'remaining' }]
  });
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
});

test('update_perspective_rules schema accepts perspectiveId instead of a name', () => {
  const r = schema.safeParse({
    perspectiveId: 'dT6CjKsX8MY',
    rules: [{ actionStatus: 'flagged' }]
  });
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
});

test('update_perspective_rules schema requires a name or an id', () => {
  const r = schema.safeParse({ rules: [{ actionStatus: 'flagged' }] });
  assert.equal(r.success, false);
  assert.match(JSON.stringify((r as any).error.issues), /perspectiveName or perspectiveId/);
});

test('update_perspective_rules schema rejects an empty rules array', () => {
  const r = schema.safeParse({ perspectiveName: 'Hotlist', rules: [] });
  assert.equal(r.success, false);
});

test('update_perspective_rules schema rejects unknown rule keys before any write', () => {
  const r = schema.safeParse({
    perspectiveName: 'Hotlist',
    rules: [{ actionFlagged: true }]
  });
  assert.equal(r.success, false);
  assert.match(JSON.stringify((r as any).error.issues), /actionFlagged/);
});

test('update_perspective_rules schema honours allowUnknownKeys', () => {
  const r = schema.safeParse({
    perspectiveName: 'Hotlist',
    rules: [{ someFutureKey: true }],
    allowUnknownKeys: true
  });
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
});

test('update_perspective_rules schema rejects an unknown top-level field', () => {
  const r = schema.safeParse({
    perspectiveName: 'Hotlist',
    rules: [{ actionStatus: 'due' }],
    bogusUnknownField: true
  });
  assert.equal(r.success, false);
  assert.match(JSON.stringify((r as any).error.issues), /bogusUnknownField|unrecognized/i);
});

test('update_perspective_rules aggregation accepts all, any and an explicit null', () => {
  for (const aggregation of ['all', 'any', null]) {
    const r = schema.safeParse({
      perspectiveName: 'Hotlist',
      rules: [{ actionStatus: 'due' }],
      aggregation
    });
    assert.equal(r.success, true, `aggregation ${String(aggregation)} should be accepted`);
  }
});

test('update_perspective_rules distinguishes an omitted aggregation from an explicit null', () => {
  const omitted = schema.parse({ perspectiveName: 'H', rules: [{ actionStatus: 'due' }] });
  const explicit = schema.parse({ perspectiveName: 'H', rules: [{ actionStatus: 'due' }], aggregation: null });
  assert.equal((omitted as any).aggregation, undefined, 'omitted aggregation must stay undefined (leave alone)');
  assert.equal((explicit as any).aggregation, null, 'explicit null must survive (clear it)');
});

test('update_perspective_rules schema rejects an invalid aggregation value', () => {
  const r = schema.safeParse({
    perspectiveName: 'Hotlist',
    rules: [{ actionStatus: 'due' }],
    aggregation: 'either'
  });
  assert.equal(r.success, false);
});

test('update_perspective_rules base schema documents that rules replace rather than merge', () => {
  const described = String(baseSchema.shape.rules.description);
  assert.match(described, /COMPLETE replacement|overwrites/i);
});

// ---------------------------------------------------------------------------
// Primitive guard + script safety
// ---------------------------------------------------------------------------

test('updatePerspectiveRules refuses to run without a name or an id', async () => {
  const result = await updatePerspectiveRules({ rules: [{ actionStatus: 'due' }], setAggregation: false });
  assert.equal(result.success, false);
  assert.match(String(result.error), /perspectiveName or perspectiveId/);
});

test('update_perspective_rules script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', UPDATE_PERSPECTIVE_RULES_SCRIPT));
});

test('update_perspective_rules script survives the runOmniJs escaping round-trip', () => {
  assert.ok(!UPDATE_PERSPECTIVE_RULES_SCRIPT.includes('`'), 'script contains a backtick');
  assert.ok(!UPDATE_PERSPECTIVE_RULES_SCRIPT.includes('$'), 'script contains a dollar sign');
  assert.ok(!UPDATE_PERSPECTIVE_RULES_SCRIPT.includes('\\'), 'script contains a backslash');
});

test('update_perspective_rules script reads user data only from the args object', () => {
  for (const field of ['args.perspectiveId', 'args.perspectiveName', 'args.rules', 'args.setAggregation', 'args.aggregation']) {
    assert.ok(UPDATE_PERSPECTIVE_RULES_SCRIPT.includes(field), `script never reads ${field}`);
  }
});

test('update_perspective_rules script snapshots, verifies and restores in one evaluation', () => {
  assert.match(UPDATE_PERSPECTIVE_RULES_SCRIPT, /var beforeRules = target\.archivedFilterRules;/, 'missing snapshot');
  assert.match(UPDATE_PERSPECTIVE_RULES_SCRIPT, /target\.archivedFilterRules = args\.rules;/, 'missing write');
  assert.match(UPDATE_PERSPECTIVE_RULES_SCRIPT, /var afterRules = target\.archivedFilterRules;/, 'missing read-back');
  assert.match(UPDATE_PERSPECTIVE_RULES_SCRIPT, /target\.archivedFilterRules = beforeRules;/, 'missing restore');
  assert.match(UPDATE_PERSPECTIVE_RULES_SCRIPT, /verified/, 'missing verified flag');
});

test('update_perspective_rules script prefers byIdentifier and reports ambiguous names', () => {
  assert.match(UPDATE_PERSPECTIVE_RULES_SCRIPT, /Perspective\.Custom\.byIdentifier\(args\.perspectiveId\)/);
  assert.match(UPDATE_PERSPECTIVE_RULES_SCRIPT, /Ambiguous perspective name/);
  // byIdentifier returns null on a miss (probed live) — an unmatched id must
  // never fall through to a name lookup.
  assert.match(UPDATE_PERSPECTIVE_RULES_SCRIPT, /Custom perspective not found with ID/);
});

test("the script's canonical JSON comparison is key-order independent but array-order sensitive", () => {
  const canon = new Function(
    'v',
    `${UPDATE_PERSPECTIVE_RULES_SCRIPT.slice(
      UPDATE_PERSPECTIVE_RULES_SCRIPT.indexOf('function __canon'),
      UPDATE_PERSPECTIVE_RULES_SCRIPT.indexOf('var all = Perspective.Custom.all;')
    )}\nreturn __canon(v);`
  ) as (v: unknown) => string;

  assert.equal(
    canon({ actionStatus: 'due', actionAvailability: 'remaining' }),
    canon({ actionAvailability: 'remaining', actionStatus: 'due' }),
    'key order must not matter'
  );
  assert.notEqual(
    canon([{ a: 1 }, { b: 2 }]),
    canon([{ b: 2 }, { a: 1 }]),
    'rule order is meaningful and must matter'
  );
  assert.equal(canon([{ aggregateRules: [{ x: 1, y: 2 }] }]), canon([{ aggregateRules: [{ y: 2, x: 1 }] }]));
  assert.notEqual(canon({ a: 1 }), canon({ a: '1' }), 'value types must not be conflated');
  assert.equal(canon(null), 'null');
});
