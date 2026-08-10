import { z } from 'zod';
import { completeTask } from '../primitives/completeTask.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  task_id: z.string().describe("The ID of the task to mark completed. Idempotent: completing an already-completed task succeeds and reports no change.")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await completeTask(args.task_id);
    if (result.success) {
      let text = result.alreadyCompleted
        ? `Task "${result.name}" was already completed (no change)`
        : `Marked task "${result.name}" as completed`;
      // A repeating task completes this occurrence and spawns the next one —
      // surface the new id so the caller does not think nothing happened.
      if (result.nextOccurrenceId) {
        text += ` — repeating task: next occurrence created (id ${result.nextOccurrenceId})`;
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
