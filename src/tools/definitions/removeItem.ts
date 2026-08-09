import { z } from 'zod';
import { removeItem, RemoveItemParams } from '../primitives/removeItem.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  id: z.string().optional().describe("The ID of the task or project to remove. If provided and it matches nothing, the removal fails — it does NOT fall back to the name."),
  name: z.string().optional().describe("The name of the task or project to remove (used only when no ID is given). Must match exactly one item; ambiguous names are rejected."),
  itemType: z.enum(['task', 'project']).describe("Type of item to remove ('task' or 'project')")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    // Validate that either id or name is provided
    if (!args.id && !args.name) {
      return {
        content: [{
          type: "text" as const,
          text: "Either id or name must be provided to remove an item."
        }],
        isError: true
      };
    }
    
    // Validate itemType
    if (!['task', 'project'].includes(args.itemType)) {
      return {
        content: [{
          type: "text" as const,
          text: `Invalid item type: ${args.itemType}. Must be either 'task' or 'project'.`
        }],
        isError: true
      };
    }
    
    // Log the remove operation for debugging
    console.error(`Removing ${args.itemType} with ID: ${args.id || 'not provided'}, Name: ${args.name || 'not provided'}`);
    
    // Call the removeItem function 
    const result = await removeItem(args as RemoveItemParams);
    
    if (result.success) {
      // Item was removed successfully
      const itemTypeLabel = args.itemType === 'task' ? 'Task' : 'Project';
      
      return {
        content: [{
          type: "text" as const,
          text: `✅ ${itemTypeLabel} "${result.name}" removed successfully.`
        }]
      };
    } else {
      // Item removal failed. The primitive's lookup errors are already precise
      // (stale ID, ambiguous name, not found), so pass them straight through.
      const errorMsg = result.error
        ? `Failed to remove ${args.itemType}: ${result.error}`
        : `Failed to remove ${args.itemType}`;

      return {
        content: [{
          type: "text" as const,
          text: errorMsg
        }],
        isError: true
      };
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`Tool execution error: ${error.message}`);
    
    return {
      content: [{
        type: "text" as const,
        text: `Error removing ${args.itemType}: ${error.message}`
      }],
      isError: true
    };
  }
} 