import assert from 'node:assert/strict';
import test from 'node:test';

import { FIND_SIMILAR_TASKS_SCRIPT, findSimilarTasks } from './findSimilarTasks.js';

// --- script hygiene (the script only ever runs inside OmniFocus) ---

test('find_similar_tasks script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', FIND_SIMILAR_TASKS_SCRIPT));
});

test('find_similar_tasks script survives the runOmniJs escaping round-trip', () => {
  assert.ok(!FIND_SIMILAR_TASKS_SCRIPT.includes('`'), 'script contains a backtick');
  assert.ok(!FIND_SIMILAR_TASKS_SCRIPT.includes('$'), 'script contains a dollar sign');
  assert.ok(!FIND_SIMILAR_TASKS_SCRIPT.includes('\\'), 'script contains a backslash');
});

test('find_similar_tasks script reads user data only from the args object', () => {
  assert.match(FIND_SIMILAR_TASKS_SCRIPT, /\bargs\b/);
});

test('find_similar_tasks script does no matching of its own — scoring lives in Node', () => {
  assert.doesNotMatch(FIND_SIMILAR_TASKS_SCRIPT, /args\.name/, 'the search string must never reach the script');
  assert.doesNotMatch(FIND_SIMILAR_TASKS_SCRIPT, /indexOf\(args/, 'no in-script matching');
});

test('find_similar_tasks script skips completed and dropped tasks unless asked', () => {
  assert.match(FIND_SIMILAR_TASKS_SCRIPT, /includeCompleted/);
  assert.match(FIND_SIMILAR_TASKS_SCRIPT, /Task\.Status\.Completed/);
  assert.match(FIND_SIMILAR_TASKS_SCRIPT, /Task\.Status\.Dropped/);
});

// --- Node layer, with runOmniJs mocked ---

interface RunCall { script: string; args: any; options: any }

function mockRunner(response: any) {
  const calls: RunCall[] = [];
  const run = async (script: string, args?: any, options?: any) => {
    calls.push({ script, args, options });
    return response;
  };
  return { run: run as any, calls };
}

const SAMPLE_TASKS = [
  { id: 't1', name: 'Buy milk', projectName: 'Errands', status: 'Available' },
  { id: 't2', name: 'Buy mlik', projectName: null, status: 'Available' },
  { id: 't3', name: 'Deploy the API gateway', projectName: 'Work', status: 'Next' }
];

test('findSimilarTasks rejects an empty name without calling OmniFocus', async () => {
  const { run, calls } = mockRunner({ success: true, tasks: [] });
  const result = await findSimilarTasks({ name: '   ' }, run);
  assert.equal(result.success, false);
  assert.match(result.error || '', /name is required/);
  assert.equal(calls.length, 0, 'no script should run for invalid input');
});

test('findSimilarTasks marks its script read-only and passes only includeCompleted', async () => {
  const { run, calls } = mockRunner({ success: true, candidateCount: 3, tasks: SAMPLE_TASKS });
  await findSimilarTasks({ name: 'Buy milk', includeCompleted: true }, run);
  assert.equal(calls.length, 1, 'exactly one script evaluation per call');
  assert.deepEqual(calls[0].args, { includeCompleted: true });
  assert.deepEqual(calls[0].options, { readOnly: true });
});

test('findSimilarTasks ranks candidates in Node and reports the scan size', async () => {
  const { run } = mockRunner({ success: true, candidateCount: 3, tasks: SAMPLE_TASKS });
  const result = await findSimilarTasks({ name: 'Buy milk' }, run);
  assert.equal(result.success, true);
  assert.equal(result.candidatesScanned, 3);
  assert.equal(result.query, 'Buy milk');
  assert.equal(result.matches?.[0].id, 't1');
  assert.equal(result.matches?.[0].score, 1);
  assert.equal(result.matches?.[0].projectName, 'Errands');
  assert.ok(!result.matches?.some(m => m.id === 't3'), 'unrelated task must not be returned');
});

test('findSimilarTasks honours limit and minScore', async () => {
  const { run } = mockRunner({ success: true, candidateCount: 3, tasks: SAMPLE_TASKS });
  const limited = await findSimilarTasks({ name: 'Buy milk', limit: 1 }, run);
  assert.equal(limited.matches?.length, 1);

  const strict = await findSimilarTasks({ name: 'Buy milk', minScore: 0.99 }, run);
  assert.equal(strict.matches?.length, 1, 'only the exact match clears a 0.99 threshold');
  assert.equal(strict.minScore, 0.99);
});

test('findSimilarTasks surfaces a script failure instead of pretending there were no matches', async () => {
  const { run } = mockRunner({ success: false, error: 'OmniFocus returned empty output' });
  const result = await findSimilarTasks({ name: 'Buy milk' }, run);
  assert.equal(result.success, false);
  assert.match(result.error || '', /empty output/);
});
