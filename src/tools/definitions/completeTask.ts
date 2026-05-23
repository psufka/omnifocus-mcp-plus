import { z } from 'zod';
import { completeTask } from '../primitives/completeTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  task_id: z.string().describe("The ID of the task to mark completed")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await completeTask(args.task_id);
    if (result.success) {
      return {
        content: [{ type: "text" as const, text: `Marked task "${result.name}" as completed` }]
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
      content: [{ type: "text" as const, text: `Error completing task: ${error.message}` }],
      isError: true
    };
  }
}
