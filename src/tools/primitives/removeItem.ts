import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

// Interface for item removal parameters
export interface RemoveItemParams {
  id?: string;          // ID of the task or project to remove
  name?: string;        // Name of the task or project to remove (as fallback if ID not provided)
  itemType: 'task' | 'project'; // Type of item to remove
}

/**
 * Remove a task or project from OmniFocus
 */
export async function removeItem(params: RemoveItemParams): Promise<{ success: boolean, id?: string, name?: string, error?: string }> {
  if (!params.id && !params.name) {
    return { success: false, error: "Either id or name must be provided" };
  }

  const script = `
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

    return JSON.stringify({
      success: true,
      id: itemId,
      name: itemName
    });
  `;

  try {
    const result = await runOmniJs(script, params);
    return {
      success: result.success,
      id: result.id,
      name: result.name,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Unknown error in removeItem"
    };
  }
}
