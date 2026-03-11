import { runOmniJs } from '../../utils/scriptExecution.js';

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
    const collection = args.itemType === 'task' ? flattenedTasks : flattenedProjects;

    let item;
    if (args.id) {
      item = collection.filter(o => o.id.primaryKey === args.id)[0];
    }

    if (!item && args.name) {
      const matches = collection.filter(o => o.name === args.name);
      if (matches.length > 1) {
        return JSON.stringify({
          success: false,
          error: 'Ambiguous ' + args.itemType + ' name: ' + args.name + '. Multiple matches found; please use id.'
        });
      }
      item = matches[0];
    }

    if (!item) {
      return JSON.stringify({ success: false, error: 'Item not found' });
    }

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
