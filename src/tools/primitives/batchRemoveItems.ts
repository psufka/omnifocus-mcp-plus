import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { BatchItemResult, allVerified, coerceBatchResults, summarizeBatchErrors } from '../../utils/batchResults.js';

// Define the parameters for the batch removal operation
// (same shape as remove_item's params, declared here so the batch tool does not
// depend on the single-item primitive's internals)
export type BatchRemoveItemsParams = {
  id?: string;          // ID of the task or project to remove
  name?: string;        // Name of the task or project to remove (only when no id is given)
  itemType: 'task' | 'project';
};

/** Batch-wide options. */
export type BatchRemoveItemsOptions = {
  /** Resolve every item, delete nothing. */
  dryRun?: boolean;
};

// Define the result type for individual operations
export type ItemResult = BatchItemResult;

// Define the result type for the batch operation
type BatchResult = {
  success: boolean;
  results: ItemResult[];
  error?: string;
  /** true when nothing was deleted (dryRun). */
  dryRun?: boolean;
  /** Every deleted id was confirmed unresolvable afterwards. */
  verified?: boolean;
};

type PreparedItem = BatchRemoveItemsParams & { preflightError?: string };

export function prepareRemoveItems(items: BatchRemoveItemsParams[]): PreparedItem[] {
  return items.map(item => {
    const prepared: PreparedItem = { ...item };
    if (!item.id && !item.name) {
      prepared.preflightError = 'Either id or name must be provided to remove an item.';
    } else if (item.itemType !== 'task' && item.itemType !== 'project') {
      prepared.preflightError = `Invalid item type: ${String(item.itemType)}. Expected 'task' or 'project'.`;
    }
    return prepared;
  });
}

// One static script for the whole batch — every user value arrives through the
// injected `args` object. Resolution is identical in a dry run and a real run;
// the delete itself is one guarded block, and every delete is verified by
// re-resolving the id (a hit means the object survived).
export const BATCH_REMOVE_ITEMS_SCRIPT = `
    ${OMNIJS_LOOKUP_HELPERS}

    const dryRun = args.dryRun === true;
    const results = [];

    for (let i = 0; i < args.items.length; i++) {
      const item = args.items[i];
      try {
        if (item.preflightError) {
          results.push({ index: i, success: false, status: 'failed', id: item.id, name: item.name, error: item.preflightError });
          continue;
        }

        // Re-read the collection each iteration: earlier deletions must not
        // leave a stale object behind for a later lookup to match.
        const collection = item.itemType === 'task' ? flattenedTasks : flattenedProjects;
        const lookup = __resolveByIdOrName(collection, item.id, item.name, item.itemType);
        if (lookup.error) {
          results.push({ index: i, success: false, status: 'failed', id: item.id, name: item.name, error: lookup.error });
          continue;
        }

        const found = lookup.item;
        const foundId = found.id.primaryKey;
        const foundName = found.name;

        if (dryRun) {
          results.push({
            index: i,
            success: true,
            status: 'planned',
            id: foundId,
            name: foundName,
            wouldRemove: { itemType: item.itemType, id: foundId, name: foundName }
          });
          continue;
        }

        deleteObject(found);

        // Verify in this same script: the id must no longer resolve. __findById
        // checks membership in the freshly read collection, so a zombie object
        // returned by byIdentifier still counts as gone.
        const afterCollection = item.itemType === 'task' ? flattenedTasks : flattenedProjects;
        const stillThere = __findById(afterCollection, foundId, item.itemType);
        if (stillThere) {
          results.push({
            index: i,
            success: false,
            status: 'failed',
            id: foundId,
            name: foundName,
            verified: false,
            error: 'Delete was not verified: ' + item.itemType + ' ' + foundId + ' still resolves after deleteObject.'
          });
          continue;
        }

        results.push({ index: i, success: true, status: 'ok', id: foundId, name: foundName, verified: true });
      } catch (e) {
        results.push({
          index: i,
          success: false,
          status: 'failed',
          id: item.id,
          name: item.name,
          error: (e && e.message) ? e.message : 'Unknown error removing item'
        });
      }
    }

    return JSON.stringify({ success: true, dryRun: dryRun, results: results });
`;

/**
 * Remove multiple items (tasks or projects) from OmniFocus.
 *
 * Runs as ONE OmniJS script with a per-item try/catch, so a 50-item batch is a
 * single OmniFocus round-trip and one bad item never aborts the rest. Lookup
 * uses the shared strict helper: an explicit ID that matches nothing is an
 * error (never a name fallback), and an ambiguous name is an error.
 *
 * With `dryRun`, every item is resolved exactly as it would be for a real
 * delete and reported as `wouldRemove` — nothing is deleted.
 */
export async function batchRemoveItems(items: BatchRemoveItemsParams[], options?: BatchRemoveItemsOptions): Promise<BatchResult> {
  if (!items || items.length === 0) {
    return { success: false, results: [], error: 'At least one item must be provided.' };
  }

  const dryRun = options?.dryRun === true;
  const prepared = prepareRemoveItems(items);

  try {
    const raw = await runOmniJs(
      BATCH_REMOVE_ITEMS_SCRIPT,
      { items: prepared, dryRun },
      dryRun ? { readOnly: true } : undefined
    );
    const results = coerceBatchResults(raw, items.length, 'batch_remove_items script returned no results');
    const success = results.some(r => r.success);
    return {
      success,
      results,
      error: success ? undefined : summarizeBatchErrors(results, dryRun ? 'planned' : 'removed'),
      dryRun,
      verified: dryRun ? undefined : allVerified(results)
    };
  } catch (error: any) {
    const message = error?.message || 'Unknown error in batchRemoveItems';
    const results = coerceBatchResults(null, items.length, message);
    return { success: false, results, error: summarizeBatchErrors(results, 'removed'), dryRun };
  }
}
