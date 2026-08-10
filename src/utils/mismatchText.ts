import type { EditItemMismatch } from '../tools/primitives/editItem.js';

/**
 * Rendering for post-write read-back mismatches (edit_item, move_task).
 *
 * The wire format is deliberately timezone-free: a date mismatch carries epoch
 * milliseconds plus `kind: 'date'`, and the rendering happens HERE so no
 * `…Z` timestamp can reach the caller (see the date conventions in
 * docs/dev/CONVENTIONS-0.5.md).
 */

/** Container fields, in the order edit_item records them. */
const CONTAINER_FIELDS = ['moveToInbox', 'project', 'parentTask', 'folder'];

/** One mismatch value, rendered for a human — local time for dates. */
export function formatMismatchValue(value: unknown, kind?: string): string {
  if (value === null || value === undefined) return 'none';

  if (kind === 'date') {
    const ms = typeof value === 'number' ? value : Date.parse(String(value));
    if (Number.isFinite(ms)) return `"${new Date(ms).toLocaleString()}"`;
  }

  return JSON.stringify(value);
}

/** Bulleted "field: expected X, got Y" lines, one per mismatch. */
export function formatMismatchLines(mismatches: EditItemMismatch[]): string {
  return mismatches
    .map(
      m =>
        `• ${m.field}: expected ${formatMismatchValue(m.expected, m.kind)}, ` +
        `got ${formatMismatchValue(m.actual, m.kind)}`
    )
    .join('\n');
}

/**
 * Where the item ACTUALLY ended up, taken from the container mismatch. Returns
 * null when the read-back failed for some non-container reason, in which case
 * the caller should not claim to know the destination.
 */
export function actualContainerFromMismatches(mismatches: EditItemMismatch[]): string | null {
  const container = mismatches.find(m => CONTAINER_FIELDS.includes(m.field));
  if (!container) return null;
  if (container.actual === null || container.actual === undefined) {
    return 'no project (inbox, or a loose task)';
  }
  return `"${String(container.actual)}"`;
}
