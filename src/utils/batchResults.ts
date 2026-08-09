/**
 * Shared result handling for the batch primitives (batch_add_items,
 * batch_remove_items, batch_move_tasks).
 *
 * Every batch primitive now runs ONE OmniJS script that loops over the items
 * and returns a per-item results array. Two things have to be true no matter
 * how the script exits:
 *
 *   1. The caller always gets exactly one result per input item, in input
 *      order — even when the whole script blew up before the loop ran.
 *   2. When nothing succeeded, the batch-level `error` carries a summary built
 *      from the per-item errors, instead of `undefined` (which is what the
 *      handlers used to print as "Failed to process batch operation: undefined").
 */

export type BatchItemResult = {
  index: number;
  success: boolean;
  id?: string;
  name?: string;
  error?: string;
  warnings?: string[];
};

/**
 * Turn whatever runOmniJs returned into a full-length per-item results array.
 * A script-level failure (or any unexpected shape) becomes one failed result
 * per input item so handlers can always render item-by-item output.
 */
export function coerceBatchResults(raw: any, itemCount: number, fallbackError: string): BatchItemResult[] {
  const rawResults = raw && Array.isArray(raw.results) ? (raw.results as any[]) : null;

  const rawDetail = raw && typeof raw.raw === 'string' && raw.raw ? ` (${raw.raw})` : '';
  const scriptError =
    (raw && typeof raw.error === 'string' && raw.error ? `${raw.error}${rawDetail}` : '') ||
    (typeof raw === 'string' && raw.trim() ? raw.trim() : '') ||
    fallbackError;

  const results: BatchItemResult[] = [];
  for (let index = 0; index < itemCount; index++) {
    const entry = rawResults ? rawResults.find(r => r && r.index === index) : undefined;
    if (!entry) {
      results.push({ index, success: false, error: scriptError });
      continue;
    }
    results.push({
      index,
      success: entry.success === true,
      id: entry.id,
      name: entry.name,
      error: entry.success === true ? undefined : (entry.error || scriptError),
      warnings: Array.isArray(entry.warnings) && entry.warnings.length > 0 ? entry.warnings : undefined,
    });
  }
  return results;
}

/**
 * Build the batch-level error summary from per-item errors. Returns undefined
 * when at least one item succeeded (partial success is not a batch failure).
 */
export function summarizeBatchErrors(results: BatchItemResult[], verb = 'processed'): string | undefined {
  if (results.some(r => r.success)) return undefined;
  if (results.length === 0) return `No items were ${verb}.`;

  const shown = results.slice(0, 5).map(r => {
    const label = r.name || r.id || `item ${r.index}`;
    return `[${r.index}] ${label}: ${r.error || 'unknown error'}`;
  });
  const more = results.length > shown.length ? ` (+${results.length - shown.length} more)` : '';
  return `All ${results.length} item${results.length === 1 ? '' : 's'} failed — ${shown.join('; ')}${more}`;
}
