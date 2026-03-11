import { z } from 'zod';
import { getTaskCounts } from '../primitives/getTaskCounts.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  project: z.string().optional().describe("Filter to tasks in this project (name match)"),
  tag: z.string().optional().describe("Filter to tasks with this tag (name match)"),
  flagged: z.boolean().optional().describe("Filter to flagged (true) or unflagged (false) tasks"),
  dueBefore: z.string().optional().describe("ISO date - only count tasks due before this date"),
  dueAfter: z.string().optional().describe("ISO date - only count tasks due after this date")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await getTaskCounts(args);
    if (result.success) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
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
      content: [{ type: "text" as const, text: `Error getting task counts: ${error.message}` }],
      isError: true
    };
  }
}
