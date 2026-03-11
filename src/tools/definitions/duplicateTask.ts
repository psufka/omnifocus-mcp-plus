import { z } from 'zod';
import { duplicateTask } from '../primitives/duplicateTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  taskId: z.string().optional().describe("The ID of the task to duplicate"),
  taskName: z.string().optional().describe("The name of the task to duplicate (alternative to taskId)"),
  newName: z.string().optional().describe("Name for the duplicate (defaults to source task name)"),
  newProjectId: z.string().optional().describe("Project ID to place the duplicate in"),
  newProjectName: z.string().optional().describe("Project name to place the duplicate in"),
  includeTags: z.boolean().optional().describe("Copy tags from source (default: true)"),
  includeNote: z.boolean().optional().describe("Copy note from source (default: true)")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    if (!args.taskId && !args.taskName) {
      return {
        content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }],
        isError: true
      };
    }

    const result = await duplicateTask(args);

    if (result.success) {
      return {
        content: [{
          type: "text" as const,
          text: `Duplicated "${result.sourceName}" → "${result.name}" [${result.id}]`
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
