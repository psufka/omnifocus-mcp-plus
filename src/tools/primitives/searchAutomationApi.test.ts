import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createAutomationApiSearch } from './searchAutomationApi.js';
import { schema } from '../definitions/searchAutomationApi.js';
import { DIAGNOSTIC_SCRIPT } from '../definitions/serverInfo.js';

function fixture(text = 'declare class Task { name: string; }') {
  const calls: string[] = [];
  const app: any = { userVersion: { versionString: '4.9' }, buildVersion: { versionString: '186.1' },
    getTypeScriptDeclarations(query: string) { calls.push(query); return text; } };
  let clock = 1_000_000;
  const search = createAutomationApiSearch(async (script, args, options) => {
    assert.equal(options?.readOnly, true);
    return JSON.parse(runInNewContext(`(function () { ${script} })()`, { app, args }));
  }, () => clock);
  return { app, calls, search, tick: (ms: number) => { clock += ms; } };
}

test('API lookup returns documented text without evaluating the query or returned code', async () => {
  const text = 'throw new Error("this is documentation, not executable code");';
  const f = fixture(text);
  const query = 'Task\"); throw new Error("query"); //';
  const result = await f.search({ query });
  assert.equal(result.success, true);
  assert.deepEqual(f.calls, [query]);
  assert.equal(result.declarations, text);
  assert.equal(result.version, '4.9');
  assert.equal(result.truncated, false);
  assert.equal(result.nextOffset, null);
});

test('lookup on OmniFocus without API support returns an actionable failure', async () => {
  const f = fixture();
  f.app.userVersion.versionString = '4.8.13';
  delete f.app.getTypeScriptDeclarations;
  const result = await f.search({ query: 'Task' });
  assert.equal(result.success, false);
  assert.equal(result.supported, false);
  assert.match(result.error, /OmniFocus 4.9/);
  assert.equal(result.version, '4.8.13');
  assert.deepEqual(f.calls, []);
});

test('API cache checks version/build on every request, expires and supports refresh', async () => {
  const f = fixture();
  const first = await f.search({ query: 'Task' });
  assert.equal(first.cache.hit, false);
  assert.equal((await f.search({ query: 'Task' })).cache.hit, true);
  assert.equal(f.calls.length, 1);
  f.app.buildVersion.versionString = '186.2';
  assert.equal((await f.search({ query: 'Task' })).cache.hit, false);
  f.app.userVersion.versionString = '4.9.1';
  assert.equal((await f.search({ query: 'Task' })).cache.hit, false);
  assert.equal((await f.search({ query: 'Task', refresh: true })).cache.hit, false);
  f.tick(300_000);
  assert.equal((await f.search({ query: 'Task' })).cache.hit, false);
  assert.equal(f.calls.length, 5);
  delete f.app.getTypeScriptDeclarations;
  assert.equal((await f.search({ query: 'Task' })).supported, false);
});

test('pagination reconstructs the full text, keeps surrogate pairs intact and handles an empty final page', async () => {
  const original = 'a'.repeat(255) + '😀' + 'b'.repeat(400);
  const f = fixture(original);
  const first = await f.search({ query: 'Task', maxCharacters: 256 });
  assert.equal(first.declarations, 'a'.repeat(255));
  assert.equal(first.nextOffset, 255);
  let result = first, text = first.declarations;
  while (result.truncated) {
    result = await f.search({ query: 'Task', offset: result.nextOffset, maxCharacters: 256 });
    assert.ok(result.declarations.length <= 256);
    text += result.declarations;
  }
  assert.equal(text, original);
  assert.equal(f.calls.length, 1);
  const beyond = await f.search({ query: 'Task', offset: 9000 });
  assert.equal(beyond.declarations, '');
  assert.equal(beyond.truncated, false);
});

test('empty matches succeed and unexpected documentation formats fail without caching', async () => {
  const empty = fixture('');
  assert.equal((await empty.search({ query: 'nonexistent' })).totalCharacters, 0);
  const invalid = fixture();
  invalid.app.getTypeScriptDeclarations = () => ({ unexpected: true });
  const result = await invalid.search({ query: 'Task' });
  assert.equal(result.success, false);
  assert.match(result.error, /unexpected API documentation format/);
});

test('API cache evicts least recently used queries and bounds retained text size', async () => {
  const f = fixture();
  for (let i = 0; i < 16; i++) await f.search({ query: String(i) });
  await f.search({ query: '0' }); // keep the oldest-used entry alive
  await f.search({ query: '16' });
  assert.equal((await f.search({ query: '0' })).cache.hit, true);
  assert.equal((await f.search({ query: '1' })).cache.hit, false);
  const big = fixture('a'.repeat(600_000));
  await big.search({ query: 'Task' });
  await big.search({ query: 'Project' });
  assert.equal((await big.search({ query: 'Task' })).cache.hit, false);
});

test('lookup schema rejects empty, excessive and unknown inputs before execution', () => {
  for (const input of [{ query: '' }, { query: '   ' }, { query: 'a'.repeat(201) },
    { query: 'Task', offset: -1 }, { query: 'Task', offset: 0.5 },
    { query: 'Task', maxCharacters: 40_001 }, { query: 'Task', code: 'anything' }]) {
    assert.equal(schema.safeParse(input).success, false);
  }
  assert.deepEqual(schema.parse({ query: ' Task ', refresh: true }), { query: 'Task', refresh: true });
});

test('diagnostics detects API support directly, including an empty OmniFocus database', () => {
  const app: any = { userVersion: { versionString: '4.9' }, buildVersion: { versionString: '186.1' } };
  const execute = () => JSON.parse(runInNewContext(`(function () { ${DIAGNOSTIC_SCRIPT} })()`, {
    app, flattenedTasks: [], Task: { byIdentifier() {} }, Project: { byIdentifier() {} }
  }));
  assert.equal(execute().capabilities.automationApiLookup, false);
  app.getTypeScriptDeclarations = () => '';
  assert.equal(execute().capabilities.automationApiLookup, true);
  assert.equal(execute().capabilities.plannedDates, null);
});
