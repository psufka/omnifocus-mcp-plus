import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLocalDateTimeString, parseLocalDate, isBareDate } from './localDate.js';

test('toLocalDateTimeString converts bare date to local midnight form', () => {
  assert.equal(toLocalDateTimeString('2026-03-05'), '2026-03-05T00:00:00');
  assert.equal(toLocalDateTimeString('  2026-03-05  '), '2026-03-05T00:00:00');
});

test('toLocalDateTimeString passes timestamped input through', () => {
  assert.equal(toLocalDateTimeString('2026-03-05T14:30:00'), '2026-03-05T14:30:00');
  assert.equal(toLocalDateTimeString('2026-03-05T14:30:00Z'), '2026-03-05T14:30:00Z');
  assert.equal(toLocalDateTimeString('2026-03-05T14:30:00-06:00'), '2026-03-05T14:30:00-06:00');
});

test('parseLocalDate yields LOCAL midnight for bare dates', () => {
  const date = parseLocalDate('2026-03-05');
  assert.ok(date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 2);
  assert.equal(date.getDate(), 5);
  assert.equal(date.getHours(), 0);
  assert.equal(date.getMinutes(), 0);
});

test('parseLocalDate differs from naive new Date() in non-UTC zones', () => {
  // In any zone west of UTC, new Date('YYYY-MM-DD') lands on the previous
  // local day; parseLocalDate must not. (In UTC the two coincide.)
  const naive = new Date('2026-03-05');
  const local = parseLocalDate('2026-03-05')!;
  if (new Date().getTimezoneOffset() > 0) {
    assert.notEqual(naive.getDate(), local.getDate());
  } else {
    assert.equal(local.getDate(), 5);
  }
});

test('parseLocalDate returns null on garbage', () => {
  assert.equal(parseLocalDate('not a date'), null);
  assert.equal(parseLocalDate(''), null);
});

test('isBareDate', () => {
  assert.equal(isBareDate('2026-03-05'), true);
  assert.equal(isBareDate('2026-03-05T10:00:00'), false);
  assert.equal(isBareDate('tomorrow'), false);
});
