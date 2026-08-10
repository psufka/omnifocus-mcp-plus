import { z } from 'zod';
import { batchAddItems, BatchAddItemsParams } from '../primitives/batchAddItems.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { isoDateDescription, optionalIsoDate } from '../../utils/zodHelpers.js';
import type { BatchItemResult, BatchPlacement } from '../../utils/batchResults.js';

/**
 * The item spec as a plain strict object, exported so the schema-parity test can
 * read its `.shape` (the exported `schema` wraps it in refine/transform effects,
 * which hide the shape). Every field add_omnifocus_task accepts must exist here
 * with the same base type — see definitions/schemaParity.test.ts.
 */
export const batchAddItemObjectSchema = z.object({
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
  sequential: z.boolean().optional().describe("For projects: Whether tasks in the project should be sequential"),

  // Hierarchy within one batch
  tempId: z.string().optional().describe("Optional handle for this item, unique within the batch. A later item can set parentTempId to this value to be created inside it. Returned in the result's `mapping` as tempId -> real OmniFocus id."),
  parentTempId: z.string().optional().describe("Create this task inside an item created EARLIER in this same batch (matching that item's tempId). Must reference a previous index — forward and self references are rejected. Cannot be combined with parentTaskId, parentTaskName or projectName.")
}).strict();

const batchAddItemSchema = batchAddItemObjectSchema
  .refine(
    d => d.itemType !== undefined || d.type !== undefined,
    { message: "items[].itemType is required (legacy alias 'type' also accepted)" }
  )
  .transform(d => {
    const resolved = d.itemType ?? d.type!;
    return { ...d, itemType: resolved, type: resolved };
  });

export const schema = z.object({
  items: z.array(batchAddItemSchema).describe("Array of items (tasks or projects) to add"),
  dryRun: z.boolean().optional().describe("Resolve every project/folder/parent/tag lookup and report exactly what WOULD be created, without writing anything. Default false."),
  stopOnError: z.boolean().optional().describe("Stop at the first failed item instead of continuing; the remaining items are reported as skipped. Default false (continue on error). Implied by atomic."),
  atomic: z.boolean().optional().describe("All-or-nothing: if ANY item fails, every object already created by this batch is deleted again in the same script and the result reports rolledBack: true. Implies stopOnError; passing atomic: true with stopOnError: false is rejected.")
})
  .strict()
  .superRefine((data, ctx) => {
    // atomic without stop-on-error would roll back work the caller was never
    // told had failed.
    if (data.atomic === true && data.stopOnError === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['atomic'],
        message: 'atomic: true implies stop-on-error. Remove stopOnError: false (or set it to true).'
      });
    }

    // First pass: tempIds must be unique within the batch.
    const tempIdIndex = new Map<string, number>();
    data.items.forEach((item, i) => {
      const tempId = (item as { tempId?: string }).tempId;
      if (tempId === undefined) return;
      const seenAt = tempIdIndex.get(tempId);
      if (seenAt !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', i, 'tempId'],
          message: `Duplicate tempId "${tempId}" (already used by items[${seenAt}]). tempIds must be unique within a batch.`
        });
        return;
      }
      tempIdIndex.set(tempId, i);
    });

    // Second pass: parentTempId must point at an EARLIER item.
    data.items.forEach((item, i) => {
      const spec = item as { parentTempId?: string; itemType?: string; type?: string; parentTaskId?: string; parentTaskName?: string; projectName?: string };
      const parentTempId = spec.parentTempId;
      if (parentTempId === undefined) return;

      const target = tempIdIndex.get(parentTempId);
      if (target === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', i, 'parentTempId'],
          message: `parentTempId "${parentTempId}" does not match any tempId in this batch.`
        });
      } else if (target >= i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', i, 'parentTempId'],
          message: `parentTempId "${parentTempId}" must reference an EARLIER item; it points at items[${target}]${target === i ? ' (itself)' : ' (later in the batch)'}. Order parents before children.`
        });
      }

      if ((spec.itemType ?? spec.type) === 'project') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', i, 'parentTempId'],
          message: 'parentTempId is only valid on task items; projects cannot be nested inside another batch item.'
        });
      }

      if (spec.parentTaskId || spec.parentTaskName || spec.projectName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', i, 'parentTempId'],
          message: 'Cannot combine parentTempId with parentTaskId, parentTaskName or projectName — the parent is already determined by parentTempId.'
        });
      }
    });
  });

function describePlacement(placement?: BatchPlacement): string {
  if (!placement) return 'an unknown location';
  if (placement.kind === 'inbox') return 'the inbox';
  if (placement.kind === 'library') return 'the library top level';
  const label = placement.name
    ? `"${placement.name}"`
    : (placement.tempId ? `tempId "${placement.tempId}"` : (placement.id ?? '(unnamed)'));
  if (placement.kind === 'parentTask') return `parent task ${label}`;
  if (placement.kind === 'project') return `project ${label}`;
  if (placement.kind === 'folder') return `folder ${label}`;
  return `${placement.kind} ${label}`;
}

function renderDryRun(result: Awaited<ReturnType<typeof batchAddItems>>, args: z.infer<typeof schema>): string {
  const planned = result.results.filter(r => r.status === 'planned').length;
  const blocked = result.results.length - planned;

  let message = `🔍 Dry run — nothing was written. ${planned}/${result.results.length} items would be created.`;
  if (blocked > 0) message += ` ⚠️ ${blocked} could not be resolved.`;

  const details = result.results.map((item, i) => {
    const source = args.items[item.index ?? i] as any;
    const itemType = item.wouldCreate?.itemType ?? source?.itemType ?? source?.type ?? 'item';
    const itemName = item.name || source?.name || `item ${item.index ?? i}`;
    if (!item.success) {
      return `- ❌ ${itemType}: "${itemName}" - Error: ${item.error || 'unknown error'}`;
    }
    const lines = [`- 📝 would create ${itemType}: "${itemName}" in ${describePlacement(item.wouldCreate?.destination)}`];
    if (item.tempId) lines.push(`  - tempId: ${item.tempId}`);
    const newTags = item.wouldCreate?.tagsToCreate ?? [];
    if (newTags.length > 0) lines.push(`  - would also create ${newTags.length} new tag(s): ${newTags.join(', ')}`);
    return lines.join('\n');
  }).join('\n');

  return `${message}\n\n${details}`;
}

function renderItem(item: BatchItemResult, index: number, args: z.infer<typeof schema>): string {
  const source = args.items[item.index ?? index] as any;
  const itemType = source?.itemType ?? source?.type ?? 'item';
  const itemName = item.name || source?.name || `item ${item.index ?? index}`;

  const lines: string[] = [];
  if (item.status === 'skipped') {
    lines.push(`- ⏭️ ${itemType}: "${itemName}" - ${item.error || 'skipped'}`);
  } else if (item.status === 'rolledBack') {
    lines.push(`- ↩️ ${itemType}: "${itemName}" - ${item.error || 'rolled back'}`);
  } else if (item.success && item.verified === false) {
    lines.push(`- ⚠️ ${itemType}: "${itemName}" - created, but placement NOT verified`);
  } else if (item.success) {
    lines.push(`- ✅ ${itemType}: "${itemName}"`);
  } else {
    lines.push(`- ❌ ${itemType}: "${itemName}" - Error: ${item.error || 'unknown error'}`);
  }

  if (item.warning) lines.push(`  - ⚠️ ${item.warning}`);
  if (item.warnings) {
    for (const warning of item.warnings) lines.push(`  - ⚠️ ${warning}`);
  }
  return lines.join('\n');
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    // Call the batchAddItems function
    const result = await batchAddItems(args.items as BatchAddItemsParams[], {
      dryRun: args.dryRun,
      stopOnError: args.stopOnError,
      atomic: args.atomic
    });

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

    if (result.dryRun) {
      return {
        content: [{ type: "text" as const, text: renderDryRun(result, args) }],
        ...(result.results.every(r => !r.success) ? { isError: true } : {})
      };
    }

    const successCount = result.results.filter(r => r.success).length;
    const failureCount = result.results.length - successCount;

    let message: string;
    if (result.rolledBack) {
      message = `↩️ Rolled back — atomic batch failed, so all ${result.results.length} items were reverted. Nothing remains in OmniFocus from this call.`;
    } else if (successCount > 0) {
      message = `✅ Successfully added ${successCount} items.`;
      if (failureCount > 0) message += ` ⚠️ Failed to add ${failureCount} items.`;
    } else {
      message = `❌ Failed to add all ${result.results.length} items.`;
    }

    if (!result.rolledBack && successCount > 0 && result.verified === false) {
      message += ` ⚠️ Placement could not be verified for every item — see the warnings below.`;
    }

    // Per-item outcome, always — including when every item failed.
    const details = result.results.map((item, i) => renderItem(item, i, args)).join('\n');

    const extras: string[] = [];
    const mappingEntries = Object.entries(result.mapping ?? {});
    if (mappingEntries.length > 0) {
      extras.push(`**tempId → id**\n${mappingEntries.map(([tempId, id]) => `- ${tempId} → ${id}`).join('\n')}`);
    }
    if (result.rollbackErrors && result.rollbackErrors.length > 0) {
      extras.push(`**⚠️ Rollback could not delete:**\n${result.rollbackErrors.map(e => `- ${e}`).join('\n')}`);
    }

    const sections = [message, details, ...extras].filter(Boolean);

    return {
      content: [{
        type: "text" as const,
        text: sections.join('\n\n')
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
