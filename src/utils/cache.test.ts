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
