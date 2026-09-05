/**
 * Local-timezone date handling.
 *
 * JavaScript parses bare "YYYY-MM-DD" strings as UTC midnight, which shifts
 * the date to the previous evening in any timezone west of UTC. Date-time
 * strings WITHOUT a timezone offset ("YYYY-MM-DDTHH:mm:ss") parse as local
 * time — in Node and in OmniFocus's OmniJS runtime alike. Every tool that
 * accepts a date string must route it through these helpers so a bare date
 * means "that calendar day, local time".
 */

import { isValidIsoDate } from './isoDate.js';

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a date string for embedding in an OmniJS script or parsing in
 * Node: bare "YYYY-MM-DD" becomes "YYYY-MM-DDT00:00:00" (local midnight);
 * anything else passes through unchanged.
 */
export function toLocalDateTimeString(input: string): string {
  const trimmed = input.trim();
  if (!isValidIsoDate(trimmed)) throw new Error('Invalid ISO 8601 calendar date: ' + input);
  return BARE_DATE_RE.test(trimmed) ? `${trimmed}T00:00:00` : trimmed;
}

/**
 * Parse a date string treating bare "YYYY-MM-DD" as local midnight.
 * Returns null for unparseable input.
 */
export function parseLocalDate(input: string): Date | null {
  if (!isValidIsoDate(input)) return null;
  const date = new Date(toLocalDateTimeString(input));
  return isNaN(date.getTime()) ? null : date;
}

/** True if the string is a bare YYYY-MM-DD date with no time component. */
export function isBareDate(input: string): boolean {
  return BARE_DATE_RE.test(input.trim());
}
