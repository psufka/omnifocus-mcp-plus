import { z } from 'zod';
import { addProject, AddProjectParams } from '../primitives/addProject.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { optionalIsoDate } from '../../utils/zodHelpers.js';
import { parseLocalDate } from '../../utils/localDate.js';

export const schema = z.object({
  name: z.string().describe("The name of the project"),
  note: z.string().optional().describe("Additional notes for the project"),
  dueDate: optionalIsoDate("Due date, ISO 8601 (e.g., 2026-03-05T09:00:00-06:00). A bare YYYY-MM-DD is treated as local midnight on that calendar day."),
  deferDate: optionalIsoDate("Defer date, ISO 8601 (e.g., 2026-03-05T09:00:00-06:00). A bare YYYY-MM-DD is treated as local midnight on that calendar day."),
  plannedDate: optionalIsoDate("Planned date, ISO 8601 (e.g., 2026-03-05T09:00:00-06:00). A bare YYYY-MM-DD is treated as local midnight on that calendar day."),
  flagged: z.boolean().optional().describe("Whether the project is flagged or not"),
  estimatedMinutes: z.number().optional().describe("Estimated time to complete the project, in minutes"),
  tags: z.array(z.string()).optional().describe("Tags to assign to the project"),
  folderName: z.string().optional().describe("Name or ID of the folder to add the project to (adds at root if omitted). A name matching more than one folder is rejected — pass the folder ID instead."),
  sequential: z.boolean().optional().describe("Whether tasks in the project should be sequential (default: false)")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    // Call the addProject function
    const result = await addProject(args as AddProjectParams);

    if (result.success) {
      // Project was added successfully
      let locationText = args.folderName
        ? `in folder "${args.folderName}"`
        : "at the root level";

      let tagText = args.tags && args.tags.length > 0
        ? ` with tags: ${args.tags.join(', ')}`
        : "";

      let dueDateText = args.dueDate
        ? ` due on ${parseLocalDate(args.dueDate)?.toLocaleDateString() ?? args.dueDate}`
        : "";

      let plannedDateText = args.plannedDate
        ? ` planned for ${parseLocalDate(args.plannedDate)?.toLocaleDateString() ?? args.plannedDate}`
        : "";

      let sequentialText = args.sequential
        ? " (sequential)"
        : " (parallel)";

      // Fields that failed to write (e.g. plannedDate on an older OmniFocus)
      // must be reported, not swallowed.
      let warningText = result.warnings && result.warnings.length > 0
        ? `\n⚠️ ${result.warnings.join('\n⚠️ ')}`
        : "";

      return {
        content: [{
          type: "text" as const,
          text: `✅ Project "${args.name}" created successfully ${locationText}${dueDateText}${plannedDateText}${tagText}${sequentialText}.${warningText}`
        }]
      };
    } else {
      // Project creation failed
      return {
        content: [{
          type: "text" as const,
          text: `Failed to create project: ${result.error}`
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
        text: `Error creating project: ${error.message}`
      }],
      isError: true
    };
  }
}
