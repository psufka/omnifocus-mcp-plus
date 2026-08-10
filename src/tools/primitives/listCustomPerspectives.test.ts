import assert from 'node:assert/strict';
import test from 'node:test';

import { LIST_PERSPECTIVE_RULES_SCRIPT } from './listCustomPerspectives.js';
import { handler, schema } from '../definitions/listCustomPerspectives.js';

test('list_custom_perspectives schema accepts includeRules', () => {
  const r = schema.safeParse({ includeRules: true });
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
});

test('list_custom_perspectives schema still accepts the original format field alone', () => {
  for (const format of ['simple', 'detailed']) {
    assert.equal(schema.safeParse({ format }).success, true);
  }
  assert.equal(schema.safeParse({}).success, true);
});

test('list_custom_perspectives schema rejects an unknown field', () => {
  const r = schema.safeParse({ includeRules: true, bogusUnknownField: 1 });
  assert.equal(r.success, false);
});

test('list_custom_perspectives schema rejects a non-boolean includeRules', () => {
  assert.equal(schema.safeParse({ includeRules: 'sometimes' }).success, false);
});

test('list_custom_perspectives schema documents that includeRules returns the raw rules', () => {
  const described = String(schema.shape.includeRules.description);
  assert.match(described, /archivedFilterRules|filter rules/i);
  assert.match(described, /aggregation/i);
});

test('perspective rules script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', LIST_PERSPECTIVE_RULES_SCRIPT));
});

test('perspective rules script survives the runOmniJs escaping round-trip', () => {
  assert.ok(!LIST_PERSPECTIVE_RULES_SCRIPT.includes('`'), 'script contains a backtick');
  assert.ok(!LIST_PERSPECTIVE_RULES_SCRIPT.includes('$'), 'script contains a dollar sign');
  assert.ok(!LIST_PERSPECTIVE_RULES_SCRIPT.includes('\\'), 'script contains a backslash');
});

test('perspective rules script reads each field explicitly rather than via Object.keys', () => {
  // Object.keys() returns [] on most OmniJS objects, so field lists are always
  // explicit in this codebase.
  assert.ok(!LIST_PERSPECTIVE_RULES_SCRIPT.includes('Object.keys'));
  assert.match(LIST_PERSPECTIVE_RULES_SCRIPT, /p\.archivedFilterRules/);
  assert.match(LIST_PERSPECTIVE_RULES_SCRIPT, /p\.archivedTopLevelFilterAggregation/);
  assert.match(LIST_PERSPECTIVE_RULES_SCRIPT, /p\.identifier/);
  assert.match(LIST_PERSPECTIVE_RULES_SCRIPT, /p\.name/);
});

test('perspective rules script never mutates a perspective', () => {
  // This path is read-only and is executed with { readOnly: true }.
  assert.doesNotMatch(LIST_PERSPECTIVE_RULES_SCRIPT, /archivedFilterRules\s*=[^=]/);
  assert.doesNotMatch(LIST_PERSPECTIVE_RULES_SCRIPT, /archivedTopLevelFilterAggregation\s*=[^=]/);
});

test('perspective rules script normalizes a missing aggregation to null', () => {
  assert.match(LIST_PERSPECTIVE_RULES_SCRIPT, /agg === undefined\) \? null : agg/);
});

// --- Error passthrough (cache safety) ---------------------------------------
// The primitive never throws: it returns "Error: ..." as a normal string. The
// tool is registered cacheable, and registerStrictTool caches anything that is
// not flagged isError — so an unflagged failure string was served from cache
// for the next 30 seconds.

test('list_custom_perspectives flags a primitive error string as isError', async () => {
  const result: any = await handler({}, {} as any, {
    listCustomPerspectives: async () => 'Error: osascript exited with code 1'
  } as any);

  assert.equal(result.isError, true, 'a failure was returned as a cacheable success');
  assert.match(result.content[0].text, /osascript exited/);
});

test('list_custom_perspectives leaves a successful listing cacheable', async () => {
  const result: any = await handler({}, {} as any, {
    listCustomPerspectives: async () => '**Custom Perspectives** (1)\n\n1. Today'
  } as any);

  assert.equal(result.isError, undefined, 'a normal listing must stay cacheable');
  assert.match(result.content[0].text, /Custom Perspectives/);
});

test('list_custom_perspectives does not mistake a perspective named "Errors" for a failure', async () => {
  const result: any = await handler({}, {} as any, {
    listCustomPerspectives: async () => '**Custom Perspectives** (1)\n\n1. Errors to fix'
  } as any);

  assert.equal(result.isError, undefined);
});
