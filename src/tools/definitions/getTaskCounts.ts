import { z } from 'zod';
import { optionalIsoDate } from '../../utils/zodHelpers.js';
import { getTaskCounts } from '../primitives/getTaskCounts.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

// Returns: total, available, completed, overdue, dueSoon, flagged, deferred.
// `available` counts every actionable status (Available, Next, DueSoon,
// Overdue) — not just Task.Status.Available — and `dueSoon` comes from
// Task.Status.DueSoon, so it follows the user's OmniFocus "due soon" setting.
export const schema = z.object({
  project: z.string().optional().describe("Filter to tasks in this project (name match)"),
  tag: z.string().optional().describe("Filter to tasks with this tag (name match)"),
  flagged: z.boolean().optional().describe("Filter to flagged (true) or unflagged (false) tasks"),
  dueBefore: optionalIsoDate("Only count tasks due before this date. Bare YYYY-MM-DD is safe: it means local midnight that day"),
  dueAfter: optionalIsoDate("Only count tasks due after this date. Bare YYYY-MM-DD is safe: it means local midnight that day")
}).strict().describe(
  "Aggregate task counts. Returns total, available, completed, overdue, dueSoon, flagged, deferred. " +
  "available = every actionable status (Available, Next, DueSoon, Overdue), not just Task.Status.Available. " +
  "dueSoon = Task.Status.DueSoon, which follows the user's OmniFocus due-soon setting rather than a fixed window."
);

// Stated in the payload because the MCP tool description cannot carry
// output-field semantics.
const COUNT_SEMANTICS = "available = actionable statuses (Available, Next, DueSoon, Overdue); dueSoon uses OmniFocus's own due-soon setting, not a fixed 3-day window";

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await getTaskCounts(args);
    if (result.success) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ ...result, semantics: COUNT_SEMANTICS }, null, 2) }]
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
