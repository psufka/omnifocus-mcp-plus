import { z } from 'zod';
import { duplicateTask } from '../primitives/duplicateTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  taskId: z.string().optional().describe("The ID of the task to duplicate"),
  taskName: z.string().optional().describe("The name of the task to duplicate (alternative to taskId)"),
  newName: z.string().optional().describe("Name for the duplicate (defaults to source task name)"),
  newProjectId: z.string().optional().describe("Project ID to place the duplicate in"),
  newProjectName: z.string().optional().describe("Project name to place the duplicate in (must match exactly one project; ignored if newProjectId is given)"),
  includeTags: z.boolean().optional().describe("Copy tags from source (default: true). Set false to strip tags from the duplicate."),
  includeNote: z.boolean().optional().describe("Copy note from source (default: true). Set false to clear the duplicate's note.")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    if (!args.taskId && !args.taskName) {
      return {
        content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }],
        isError: true
      };
    }

    const result = await duplicateTask(args);

    if (result.success) {
      const carried: string[] = [];
      if (result.subtaskCount > 0) carried.push(`${result.subtaskCount} subtask${result.subtaskCount === 1 ? '' : 's'}`);
      if (result.hasRepetitionRule) carried.push('repetition rule');
      if (result.notificationCount > 0) carried.push(`${result.notificationCount} notification${result.notificationCount === 1 ? '' : 's'}`);
      const carriedText = carried.length > 0 ? ` (copied: ${carried.join(', ')})` : '';

      return {
        content: [{
          type: "text" as const,
          text: `Duplicated "${result.sourceName}" → "${result.name}" [${result.id}]${carriedText}`
        }]
      };
    }

    return {
      content: [{ type: "text" as const, text: `Error: ${result.error}` }],
      isError: true
    };
  } catch (err: unknown) {
    return {
      content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
      isError: true
    };
  }
}
