import { z } from 'zod';
import { completeTask } from '../primitives/completeTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  task_id: z.string().describe("Task ID. Already-completed tasks are unchanged; repeating tasks advance on every call. Do not blindly retry.")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await completeTask(args.task_id);
    if (result.success) {
      let text = result.alreadyCompleted
        ? `Task "${result.name}" was already completed (no change)`
        : `Marked task "${result.name}" as completed`;
      // The completed occurrence is a clone; the original remains active.
      if (result.nextOccurrenceId) {
        text += ` — repeating task: completed occurrence ${result.completedOccurrenceId}; next occurrence remains active (id ${result.nextOccurrenceId})`;
      }
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
      content: [{ type: "text" as const, text: `Error completing task: ${error.message}` }],
      isError: true
    };
  }
}
