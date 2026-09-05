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

/**
 * Per-item outcome, additive to the boolean `success`:
 *   ok         — the write landed
 *   planned    — dryRun: this is what WOULD have happened, nothing was written
 *   failed     — this item failed
 *   skipped    — an earlier item failed and stopOnError was set
 *   rolledBack — the item was created, then deleted again because the atomic
 *                batch failed later on
 */
export type BatchItemStatus = 'ok' | 'planned' | 'failed' | 'skipped' | 'rolledBack' | 'rollbackFailed';

/**
 * Where an item is (or would be). `kind` is the container class, never the
 * OmniJS object itself — an OmniJS object serializes to `{}`.
 */
export type BatchPlacement = {
  kind: 'inbox' | 'project' | 'parentTask' | 'folder' | 'library' | 'unknown';
  id?: string;
  name?: string;
  /** dryRun only: the destination is an item created earlier in this batch. */
  tempId?: string;
  pending?: boolean;
};

export type BatchItemResult = {
  index: number;
  success: boolean;
  id?: string;
  name?: string;
  error?: string;
  warnings?: string[];
  /** Additive (v0.5.0). Absent on results produced by older paths. */
  status?: BatchItemStatus;
  /** Caller-supplied handle for this item (batch_add_items hierarchy). */
  tempId?: string;
  /** Post-write read-back confirmed the object exists AND landed where asked. */
  verified?: boolean;
  /** Set when the write landed somewhere other than the requested container. */
  warning?: string;
  /** Where the object actually ended up (post-write read-back). */
  placement?: BatchPlacement;
  /** dryRun: what this item would have created. */
  wouldCreate?: {
    itemType?: string;
    name?: string;
    tempId?: string;
    destination?: BatchPlacement;
    tagsToCreate?: string[];
  };
  /** dryRun: what this item would have removed. */
  wouldRemove?: {
    itemType?: string;
    id?: string;
    name?: string;
  };
  /** dryRun: what this item would have moved, and from where to where. */
  wouldMove?: {
    id?: string;
    name?: string;
    from?: BatchPlacement;
    to?: BatchPlacement;
  };
  wouldEdit?: { id: string; name: string; changes: Record<string, unknown> };
  mismatches?: Array<{ field: string; expected: unknown; actual: unknown; kind?: 'date' }>;
  changedProperties?: string;
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
      results.push({ index, success: false, status: 'failed', error: scriptError });
      continue;
    }
    const success = entry.success === true;
    results.push({
      index,
      success,
      id: entry.id,
      name: entry.name,
      error: success ? undefined : (entry.error || scriptError),
      warnings: Array.isArray(entry.warnings) && entry.warnings.length > 0 ? entry.warnings : undefined,
      // Additive v0.5.0 fields. `status` is derived when the script omits it so
      // every result carries one, even from an older/failed script path.
      status: isStatus(entry.status) ? entry.status : (success ? 'ok' : 'failed'),
      tempId: typeof entry.tempId === 'string' ? entry.tempId : undefined,
      verified: typeof entry.verified === 'boolean' ? entry.verified : undefined,
      warning: typeof entry.warning === 'string' && entry.warning ? entry.warning : undefined,
      placement: entry.placement || undefined,
      wouldCreate: entry.wouldCreate || undefined,
      wouldRemove: entry.wouldRemove || undefined,
      wouldMove: entry.wouldMove || undefined,
      wouldEdit: entry.wouldEdit || undefined,
      mismatches: entry.mismatches || undefined,
      changedProperties: entry.changedProperties || undefined,
    });
  }
  return results;
}

const STATUSES: BatchItemStatus[] = ['ok', 'planned', 'failed', 'skipped', 'rolledBack', 'rollbackFailed'];

function isStatus(value: any): value is BatchItemStatus {
  return typeof value === 'string' && (STATUSES as string[]).indexOf(value) !== -1;
}

/**
 * True when every successful item was read back and confirmed in the requested
 * container. A batch with no successful items is not "verified".
 */
export function allVerified(results: BatchItemResult[]): boolean {
  const succeeded = results.filter(r => r.success);
  if (succeeded.length === 0) return false;
  return succeeded.every(r => r.verified === true);
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
