import { recordToolData } from '../../utils/toolResult.js';
import { z } from 'zod';
import { editItem, EditItemParams } from '../primitives/editItem.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { optionalIsoDate } from '../../utils/zodHelpers.js';
import { formatMismatchLines } from '../../utils/mismatchText.js';

export const schema = z.object({
  id: z.string().optional().describe("The ID of the task or project to edit. An ID that matches nothing is an error — it never falls back to the name."),
  name: z.string().optional().describe("The name of the task or project to edit (used only when no ID is provided; errors on duplicate names)"),
  itemType: z.enum(['task', 'project']).describe("Type of item to edit ('task' or 'project')"),

  // Common editable fields
  newName: z.string().optional().describe("New name for the item"),
  newNote: z.string().optional().describe("New note for the item"),
  newDueDate: optionalIsoDate("Due date. Full ISO 8601 with timezone (e.g., 2026-03-05T09:00:00-06:00), or a bare YYYY-MM-DD which is interpreted as local midnight on that day. Set to empty string to clear.", { allowEmpty: true }),
  newDeferDate: optionalIsoDate("Defer date. Full ISO 8601 with timezone (e.g., 2026-03-05T09:00:00-06:00), or a bare YYYY-MM-DD which is interpreted as local midnight on that day. Set to empty string to clear.", { allowEmpty: true }),
  newPlannedDate: optionalIsoDate("Planned date. Full ISO 8601 with timezone (e.g., 2026-03-05T09:00:00-06:00), or a bare YYYY-MM-DD which is interpreted as local midnight on that day. Set to empty string to clear. Requires an OmniFocus build with planned dates; unsupported builds return a warning instead of failing.", { allowEmpty: true }),
  newFlagged: z.boolean().optional().describe("Set flagged status (set to false for no flag, true for flag)"),
  newEstimatedMinutes: z.number().optional().describe("New estimated minutes"),
  addTags: z.array(z.string()).optional().describe("Tags to add (works for tasks and projects). Tags that don't exist yet are created."),
  removeTags: z.array(z.string()).optional().describe("Tags to remove (works for tasks and projects)"),
  replaceTags: z.array(z.string()).optional().describe("Tags to replace all existing tags with (works for tasks and projects). Pass an empty array to clear every tag; omit the field to leave tags unchanged."),
  addTagIds: z.array(z.string().min(1)).optional().describe('Exact tag IDs to add; may be combined with addTags paths.'),
  removeTagIds: z.array(z.string().min(1)).optional().describe('Exact tag IDs to remove.'),
  replaceTagIds: z.array(z.string().min(1)).optional().describe('Exact tag IDs to replace all tags with; may be combined with replaceTags paths.'),
  dryRun: z.boolean().optional().describe('Resolve the complete edit and preview changes without writing.'),
  dropAllOccurrences: z.boolean().optional().describe("Only meaningful with newStatus: 'dropped' or newProjectStatus: 'dropped'. Defaults to false, which drops just the current occurrence of a repeating item; set true to drop every future occurrence as well."),

  // Task-specific fields (rejected with an error when itemType is 'project')
  newStatus: z.enum(['incomplete', 'completed', 'dropped']).optional().describe("For tasks: new status (incomplete, completed, dropped). For projects use newProjectStatus."),
  newProjectId: z.string().optional().describe("For tasks: move task to this project ID"),
  newProjectName: z.string().optional().describe("For tasks: move task to this project name (errors on duplicate names)"),
  newParentTaskId: z.string().optional().describe("For tasks: move task under this parent task ID"),
  newParentTaskName: z.string().optional().describe("For tasks: move task under this parent task name (errors on duplicate names)"),
  moveToInbox: z.boolean().optional().describe("For tasks: move task to inbox"),

  // Project-specific fields (rejected with an error when itemType is 'task')
  newSequential: z.boolean().optional().describe("For projects: whether the project should be sequential"),
  newFolderName: z.string().optional().describe("For projects: new folder to move the project to, by name. Accepts slash-separated paths (e.g. 'Someday/Maybe/Travel') when a bare name is ambiguous. Literal-name lookup wins first, so folder names containing '/' still work."),
  newFolderId: z.string().optional().describe("For projects: new folder to move the project to, by ID. Use list_folders to find IDs. Preferred when names are ambiguous and a path is awkward."),
  newProjectStatus: z.enum(['active', 'completed', 'dropped', 'onHold']).optional().describe("For projects: new status. For tasks use newStatus.")
}).strict();

/** Test-only seam: production always uses the real primitive. */
export interface EditItemDeps {
  editItem: typeof editItem;
}

export async function handler(
  args: z.infer<typeof schema>,
  extra: RequestHandlerExtra<any, any>,
  deps: EditItemDeps = { editItem }
) {
  try {
    // Validate that either id or name is provided
    if (!args.id && !args.name) {
      return {
        content: [{
          type: "text" as const,
          text: "Either id or name must be provided to edit an item."
        }],
        isError: true
      };
    }

    // Call the editItem function
    const result = await deps.editItem(args as EditItemParams);
    recordToolData(result);

    if (result.dryRun) return { content: [{ type: 'text' as const, text: `Would edit ${args.itemType} ${result.name} (${result.id}): ${JSON.stringify(result.changes)}` }], structuredContent: { success: true, tool: 'edit_item', data: result } };

    if (result.success) {
      // Item was edited successfully
      const itemTypeLabel = args.itemType === 'task' ? 'Task' : 'Project';
      let changedText = '';

      if (result.changedProperties) {
        changedText = ` (${result.changedProperties})`;
      }

      // Writes that were skipped rather than applied (e.g. plannedDate on an
      // OmniFocus build without planned-date support) must not be hidden behind
      // a plain success message.
      const warningText = result.warnings && result.warnings.length > 0
        ? `\n⚠️ ${result.warnings.join('\n⚠️ ')}`
        : '';

      // Post-write read-back: a field that did not land the way it was asked
      // for is reported as a failure, never as a clean success.
      if (result.verified === false) {
        // Dates arrive as epoch ms and are rendered LOCAL here — a raw
        // toISOString() would put a "…Z" timestamp in front of the caller.
        const mismatchText = formatMismatchLines(result.mismatches ?? []);
        return {
          content: [{
            type: "text" as const,
            text: `⚠️ ${itemTypeLabel} "${result.name}" was edited${changedText}, but read-back verification failed:\n${mismatchText}${warningText}`
          }],
          isError: true
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: `✅ ${itemTypeLabel} "${result.name}" updated successfully${changedText}.${warningText}`
        }]
      };
    } else {
      // Item editing failed
      let errorMsg = `Failed to update ${args.itemType}`;

      if (result.error) {
        // Lookup failures from the shared OmniJS helpers already name the field,
        // the value tried, and (for a stale ID) that the name was deliberately
        // NOT tried — so pass them through rather than re-guessing.
        if (/not found|Ambiguous/i.test(result.error)) {
          errorMsg = result.error;
        } else {
          errorMsg += `: ${result.error}`;
        }
      }

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
        text: `Error updating ${args.itemType}: ${error.message}`
      }],
      isError: true
    };
  }
}
