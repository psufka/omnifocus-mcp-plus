/**
 * ICS (RFC 5545) RRULE construction and comparison — pure TypeScript, no
 * OmniFocus dependency.
 *
 * OmniFocus stores a repetition rule's `ruleString` VERBATIM (probed live on
 * OmniFocus 4.8.13: every well-formed string round-tripped byte-identical,
 * including an `RRULE:` prefix, and an unknown FREQ threw
 * `Unknown value "BOGUS" for FREQ` at construction). Two consequences:
 *
 *   1. This module is the only place that decides what a structured request
 *      turns into — OmniFocus will not normalize a sloppy string for us.
 *   2. Read-back verification must compare rule strings order-independently:
 *      RFC 5545 gives the parts of an RRULE no ordering guarantee, so a
 *      byte comparison could report a false mismatch if OmniFocus (or a future
 *      version) ever reorders them.
 *
 * Scope is deliberately narrower than RFC 5545: the structured builder emits
 * FREQ / INTERVAL / BYDAY / BYMONTHDAY / COUNT / UNTIL only. Anything more
 * exotic goes through set_task_repetition's raw `rule_string` escape hatch.
 */

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type WeekdayName =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday';

export interface DayOfWeekSpec {
  day: WeekdayName;
  /** ICS ordinal prefix: 1..4 = "1st".."4th", -1 = "last". Monthly/yearly only. */
  position?: number;
}

export type DayOfWeekInput = WeekdayName | DayOfWeekSpec;

export interface BuildRuleParams {
  frequency: Frequency;
  interval?: number;
  daysOfWeek?: DayOfWeekInput[];
  daysOfMonth?: number[];
  count?: number;
  /** ISO date or date-time. Bare YYYY-MM-DD emits the ICS DATE form. */
  endDate?: string;
}

/** Thrown for any request this module refuses to turn into a rule string. */
export class RRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RRuleError';
  }
}

export const WEEKDAY_NAMES: readonly WeekdayName[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
];

const WEEKDAY_CODES: Record<WeekdayName, string> = {
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
  sunday: 'SU'
};

const FREQ_CODES: Record<Frequency, string> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY'
};

/** RRULE parts whose value is a comma-separated LIST with no ordering meaning. */
const LIST_VALUED_KEYS = new Set([
  'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYYEARDAY', 'BYWEEKNO',
  'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYSETPOS'
]);

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_POSITIONS = [-1, 1, 2, 3, 4];

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Render an ISO date/date-time as an ICS UNTIL value.
 *
 * A bare `YYYY-MM-DD` becomes the ICS DATE form `YYYYMMDD` — no timezone is
 * implied and none is invented, which is exactly what "repeat until this
 * calendar day" means. Anything with a time becomes the ICS UTC DATE-TIME form
 * `YYYYMMDDTHHMMSSZ`, per RFC 5545 §3.3.10 (UNTIL must be UTC when the rule has
 * a time component).
 *
 * The trailing `Z` here is ICS wire syntax inside an opaque rule string, not a
 * date rendered to the caller — it is not the UTC leak the date conventions
 * forbid.
 */
export function formatIcsUntil(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new RRuleError('endDate must not be empty');
  }
  if (BARE_DATE_RE.test(trimmed)) {
    // The regex only proves the SHAPE is right. "2026-02-30" would sail
    // through and be stored verbatim as UNTIL=20260230, an ICS date that does
    // not exist — so round-trip it through Date and demand the same Y/M/D back
    // (JS rolls Feb 30 forward to Mar 2 instead of failing).
    const [year, month, day] = trimmed.split('-').map(Number);
    const probe = new Date(year, month - 1, day);
    if (
      probe.getFullYear() !== year ||
      probe.getMonth() !== month - 1 ||
      probe.getDate() !== day
    ) {
      throw new RRuleError(
        `endDate is not a real calendar date: ${input}. Check the month length (and leap years) — e.g. 2026-02-30 and 2026-02-29 do not exist.`
      );
    }
    return trimmed.replace(/-/g, '');
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new RRuleError(
      `endDate is not a valid ISO 8601 date: ${input}. Use 'YYYY-MM-DD' or a full date-time with offset (e.g. 2026-12-31T23:59:59-06:00).`
    );
  }
  return (
    `${parsed.getUTCFullYear()}${pad(parsed.getUTCMonth() + 1)}${pad(parsed.getUTCDate())}` +
    `T${pad(parsed.getUTCHours())}${pad(parsed.getUTCMinutes())}${pad(parsed.getUTCSeconds())}Z`
  );
}

function normalizeDay(entry: DayOfWeekInput, index: number): DayOfWeekSpec {
  if (typeof entry === 'string') {
    const day = entry.trim().toLowerCase() as WeekdayName;
    if (!WEEKDAY_CODES[day]) {
      throw new RRuleError(
        `daysOfWeek[${index}]: unknown day "${entry}". Use one of: ${WEEKDAY_NAMES.join(', ')}.`
      );
    }
    return { day };
  }
  if (!entry || typeof entry !== 'object') {
    throw new RRuleError(
      `daysOfWeek[${index}] must be a day name or an object like { day: 'tuesday', position: 2 }.`
    );
  }
  const day = String(entry.day ?? '').trim().toLowerCase() as WeekdayName;
  if (!WEEKDAY_CODES[day]) {
    throw new RRuleError(
      `daysOfWeek[${index}]: unknown day "${entry.day}". Use one of: ${WEEKDAY_NAMES.join(', ')}.`
    );
  }
  if (entry.position === undefined || entry.position === null) {
    return { day };
  }
  const position = entry.position;
  if (!Number.isInteger(position) || !ALLOWED_POSITIONS.includes(position)) {
    throw new RRuleError(
      `daysOfWeek[${index}].position must be one of ${ALLOWED_POSITIONS.join(', ')} (1-4 = first through fourth, -1 = last); got ${String(position)}.`
    );
  }
  return { day, position };
}

function buildByDay(
  frequency: Frequency,
  daysOfWeek: DayOfWeekInput[]
): string {
  if (daysOfWeek.length === 0) {
    throw new RRuleError('daysOfWeek must not be empty — omit it instead.');
  }
  const specs = daysOfWeek.map(normalizeDay);

  const seen = new Set<WeekdayName>();
  for (const spec of specs) {
    if (seen.has(spec.day)) {
      throw new RRuleError(`daysOfWeek lists "${spec.day}" more than once.`);
    }
    seen.add(spec.day);
  }

  if (frequency === 'daily') {
    throw new RRuleError(
      "daysOfWeek cannot be combined with frequency 'daily' — use frequency 'weekly' to repeat on specific weekdays."
    );
  }
  const positioned = specs.filter(s => s.position !== undefined);
  if (positioned.length > 0 && frequency !== 'monthly' && frequency !== 'yearly') {
    throw new RRuleError(
      `daysOfWeek positions (e.g. "2nd Tuesday") require frequency 'monthly' or 'yearly'; got '${frequency}'.`
    );
  }

  // Keep the caller's order: BYDAY is order-insensitive per RFC 5545, and
  // preserving input order makes the emitted string match what was asked for.
  return specs
    .map(s => (s.position === undefined ? WEEKDAY_CODES[s.day] : `${s.position}${WEEKDAY_CODES[s.day]}`))
    .join(',');
}

function buildByMonthDay(frequency: Frequency, daysOfMonth: number[]): string {
  if (daysOfMonth.length === 0) {
    throw new RRuleError('daysOfMonth must not be empty — omit it instead.');
  }
  if (frequency !== 'monthly' && frequency !== 'yearly') {
    throw new RRuleError(
      `daysOfMonth requires frequency 'monthly' or 'yearly'; got '${frequency}'.`
    );
  }
  const seen = new Set<number>();
  for (const day of daysOfMonth) {
    if (!Number.isInteger(day)) {
      throw new RRuleError(`daysOfMonth entries must be whole numbers; got ${String(day)}.`);
    }
    if (day === 0 || day > 31 || day < -1) {
      throw new RRuleError(
        `daysOfMonth entries must be 1-31, or -1 for the last day of the month; got ${day}.`
      );
    }
    if (seen.has(day)) {
      throw new RRuleError(`daysOfMonth lists ${day} more than once.`);
    }
    seen.add(day);
  }
  return daysOfMonth.join(',');
}

/**
 * Compose a bare ICS RRULE body (no `RRULE:` prefix — OmniFocus stores the
 * string verbatim and its own UI writes the bare form).
 *
 * Throws RRuleError for any combination this tool refuses to emit, so an
 * unsupported request fails at validation time rather than silently producing a
 * rule that repeats on the wrong schedule.
 */
export function buildRuleString(params: BuildRuleParams): string {
  const { frequency, interval, daysOfWeek, daysOfMonth, count, endDate } = params;

  if (!frequency || !FREQ_CODES[frequency]) {
    throw new RRuleError(
      `frequency is required and must be one of: ${Object.keys(FREQ_CODES).join(', ')}.`
    );
  }

  const resolvedInterval = interval === undefined ? 1 : interval;
  if (!Number.isInteger(resolvedInterval) || resolvedInterval < 1) {
    throw new RRuleError(`interval must be a whole number >= 1; got ${String(interval)}.`);
  }

  if (count !== undefined && endDate !== undefined) {
    throw new RRuleError(
      'count and endDate are mutually exclusive — RFC 5545 allows COUNT or UNTIL, never both. Pick one.'
    );
  }
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
    throw new RRuleError(`count must be a whole number >= 1; got ${String(count)}.`);
  }

  if (daysOfWeek !== undefined && daysOfMonth !== undefined) {
    throw new RRuleError(
      'daysOfWeek and daysOfMonth cannot be combined — OmniFocus cannot express the intersection in its repeat editor. Use one, or pass a raw rule_string.'
    );
  }

  const parts: string[] = [`FREQ=${FREQ_CODES[frequency]}`, `INTERVAL=${resolvedInterval}`];

  if (daysOfWeek !== undefined) {
    parts.push(`BYDAY=${buildByDay(frequency, daysOfWeek)}`);
  }
  if (daysOfMonth !== undefined) {
    parts.push(`BYMONTHDAY=${buildByMonthDay(frequency, daysOfMonth)}`);
  }
  if (count !== undefined) {
    parts.push(`COUNT=${count}`);
  }
  if (endDate !== undefined) {
    parts.push(`UNTIL=${formatIcsUntil(endDate)}`);
  }

  return parts.join(';');
}

/**
 * Parse an RRULE body into an uppercase key -> raw value map. Tolerates a
 * leading `RRULE:` prefix and stray whitespace/semicolons. Values keep their
 * original case (a search string could be case-sensitive), so comparison
 * upper-cases explicitly.
 */
export function parseRuleString(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof input !== 'string') return out;

  let body = input.trim();
  if (/^rrule:/i.test(body)) {
    body = body.slice(6).trim();
  }

  for (const segment of body.split(';')) {
    const part = segment.trim();
    if (part === '') continue;
    const eq = part.indexOf('=');
    if (eq <= 0) {
      // A malformed segment is recorded under its own name with an empty value
      // so rulesEquivalent() still sees the difference rather than dropping it.
      out[part.toUpperCase()] = '';
      continue;
    }
    out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
  }
  return out;
}

function comparableValue(key: string, value: string): string {
  const upper = value.toUpperCase();
  if (!LIST_VALUED_KEYS.has(key)) return upper;
  return upper
    .split(',')
    .map(v => v.trim())
    .filter(v => v !== '')
    .sort()
    .join(',');
}

/**
 * Order-independent RRULE comparison, used to verify that what OmniFocus stored
 * is the rule that was requested. RFC 5545 gives rule parts no ordering
 * guarantee, and BYDAY/BYMONTHDAY-style values are sets, so both levels are
 * normalized before comparing.
 *
 * A missing INTERVAL is treated as INTERVAL=1 (the RFC default), so the
 * canonical string this module emits still matches a hand-written rule that
 * left it out.
 */
export function rulesEquivalent(a: string, b: string): boolean {
  const left = parseRuleString(a);
  const right = parseRuleString(b);

  if (left.INTERVAL === undefined) left.INTERVAL = '1';
  if (right.INTERVAL === undefined) right.INTERVAL = '1';

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const lv = left[key];
    const rv = right[key];
    if (lv === undefined || rv === undefined) return false;
    if (comparableValue(key, lv) !== comparableValue(key, rv)) return false;
  }
  return true;
}

/** Human-readable summary of a rule string, for tool output. */
export function describeRuleString(input: string): string {
  const parsed = parseRuleString(input);
  const freq = (parsed.FREQ || '').toLowerCase();
  const interval = parsed.INTERVAL ? Number(parsed.INTERVAL) : 1;

  const unit: Record<string, string> = {
    daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year'
  };
  const base = unit[freq]
    ? interval === 1 ? `every ${unit[freq]}` : `every ${interval} ${unit[freq]}s`
    : input;

  const extras: string[] = [];
  if (parsed.BYDAY) extras.push(`on ${parsed.BYDAY}`);
  if (parsed.BYMONTHDAY) extras.push(`on day ${parsed.BYMONTHDAY}`);
  if (parsed.COUNT) extras.push(`${parsed.COUNT} time(s)`);
  if (parsed.UNTIL) extras.push(`until ${parsed.UNTIL}`);

  return extras.length ? `${base}, ${extras.join(', ')}` : base;
}
