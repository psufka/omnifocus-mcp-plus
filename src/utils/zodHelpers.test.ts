import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { optionalIsoDate } from './zodHelpers.js';

const schema = z.object({ d: optionalIsoDate("test") }).strict();

test('optionalIsoDate accepts undefined (omitted)', () => {
  assert.equal(schema.safeParse({}).success, true);
});

test('optionalIsoDate accepts empty string (clear sentinel)', () => {
  assert.equal(schema.safeParse({ d: '' }).success, true);
});

test('optionalIsoDate accepts full ISO 8601 with timezone', () => {
  assert.equal(schema.safeParse({ d: '2026-03-05T09:00:00-06:00' }).success, true);
});

test('optionalIsoDate accepts bare YYYY-MM-DD (Date.parse accepts it)', () => {
  assert.equal(schema.safeParse({ d: '2026-03-05' }).success, true);
});

test('optionalIsoDate rejects "tomorrow"', () => {
  const r = schema.safeParse({ d: 'tomorrow' });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.match(JSON.stringify(r.error.issues), /ISO 8601/i);
  }
});

test('optionalIsoDate rejects nonsense strings', () => {
  for (const bad of ['not-a-date', '2026-13-50', 'abc123']) {
    const r = schema.safeParse({ d: bad });
    assert.equal(r.success, false, `expected ${bad} to be rejected`);
  }
});
