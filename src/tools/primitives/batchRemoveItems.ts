import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { BatchItemResult, coerceBatchResults, summarizeBatchErrors } from '../../utils/batchResults.js';

// Define the parameters for the batch removal operation
// (same shape as remove_item's params, declared here so the batch tool does not
// depend on the single-item primitive's internals)
export type BatchRemoveItemsParams = {
  id?: string;          // ID of the task or project to remove
  name?: string;        // Name of the task or project to remove (only when no id is given)
  itemType: 'task' | 'project';
};

// Define the result type for individual operations
export type ItemResult = BatchItemResult;

// Define the result type for the batch operation
type BatchResult = {
  success: boolean;
  results: ItemResult[];
  error?: string;
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
// injected `args.items` array.
export const BATCH_REMOVE_ITEMS_SCRIPT = `
    ${OMNIJS_LOOKUP_HELPERS}

    const results = [];

    for (let i = 0; i < args.items.length; i++) {
      const item = args.items[i];
      try {
        if (item.preflightError) {
          results.push({ index: i, success: false, id: item.id, name: item.name, error: item.preflightError });
          continue;
        }

        // Re-read the collection each iteration: earlier deletions must not
        // leave a stale object behind for a later lookup to match.
        const collection = item.itemType === 'task' ? flattenedTasks : flattenedProjects;
        const lookup = __resolveByIdOrName(collection, item.id, item.name, item.itemType);
        if (lookup.error) {
          results.push({ index: i, success: false, id: item.id, name: item.name, error: lookup.error });
          continue;
        }

        const found = lookup.item;
        const foundId = found.id.primaryKey;
        const foundName = found.name;
        deleteObject(found);

        results.push({ index: i, success: true, id: foundId, name: foundName });
      } catch (e) {
        results.push({
          index: i,
          success: false,
          id: item.id,
          name: item.name,
          error: (e && e.message) ? e.message : 'Unknown error removing item'
        });
      }
    }

    return JSON.stringify({ success: true, results: results });
`;

/**
 * Remove multiple items (tasks or projects) from OmniFocus.
 *
 * Runs as ONE OmniJS script with a per-item try/catch, so a 50-item batch is a
 * single OmniFocus round-trip and one bad item never aborts the rest. Lookup
 * uses the shared strict helper: an explicit ID that matches nothing is an
 * error (never a name fallback), and an ambiguous name is an error.
 */
export async function batchRemoveItems(items: BatchRemoveItemsParams[]): Promise<BatchResult> {
  if (!items || items.length === 0) {
    return { success: false, results: [], error: 'At least one item must be provided.' };
  }

  const prepared = prepareRemoveItems(items);

  try {
    const raw = await runOmniJs(BATCH_REMOVE_ITEMS_SCRIPT, { items: prepared });
    const results = coerceBatchResults(raw, items.length, 'batch_remove_items script returned no results');
    const success = results.some(r => r.success);
    return {
      success,
      results,
      error: success ? undefined : summarizeBatchErrors(results, 'removed')
    };
  } catch (error: any) {
    const message = error?.message || 'Unknown error in batchRemoveItems';
    const results = coerceBatchResults(null, items.length, message);
    return { success: false, results, error: summarizeBatchErrors(results, 'removed') };
  }
}
