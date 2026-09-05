import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { cacheKey, cacheGet, cacheSet, cacheClear, cacheSize } from './cache.js';

test('cacheKey: distinct per tool and per args, stable for identical input', () => {
  assert.equal(cacheKey('a', { x: 1 }), cacheKey('a', { x: 1 }));
  assert.notEqual(cacheKey('a', { x: 1 }), cacheKey('b', { x: 1 }));
  assert.notEqual(cacheKey('a', { x: 1 }), cacheKey('a', { x: 2 }));
  assert.equal(cacheKey('a', undefined), cacheKey('a', {}));
});

test('cache: set/get round-trip, TTL expiry, clear', async () => {
  cacheClear();
  const key = cacheKey('t', {});
  assert.equal(cacheGet(key), undefined);

  cacheSet(key, { hello: 'world' }, 50);
  assert.deepEqual(cacheGet(key), { hello: 'world' });
  assert.equal(cacheSize(), 1);

  await sleep(60);
  assert.equal(cacheGet(key), undefined, 'entry must expire after its TTL');

  cacheSet(key, 1);
  cacheClear();
  assert.equal(cacheGet(key), undefined);
  assert.equal(cacheSize(), 0);
});

test('cache generation rejects obsolete fills and LRU bounds storage', async () => {
  const { cacheGeneration, MAX_CACHE_ENTRIES, MAX_CACHE_BYTES } = await import('./cache.js');
  cacheClear();
  const oldGeneration = cacheGeneration();
  cacheClear();
  cacheSet('stale', 'before', 30_000, oldGeneration);
  assert.equal(cacheGet('stale'), undefined);
  for (let i = 0; i < MAX_CACHE_ENTRIES; i++) cacheSet(String(i), i);
  cacheGet('0');
  cacheSet('next', 1);
  assert.equal(cacheSize(), MAX_CACHE_ENTRIES);
  assert.equal(cacheGet('1'), undefined);
  assert.equal(cacheGet('0'), 0);
  cacheSet('too-large', 'x'.repeat(MAX_CACHE_BYTES));
  assert.equal(cacheGet('too-large'), undefined);
  cacheClear();
});
