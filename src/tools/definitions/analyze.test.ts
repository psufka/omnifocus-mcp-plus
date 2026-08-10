process.env.TZ = 'America/Chicago';

import assert from 'node:assert/strict';
import test from 'node:test';

import { schema, handler } from './analyze.js';
import { ANALYZE_SCRIPT } from '../primitives/analyze.js';

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

test('schema accepts each analysis with no options', () => {
  for (const analysis of ['health_snapshot', 'velocity', 'overdue_clusters', 'stalled_projects']) {
    assert.equal(schema.safeParse({ analysis }).success, true, `${analysis} should parse`);
  }
});

test('schema rejects an unknown analysis value', () => {
  const result = schema.safeParse({ analysis: 'health' });
  assert.equal(result.success, false);
});

test('schema requires the analysis field', () => {
  assert.equal(schema.safeParse({}).success, false);
});

test('schema rejects an unknown top-level field', () => {
  assert.equal(schema.safeParse({ analysis: 'velocity', days: 7 }).success, false);
});

test('schema rejects velocity days outside 1-90 and non-integers', () => {
  assert.equal(schema.safeParse({ analysis: 'velocity', velocity: { days: 0 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'velocity', velocity: { days: 91 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'velocity', velocity: { days: -5 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'velocity', velocity: { days: 7.5 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'velocity', velocity: { days: 1 } }).success, true);
  assert.equal(schema.safeParse({ analysis: 'velocity', velocity: { days: 90 } }).success, true);
});

test('schema rejects out-of-range overdue topN and stalled inactiveDays', () => {
  assert.equal(schema.safeParse({ analysis: 'overdue_clusters', overdueClusters: { topN: 0 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'overdue_clusters', overdueClusters: { topN: 101 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'overdue_clusters', overdueClusters: { topN: 10 } }).success, true);

  assert.equal(schema.safeParse({ analysis: 'stalled_projects', stalledProjects: { inactiveDays: 0 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'stalled_projects', stalledProjects: { inactiveDays: 3651 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'stalled_projects', stalledProjects: { inactiveDays: 30, includeOnHold: true } }).success, true);
});

// A non-strict nested object silently swallows a typo'd key and then quietly
// uses the default — the single most expensive failure mode for an options bag.
test('every nested option object is strict', () => {
  assert.equal(schema.safeParse({ analysis: 'velocity', velocity: { day: 7 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'overdue_clusters', overdueClusters: { top_n: 5 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'stalled_projects', stalledProjects: { inactivedays: 60 } }).success, false);
  assert.equal(schema.safeParse({ analysis: 'stalled_projects', stalledProjects: { includeOnHold: 'yes' } }).success, false);
});

// ---------------------------------------------------------------------------
// Handler — `deps` is the test-only third parameter; MCP calls (args, extra).
// ---------------------------------------------------------------------------

function stubExecutor(payload: any) {
  const calls: Array<{ script: string; args: any; options: any }> = [];
  return {
    deps: {
      runOmniJs: async (script: string, args?: any, options?: any) => {
        calls.push({ script, args, options });
        return payload;
      }
    },
    calls
  };
}

test('handler returns rendered markdown and passes resolved args to a read-only script', async () => {
  const { deps, calls } = stubExecutor({
    success: true,
    analysis: 'health_snapshot',
    generatedIso: new Date(2026, 7, 10, 11, 0).toISOString(),
    incompleteTotal: 12,
    projects: { active: 3, onHold: 0, done: 0, dropped: 0, total: 3 }
  });

  const result: any = await handler({ analysis: 'health_snapshot' } as any, {} as any, deps);

  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /# OmniFocus health snapshot/);
  assert.match(result.content[0].text, /\| Incomplete tasks \(total\) \| 12 \|/);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, ANALYZE_SCRIPT);
  assert.deepEqual(calls[0].options, { readOnly: true });
  assert.deepEqual(calls[0].args, {
    analysis: 'health_snapshot',
    days: 14,
    inactiveDays: 30,
    includeOnHold: false
  });
});

test('handler forwards caller options into the script args', async () => {
  const { deps, calls } = stubExecutor({ success: true, projects: [], scannedProjects: 0 });

  await handler(
    { analysis: 'stalled_projects', stalledProjects: { inactiveDays: 60, includeOnHold: true } } as any,
    {} as any,
    deps
  );

  assert.deepEqual(calls[0].args, {
    analysis: 'stalled_projects',
    days: 14,
    inactiveDays: 60,
    includeOnHold: true
  });
});

test('handler applies topN on the Node side rather than in the script', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    count: 5 - i,
    oldestDueIso: new Date(2026, 6, 9, 17, 0).toISOString()
  }));
  const { deps, calls } = stubExecutor({
    success: true,
    generatedIso: new Date(2026, 7, 10, 11, 0).toISOString(),
    totalOverdue: 15,
    untaggedOverdue: 0,
    byProject: rows,
    byTag: []
  });

  const result: any = await handler(
    { analysis: 'overdue_clusters', overdueClusters: { topN: 2 } } as any,
    {} as any,
    deps
  );

  assert.ok(!('topN' in calls[0].args), 'topN is a rendering concern, not a script argument');
  assert.ok(result.content[0].text.includes('| Project 1 |'));
  assert.ok(!result.content[0].text.includes('| Project 2 |'));
  assert.match(result.content[0].text, /\+ 3 more in other projects \(6 overdue tasks not shown\)/);
});

test('handler reports a script-level failure as an error result', async () => {
  const { deps } = stubExecutor({ success: false, error: 'OmniFocus is not running' });
  const result: any = await handler({ analysis: 'velocity' } as any, {} as any, deps);

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Error: OmniFocus is not running/);
});

test('handler reports a thrown executor error as an error result', async () => {
  const deps = {
    runOmniJs: async () => {
      throw new Error('osascript timed out');
    }
  };
  const result: any = await handler({ analysis: 'velocity' } as any, {} as any, deps);

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Error running analysis: osascript timed out/);
});
