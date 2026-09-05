import { recordToolData } from '../../utils/toolResult.js';
import { z } from 'zod';
import { batchRemoveItems, BatchRemoveItemsParams } from '../primitives/batchRemoveItems.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  items: z.array(z.object({
    id: z.string().optional().describe("The ID of the task or project to remove"),
    name: z.string().optional().describe("The name of the task or project to remove (used only when no ID is given; an ID that matches nothing is an error and never falls back to the name)"),
    itemType: z.enum(['task', 'project']).describe("Type of item to remove ('task' or 'project')")
  }).strict()).describe("Array of items (tasks or projects) to remove"),
  dryRun: z.boolean().optional().describe("Resolve every item exactly as a real removal would and report what WOULD be deleted, without deleting anything. Default false.")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    // Validate that each item has at least an ID or name
    for (const item of args.items) {
      if (!item.id && !item.name) {
        return {
          content: [{
            type: "text" as const,
            text: "Each item must have either id or name provided to remove it."
          }],
          isError: true
        };
      }
    }

    // Call the batchRemoveItems function
    const result = await batchRemoveItems(args.items as BatchRemoveItemsParams[], { dryRun: args.dryRun });
    recordToolData(result);

    // Nothing was attempted (e.g. empty items array) — no per-item detail exists.
    if (result.results.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `Failed to process batch removal: ${result.error || 'no items were processed'}`
        }],
        isError: true
      };
    }

    const successCount = result.results.filter(r => r.success).length;
    const failureCount = result.results.length - successCount;

    let message: string;
    if (result.dryRun) {
      message = `🔍 Dry run — nothing was deleted. ${successCount}/${result.results.length} items would be removed.`;
      if (failureCount > 0) message += ` ⚠️ ${failureCount} could not be resolved.`;
    } else {
      message = successCount > 0
        ? `✅ Successfully removed ${successCount} items.`
        : `❌ Failed to remove all ${result.results.length} items.`;

      if (successCount > 0 && failureCount > 0) {
        message += ` ⚠️ Failed to remove ${failureCount} items.`;
      }
    }

    // Per-item outcome, always — including when every item failed.
    const details = result.results.map((item, i) => {
      const source = args.items[item.index ?? i];
      const itemType = source?.itemType ?? 'item';
      const identifier = item.id || item.name || source?.id || source?.name || `item ${item.index ?? i}`;
      if (item.success && result.dryRun) {
        return `- 🗑️ would remove ${itemType}: "${item.wouldRemove?.name ?? item.name}" (id: ${item.wouldRemove?.id ?? item.id})`;
      }
      if (item.success) {
        return `- ✅ ${itemType}: "${item.name}"`;
      }
      return `- ❌ ${itemType}: ${identifier} - Error: ${item.error || 'unknown error'}`;
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
        text: `Error processing batch removal: ${error.message}`
      }],
      isError: true
    };
  }
}
