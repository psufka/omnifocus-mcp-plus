import { recordToolData } from '../../utils/toolResult.js';
import { z } from 'zod';
import { addOmniFocusTask, AddOmniFocusTaskParams } from '../primitives/addOmniFocusTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { isoDateDescription, optionalIsoDate } from '../../utils/zodHelpers.js';
import { parseLocalDate } from '../../utils/localDate.js';

export const schema = z.object({
  name: z.string().describe("The name of the task"),
  note: z.string().optional().describe("Additional notes for the task"),
  dueDate: optionalIsoDate(isoDateDescription("The due date")),
  deferDate: optionalIsoDate(isoDateDescription("The defer date")),
  plannedDate: optionalIsoDate(isoDateDescription("The planned date")),
  flagged: z.boolean().optional().describe("Whether the task is flagged or not"),
  estimatedMinutes: z.number().optional().describe("Estimated time to complete the task, in minutes"),
  tags: z.array(z.string()).optional().describe("Tags to assign to the task"),
  tagIds: z.array(z.string().min(1)).optional().describe("Exact tag IDs; combine with names/paths in tags. Unknown IDs fail before any write."),
  projectName: z.string().optional().describe("The name of the project to add the task to (will add to inbox if not specified)"),
  parentTaskId: z.string().optional().describe("The ID of the parent task to create this task as a subtask"),
  parentTaskName: z.string().optional().describe("The name of the parent task to create this task as a subtask (alternative to parentTaskId)")
}).strict();

/** Test-only seam: production always uses the real primitive. */
export interface AddOmniFocusTaskDeps {
  addOmniFocusTask: typeof addOmniFocusTask;
}

export async function handler(
  args: z.infer<typeof schema>,
  extra: RequestHandlerExtra<any, any>,
  deps: AddOmniFocusTaskDeps = { addOmniFocusTask }
) {
  try {
    // Call the addOmniFocusTask function
    const result = await deps.addOmniFocusTask(args as AddOmniFocusTaskParams);
    recordToolData(result);

    if (result.success) {
      // Task was added successfully
      let locationText;
      if (args.parentTaskId || args.parentTaskName) {
        const parentRef = args.parentTaskId || args.parentTaskName;
        locationText = `as a subtask of "${parentRef}"`;
      } else if (args.projectName) {
        locationText = `in project "${args.projectName}"`;
      } else {
        locationText = "in your inbox";
      }

      let tagText = args.tags && args.tags.length > 0
        ? ` with tags: ${args.tags.join(', ')}`
        : "";

      // parseLocalDate so a bare YYYY-MM-DD reads back as that calendar day
      // (plain `new Date('2026-03-05')` is UTC midnight = the previous evening here).
      const due = args.dueDate ? parseLocalDate(args.dueDate) : null;
      let dueDateText = due ? ` due on ${due.toLocaleDateString()}` : "";

      const planned = args.plannedDate ? parseLocalDate(args.plannedDate) : null;
      let plannedDateText = planned ? ` planned for ${planned.toLocaleDateString()}` : "";

      // The task exists (the script fails outright if the read-back finds
      // nothing), but it may not be where it was asked to go — say so instead
      // of printing an unqualified success.
      const placementVerified = result.verified !== false;

      // The id is the whole point of the call for an agent: without it the
      // next step (tag it, move it, complete it) has to go hunting by name.
      const idText = result.taskId ? ` [id: ${result.taskId}]` : '';

      let text = placementVerified
        ? `✅ Task "${args.name}" created successfully ${locationText}${dueDateText}${plannedDateText}${tagText}.${idText}`
        : `⚠️ Task "${args.name}" was created${dueDateText}${plannedDateText}${tagText}, but NOT ${locationText}.${idText}`;

      // Placement mismatch: the read-back inside the creation script found the
      // task in a different container than the one requested. This is the check
      // that catches schema drift silently routing every task to the inbox.
      if (result.warning) {
        text += `\n\n⚠️ ${result.warning}`;
      }

      // Non-fatal problems (e.g. plannedDate unsupported by this OmniFocus
      // build) used to be swallowed by a silent catch in the script.
      if (result.warnings && result.warnings.length > 0) {
        text += `\n\n${result.warnings.map(w => `⚠️ ${w}`).join('\n')}`;
      }

      return {
        content: [{
          type: "text" as const,
          text
        }]
      };
    } else {
      // Task creation failed
      return {
        content: [{
          type: "text" as const,
          text: `Failed to create task: ${result.error}`
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
        text: `Error creating task: ${error.message}`
      }],
      isError: true
    };
  }
}
