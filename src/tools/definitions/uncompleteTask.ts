import { z } from 'zod';
import { uncompleteTask } from '../primitives/uncompleteTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  task_id: z.string().describe("The ID of the completed task to mark incomplete. Idempotent: a task that is already incomplete succeeds and reports no change.")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await uncompleteTask(args.task_id);
    if (result.success) {
      const text = result.alreadyIncomplete
        ? `Task "${result.name}" was already incomplete (no change; status: ${result.status})`
        : `Marked task "${result.name}" as incomplete`;
      return {
        content: [{ type: "text" as const, text }]
      };
    } else {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true
      };
    }
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: [{ type: "text" as const, text: `Error uncompleting task: ${error.message}` }],
      isError: true
    };
  }
}
