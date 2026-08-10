import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

// Interface for item removal parameters
export interface RemoveItemParams {
  id?: string;          // ID of the task or project to remove
  name?: string;        // Name of the task or project to remove (as fallback if ID not provided)
  itemType: 'task' | 'project'; // Type of item to remove
}

/**
 * OmniJS source for remove_item.
 *
 * Module-level so the behavior harness can run the real script against a fake
 * object model — every user value arrives through the injected `args` object,
 * nothing is interpolated.
 */
export const REMOVE_ITEM_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  const collection = (args.itemType === 'task' ? flattenedTasks : flattenedProjects).filter(() => true);
  const label = args.itemType === 'task' ? 'Task' : 'Project';

  // A stale id must NEVER fall back to a name lookup — that deletes a
  // different, same-named item.
  const resolved = __resolveByIdOrName(collection, args.id, args.name, label);
  if (resolved.error) {
    return JSON.stringify({ success: false, error: resolved.error });
  }
  const item = resolved.item;

  const itemId = item.id.primaryKey;
  const itemName = item.name;

  deleteObject(item);

  // Verify in this same script (the single-script rule: a second round-trip
  // would race background sync): the id must no longer resolve. __findById
  // checks membership in the FRESHLY read collection, so a zombie object
  // still returned by byIdentifier counts as gone. A delete that did not take
  // is a failure, never a silent success.
  const afterCollection = args.itemType === 'task' ? flattenedTasks : flattenedProjects;
  const stillThere = __findById(afterCollection, itemId, label);
  if (stillThere) {
    return JSON.stringify({
      success: false,
      id: itemId,
      name: itemName,
      verified: false,
      error: 'Delete was not verified: ' + args.itemType + ' ' + itemId + ' still resolves after deleteObject.'
    });
  }

  return JSON.stringify({
    success: true,
    id: itemId,
    name: itemName,
    verified: true
  });
`;

/**
 * Remove a task or project from OmniFocus
 */
export async function removeItem(params: RemoveItemParams): Promise<{ success: boolean, id?: string, name?: string, verified?: boolean, error?: string }> {
  if (!params.id && !params.name) {
    return { success: false, error: "Either id or name must be provided" };
  }

  try {
    const result = await runOmniJs(REMOVE_ITEM_SCRIPT, params);
    return {
      success: result.success,
      id: result.id,
      name: result.name,
      verified: result.verified,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Unknown error in removeItem"
    };
  }
}
