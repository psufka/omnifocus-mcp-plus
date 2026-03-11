import { z } from 'zod';
import { reorderTask } from '../primitives/reorderTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  taskId: z.string().optional().describe("The ID of the task to reorder"),
  taskName: z.string().optional().describe("The name of the task to reorder (alternative to taskId)"),
  beforeTaskId: z.string().optional().describe("Place task before this sibling task ID"),
  afterTaskId: z.string().optional().describe("Place task after this sibling task ID"),
  position: z.enum(["beginning", "ending"]).optional().describe("Move task to beginning or ending of its container")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    if (!args.taskId && !args.taskName) {
      return { content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }], isError: true };
    }

    const result = await reorderTask(args);

    if (result.success) {
      let desc = '';
      if (args.beforeTaskId) desc = `before task ${args.beforeTaskId}`;
      else if (args.afterTaskId) desc = `after task ${args.afterTaskId}`;
      else desc = `to ${args.position}`;
      return { content: [{ type: "text" as const, text: `Reordered "${result.name}" ${desc}` }] };
    }

    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}
