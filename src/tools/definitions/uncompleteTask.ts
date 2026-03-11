import { z } from 'zod';
import { uncompleteTask } from '../primitives/uncompleteTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  task_id: z.string().describe("The ID of the completed task to mark incomplete")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await uncompleteTask(args.task_id);
    if (result.success) {
      return {
        content: [{ type: "text" as const, text: `Marked task "${result.name}" as incomplete` }]
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
