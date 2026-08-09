import { z } from 'zod';
import { batchAddItems, BatchAddItemsParams } from '../primitives/batchAddItems.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { isoDateDescription, optionalIsoDate } from '../../utils/zodHelpers.js';

const batchAddItemSchema = z.object({
  itemType: z.enum(['task', 'project']).optional().describe("Type of item to add ('task' or 'project'). Canonical field; legacy alias 'type' also accepted."),
  type: z.enum(['task', 'project']).optional().describe("[DEPRECATED] Alias for itemType. Prefer itemType."),
  name: z.string().describe("The name of the item"),
  note: z.string().optional().describe("Additional notes for the item"),
  dueDate: optionalIsoDate(isoDateDescription("The due date")),
  deferDate: optionalIsoDate(isoDateDescription("The defer date")),
  plannedDate: optionalIsoDate(isoDateDescription("The planned date")),
  flagged: z.boolean().optional().describe("Whether the item is flagged or not"),
  estimatedMinutes: z.number().optional().describe("Estimated time to complete the item, in minutes"),
  tags: z.array(z.string()).optional().describe("Tags to assign to the item"),

  // Task-specific properties
  projectName: z.string().optional().describe("For tasks: The name of the project to add the task to"),
  parentTaskId: z.string().optional().describe("For tasks: The ID of the parent task to create this task as a subtask"),
  parentTaskName: z.string().optional().describe("For tasks: The name of the parent task to create this task as a subtask"),

  // Project-specific properties
  folderName: z.string().optional().describe("For projects: The name of the folder to add the project to"),
  sequential: z.boolean().optional().describe("For projects: Whether tasks in the project should be sequential")
})
  .strict()
  .refine(
    d => d.itemType !== undefined || d.type !== undefined,
    { message: "items[].itemType is required (legacy alias 'type' also accepted)" }
  )
  .transform(d => {
    const resolved = d.itemType ?? d.type!;
    return { ...d, itemType: resolved, type: resolved };
  });

export const schema = z.object({
  items: z.array(batchAddItemSchema).describe("Array of items (tasks or projects) to add")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    // Call the batchAddItems function
    const result = await batchAddItems(args.items as BatchAddItemsParams[]);

    // Nothing was attempted (e.g. empty items array) — there is no per-item
    // detail to show, so report the batch-level error on its own.
    if (result.results.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `Failed to process batch operation: ${result.error || 'no items were processed'}`
        }],
        isError: true
      };
    }

    const successCount = result.results.filter(r => r.success).length;
    const failureCount = result.results.length - successCount;

    let message = successCount > 0
      ? `✅ Successfully added ${successCount} items.`
      : `❌ Failed to add all ${result.results.length} items.`;

    if (successCount > 0 && failureCount > 0) {
      message += ` ⚠️ Failed to add ${failureCount} items.`;
    }

    // Per-item outcome, always — including when every item failed.
    const details = result.results.map((item, i) => {
      const source = args.items[item.index ?? i] as any;
      const itemType = source?.itemType ?? source?.type ?? 'item';
      const itemName = item.name || source?.name || `item ${item.index ?? i}`;
      const lines = item.success
        ? [`- ✅ ${itemType}: "${itemName}"`]
        : [`- ❌ ${itemType}: "${itemName}" - Error: ${item.error || 'unknown error'}`];
      if (item.warnings) {
        for (const warning of item.warnings) lines.push(`  - ⚠️ ${warning}`);
      }
      return lines.join('\n');
    }).join('\n');

    return {
      content: [{
        type: "text" as const,
        text: `${message}\n\n${details}`
      }],
      ...(successCount === 0 ? { isError: true } : {})
    };
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`Tool execution error: ${error.message}`);
    return {
      content: [{
        type: "text" as const,
        text: `Error processing batch operation: ${error.message}`
      }],
      isError: true
    };
  }
}
