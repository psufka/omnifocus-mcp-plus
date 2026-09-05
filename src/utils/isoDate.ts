/** Validate calendar components before Date.parse can normalize an impossible day. */
export function isValidIsoDate(input: string): boolean {
  const value = input.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h, minute, second, , , offsetHour, offsetMinute] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return false;
  if (h !== undefined && (Number(h) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59)) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}
