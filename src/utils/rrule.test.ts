import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuleString,
  parseRuleString,
  rulesEquivalent,
  formatIcsUntil,
  describeRuleString,
  RRuleError,
  WEEKDAY_NAMES
} from './rrule.js';

function expectRRuleError(fn: () => unknown, pattern: RegExp): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof RRuleError, `expected RRuleError, got ${String(err)}`);
    assert.match((err as Error).message, pattern);
    return true;
  });
}

// ---------------------------------------------------------------------------
// buildRuleString — happy paths
// ---------------------------------------------------------------------------

test('buildRuleString emits FREQ and a default INTERVAL of 1', () => {
  assert.equal(buildRuleString({ frequency: 'daily' }), 'FREQ=DAILY;INTERVAL=1');
});

test('buildRuleString maps every frequency to its ICS token', () => {
  assert.equal(buildRuleString({ frequency: 'daily' }), 'FREQ=DAILY;INTERVAL=1');
  assert.equal(buildRuleString({ frequency: 'weekly' }), 'FREQ=WEEKLY;INTERVAL=1');
  assert.equal(buildRuleString({ frequency: 'monthly' }), 'FREQ=MONTHLY;INTERVAL=1');
  assert.equal(buildRuleString({ frequency: 'yearly' }), 'FREQ=YEARLY;INTERVAL=1');
});

test('buildRuleString honours an explicit interval', () => {
  assert.equal(buildRuleString({ frequency: 'weekly', interval: 2 }), 'FREQ=WEEKLY;INTERVAL=2');
});

test('buildRuleString builds BYDAY from plain day names in the given order', () => {
  assert.equal(
    buildRuleString({ frequency: 'weekly', daysOfWeek: ['sunday', 'tuesday'] }),
    'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU,TU'
  );
});

test('buildRuleString accepts every weekday name', () => {
  assert.equal(
    buildRuleString({ frequency: 'weekly', daysOfWeek: [...WEEKDAY_NAMES] }),
    'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA,SU'
  );
});

test('buildRuleString normalizes day-name case and whitespace', () => {
  assert.equal(
    buildRuleString({ frequency: 'weekly', daysOfWeek: [' Monday ' as any, 'FRIDAY' as any] }),
    'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,FR'
  );
});

test('buildRuleString emits ordinal BYDAY prefixes for monthly frequency', () => {
  assert.equal(
    buildRuleString({ frequency: 'monthly', daysOfWeek: [{ day: 'tuesday', position: 2 }] }),
    'FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU'
  );
});

test('buildRuleString emits -1 for "last <weekday>"', () => {
  assert.equal(
    buildRuleString({ frequency: 'monthly', daysOfWeek: [{ day: 'friday', position: -1 }] }),
    'FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR'
  );
});

test('buildRuleString allows ordinal BYDAY for yearly frequency', () => {
  assert.equal(
    buildRuleString({ frequency: 'yearly', interval: 2, daysOfWeek: [{ day: 'monday', position: 1 }] }),
    'FREQ=YEARLY;INTERVAL=2;BYDAY=1MO'
  );
});

test('buildRuleString mixes positioned and unpositioned days in a monthly rule', () => {
  assert.equal(
    buildRuleString({
      frequency: 'monthly',
      daysOfWeek: [{ day: 'monday', position: 1 }, { day: 'friday' }]
    }),
    'FREQ=MONTHLY;INTERVAL=1;BYDAY=1MO,FR'
  );
});

test('buildRuleString accepts an object spec with position omitted', () => {
  assert.equal(
    buildRuleString({ frequency: 'weekly', daysOfWeek: [{ day: 'wednesday' }] }),
    'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE'
  );
});

test('buildRuleString builds BYMONTHDAY', () => {
  assert.equal(
    buildRuleString({ frequency: 'monthly', daysOfMonth: [1, 15] }),
    'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15'
  );
});

test('buildRuleString accepts -1 as "last day of the month"', () => {
  assert.equal(
    buildRuleString({ frequency: 'monthly', daysOfMonth: [-1] }),
    'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1'
  );
});

test('buildRuleString accepts day 31', () => {
  assert.equal(
    buildRuleString({ frequency: 'monthly', daysOfMonth: [31] }),
    'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31'
  );
});

test('buildRuleString emits COUNT', () => {
  assert.equal(
    buildRuleString({ frequency: 'daily', count: 5 }),
    'FREQ=DAILY;INTERVAL=1;COUNT=5'
  );
});

test('buildRuleString emits UNTIL in ICS DATE form for a bare date', () => {
  assert.equal(
    buildRuleString({ frequency: 'weekly', daysOfWeek: ['monday'], endDate: '2026-12-31' }),
    'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20261231'
  );
});

test('buildRuleString emits UNTIL in ICS UTC form for a date-time', () => {
  assert.equal(
    buildRuleString({ frequency: 'daily', endDate: '2026-12-31T23:59:59Z' }),
    'FREQ=DAILY;INTERVAL=1;UNTIL=20261231T235959Z'
  );
});

test('buildRuleString converts an offset date-time to UTC for UNTIL', () => {
  // 2026-01-01T00:30:00+02:00 is 2025-12-31T22:30:00Z
  assert.equal(
    buildRuleString({ frequency: 'daily', endDate: '2026-01-01T00:30:00+02:00' }),
    'FREQ=DAILY;INTERVAL=1;UNTIL=20251231T223000Z'
  );
});

test('buildRuleString orders parts canonically: FREQ, INTERVAL, BYDAY, COUNT', () => {
  assert.equal(
    buildRuleString({ frequency: 'monthly', interval: 3, daysOfWeek: [{ day: 'sunday', position: -1 }], count: 12 }),
    'FREQ=MONTHLY;INTERVAL=3;BYDAY=-1SU;COUNT=12'
  );
});

// ---------------------------------------------------------------------------
// buildRuleString — rejections (reject-loud)
// ---------------------------------------------------------------------------

test('buildRuleString rejects a missing frequency', () => {
  expectRRuleError(() => buildRuleString({} as any), /frequency is required/);
});

test('buildRuleString rejects an unknown frequency', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'hourly' as any }), /frequency is required/);
});

test('buildRuleString rejects interval 0 and negatives', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'daily', interval: 0 }), /interval must be a whole number/);
  expectRRuleError(() => buildRuleString({ frequency: 'daily', interval: -2 }), /interval must be a whole number/);
});

test('buildRuleString rejects a fractional interval', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'daily', interval: 1.5 }), /interval must be a whole number/);
});

test('buildRuleString rejects count together with endDate', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'daily', count: 3, endDate: '2026-12-31' }),
    /mutually exclusive/
  );
});

test('buildRuleString rejects count 0', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'daily', count: 0 }), /count must be a whole number/);
});

test('buildRuleString rejects daysOfWeek together with daysOfMonth', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'monthly', daysOfWeek: ['monday'], daysOfMonth: [1] }),
    /cannot be combined/
  );
});

test('buildRuleString rejects daysOfWeek with a daily frequency', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'daily', daysOfWeek: ['monday'] }),
    /frequency 'daily'/
  );
});

test('buildRuleString rejects BYDAY positions for a weekly frequency', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'weekly', daysOfWeek: [{ day: 'tuesday', position: 2 }] }),
    /require frequency 'monthly' or 'yearly'/
  );
});

test('buildRuleString rejects position 0 and out-of-range positions', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'monthly', daysOfWeek: [{ day: 'tuesday', position: 0 }] }),
    /position must be one of/
  );
  expectRRuleError(
    () => buildRuleString({ frequency: 'monthly', daysOfWeek: [{ day: 'tuesday', position: 5 }] }),
    /position must be one of/
  );
  expectRRuleError(
    () => buildRuleString({ frequency: 'monthly', daysOfWeek: [{ day: 'tuesday', position: -2 }] }),
    /position must be one of/
  );
});

test('buildRuleString rejects an unknown day name', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'weekly', daysOfWeek: ['funday' as any] }),
    /unknown day "funday"/
  );
});

test('buildRuleString rejects duplicate weekdays', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'weekly', daysOfWeek: ['monday', 'monday'] }),
    /more than once/
  );
});

test('buildRuleString rejects an empty daysOfWeek array', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'weekly', daysOfWeek: [] }), /must not be empty/);
});

test('buildRuleString rejects daysOfMonth for weekly and daily frequency', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'weekly', daysOfMonth: [1] }),
    /requires frequency 'monthly' or 'yearly'/
  );
  expectRRuleError(
    () => buildRuleString({ frequency: 'daily', daysOfMonth: [1] }),
    /requires frequency 'monthly' or 'yearly'/
  );
});

test('buildRuleString rejects out-of-range days of the month', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'monthly', daysOfMonth: [0] }), /must be 1-31/);
  expectRRuleError(() => buildRuleString({ frequency: 'monthly', daysOfMonth: [32] }), /must be 1-31/);
  expectRRuleError(() => buildRuleString({ frequency: 'monthly', daysOfMonth: [-2] }), /must be 1-31/);
});

test('buildRuleString rejects a fractional day of the month', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'monthly', daysOfMonth: [1.5] }), /whole numbers/);
});

test('buildRuleString rejects duplicate days of the month', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'monthly', daysOfMonth: [3, 3] }), /more than once/);
});

test('buildRuleString rejects an empty daysOfMonth array', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'monthly', daysOfMonth: [] }), /must not be empty/);
});

test('buildRuleString rejects an unparseable endDate', () => {
  expectRRuleError(() => buildRuleString({ frequency: 'daily', endDate: 'next tuesday' }), /not a valid ISO 8601 date/);
});

test('formatIcsUntil rejects an empty string', () => {
  expectRRuleError(() => formatIcsUntil('   '), /must not be empty/);
});

test('formatIcsUntil rejects a bare date that is not a real calendar day', () => {
  // Shape-only validation let "2026-02-30" through and stored UNTIL=20260230,
  // an ICS date that does not exist. JS silently rolls it forward to Mar 2,
  // so the check has to round-trip and compare Y/M/D.
  expectRRuleError(() => formatIcsUntil('2026-02-30'), /not a real calendar date/);
  expectRRuleError(() => formatIcsUntil('2026-04-31'), /not a real calendar date/);
  expectRRuleError(() => formatIcsUntil('2026-13-01'), /not a real calendar date/);
});

test('formatIcsUntil rejects Feb 29 in a non-leap year and accepts it in a leap year', () => {
  expectRRuleError(() => formatIcsUntil('2026-02-29'), /not a real calendar date/);
  assert.equal(formatIcsUntil('2024-02-29'), '20240229');
  assert.equal(formatIcsUntil('2026-02-28'), '20260228');
});

test('buildRuleString refuses an impossible endDate instead of emitting UNTIL for it', () => {
  expectRRuleError(
    () => buildRuleString({ frequency: 'monthly', endDate: '2026-02-30' }),
    /not a real calendar date/
  );
  assert.equal(
    buildRuleString({ frequency: 'monthly', endDate: '2024-02-29' }),
    'FREQ=MONTHLY;INTERVAL=1;UNTIL=20240229'
  );
});

// ---------------------------------------------------------------------------
// parseRuleString
// ---------------------------------------------------------------------------

test('parseRuleString splits a rule into an uppercase key map', () => {
  assert.deepEqual(parseRuleString('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'), {
    FREQ: 'WEEKLY',
    INTERVAL: '2',
    BYDAY: 'MO,WE'
  });
});

test('parseRuleString tolerates a leading RRULE: prefix', () => {
  assert.deepEqual(parseRuleString('RRULE:FREQ=DAILY'), { FREQ: 'DAILY' });
  assert.deepEqual(parseRuleString('rrule:FREQ=DAILY'), { FREQ: 'DAILY' });
});

test('parseRuleString tolerates whitespace, trailing semicolons and lowercase keys', () => {
  assert.deepEqual(parseRuleString('  freq=weekly ; interval=2 ; '), {
    FREQ: 'weekly',
    INTERVAL: '2'
  });
});

test('parseRuleString keeps a malformed segment visible instead of dropping it', () => {
  const parsed = parseRuleString('FREQ=DAILY;GARBAGE');
  assert.equal(parsed.GARBAGE, '');
  assert.equal(parsed.FREQ, 'DAILY');
});

test('parseRuleString preserves "=" inside a value', () => {
  assert.equal(parseRuleString('X-THING=a=b')['X-THING'], 'a=b');
});

test('parseRuleString returns an empty map for non-strings', () => {
  assert.deepEqual(parseRuleString(undefined as any), {});
  assert.deepEqual(parseRuleString('' as any), {});
});

// ---------------------------------------------------------------------------
// rulesEquivalent — order-independent comparison
// ---------------------------------------------------------------------------

test('rulesEquivalent matches identical rules', () => {
  assert.equal(rulesEquivalent('FREQ=DAILY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=1'), true);
});

test('rulesEquivalent ignores the order of the rule parts', () => {
  assert.equal(rulesEquivalent('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', 'BYDAY=MO;INTERVAL=2;FREQ=WEEKLY'), true);
});

test('rulesEquivalent ignores the order inside BYDAY', () => {
  assert.equal(rulesEquivalent('FREQ=WEEKLY;BYDAY=SU,TU', 'FREQ=WEEKLY;BYDAY=TU,SU'), true);
});

test('rulesEquivalent ignores the order inside BYMONTHDAY', () => {
  assert.equal(rulesEquivalent('FREQ=MONTHLY;BYMONTHDAY=1,15', 'FREQ=MONTHLY;BYMONTHDAY=15,1'), true);
});

test('rulesEquivalent treats a missing INTERVAL as INTERVAL=1', () => {
  assert.equal(rulesEquivalent('FREQ=DAILY', 'FREQ=DAILY;INTERVAL=1'), true);
});

test('rulesEquivalent tolerates an RRULE: prefix on one side', () => {
  assert.equal(rulesEquivalent('RRULE:FREQ=DAILY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=1'), true);
});

test('rulesEquivalent is case-insensitive on keys and values', () => {
  assert.equal(rulesEquivalent('freq=daily;interval=1', 'FREQ=DAILY;INTERVAL=1'), true);
});

test('rulesEquivalent distinguishes different intervals', () => {
  assert.equal(rulesEquivalent('FREQ=DAILY;INTERVAL=1', 'FREQ=DAILY;INTERVAL=2'), false);
});

test('rulesEquivalent distinguishes different frequencies', () => {
  assert.equal(rulesEquivalent('FREQ=DAILY', 'FREQ=WEEKLY'), false);
});

test('rulesEquivalent distinguishes a missing part', () => {
  assert.equal(rulesEquivalent('FREQ=WEEKLY;BYDAY=MO', 'FREQ=WEEKLY'), false);
});

test('rulesEquivalent distinguishes an extra part', () => {
  assert.equal(rulesEquivalent('FREQ=WEEKLY', 'FREQ=WEEKLY;COUNT=3'), false);
});

test('rulesEquivalent distinguishes different BYDAY sets of the same size', () => {
  assert.equal(rulesEquivalent('FREQ=WEEKLY;BYDAY=MO,TU', 'FREQ=WEEKLY;BYDAY=MO,WE'), false);
});

test('rulesEquivalent keeps ordinal prefixes significant', () => {
  assert.equal(rulesEquivalent('FREQ=MONTHLY;BYDAY=2TU', 'FREQ=MONTHLY;BYDAY=TU'), false);
  assert.equal(rulesEquivalent('FREQ=MONTHLY;BYDAY=2TU', 'FREQ=MONTHLY;BYDAY=-1TU'), false);
});

test('rulesEquivalent round-trips everything buildRuleString emits', () => {
  const cases = [
    { frequency: 'daily' as const },
    { frequency: 'weekly' as const, interval: 2, daysOfWeek: ['monday', 'friday'] as any },
    { frequency: 'monthly' as const, daysOfWeek: [{ day: 'tuesday' as const, position: 2 }] },
    { frequency: 'monthly' as const, daysOfMonth: [-1] },
    { frequency: 'yearly' as const, interval: 3, count: 4 },
    { frequency: 'weekly' as const, daysOfWeek: ['sunday'] as any, endDate: '2027-01-01' }
  ];
  for (const c of cases) {
    const built = buildRuleString(c);
    assert.equal(rulesEquivalent(built, built), true, built);
    // A shuffled copy must still compare equal.
    const shuffled = built.split(';').reverse().join(';');
    assert.equal(rulesEquivalent(built, shuffled), true, `${built} vs ${shuffled}`);
  }
});

// ---------------------------------------------------------------------------
// describeRuleString
// ---------------------------------------------------------------------------

test('describeRuleString renders a readable summary', () => {
  assert.equal(describeRuleString('FREQ=DAILY;INTERVAL=1'), 'every day');
  assert.equal(describeRuleString('FREQ=WEEKLY;INTERVAL=2'), 'every 2 weeks');
  assert.equal(describeRuleString('FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU'), 'every month, on 2TU');
  assert.equal(describeRuleString('FREQ=DAILY;INTERVAL=1;COUNT=5'), 'every day, 5 time(s)');
});

test('describeRuleString falls back to the raw string for an unknown FREQ', () => {
  assert.equal(describeRuleString('SOMETHING=ELSE'), 'SOMETHING=ELSE');
});
