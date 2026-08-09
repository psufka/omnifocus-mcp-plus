import { z } from 'zod';
import { batchMoveTasks } from '../primitives/batchMoveTasks.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  tasks: z.array(z.object({
    id: z.string().optional().describe("Task ID"),
    name: z.string().optional().describe("Task name (alternative to ID)")
  }).strict()).describe("Array of tasks to move"),
  targetProjectId: z.string().optional().describe("Destination project ID"),
  targetProjectName: z.string().optional().describe("Destination project name"),
  targetParentTaskId: z.string().optional().describe("Destination parent task ID"),
  targetParentTaskName: z.string().optional().describe("Destination parent task name"),
  targetInbox: z.boolean().optional().describe("Move tasks to inbox")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await batchMoveTasks(args);

    // Validation / destination failures abort before any task is attempted, so
    // there is no per-item detail to show. Anything else renders per item, even
    // when every task failed.
    if (!result.success && result.results.length === 0) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error || 'no tasks were processed'}` }],
        isError: true
      };
    }

    let output = `# Batch Move Results\n\n`;
    const succeeded = result.results.filter(r => r.success).length;
    const failed = result.results.filter(r => !r.success).length;
    output += `Moved ${succeeded}/${result.results.length} tasks`;
    if (failed > 0) output += ` (${failed} failed)`;
    output += '\n\n';

    for (const r of result.results) {
      if (r.success) {
        output += `✅ ${r.name || r.id}\n`;
      } else {
        output += `❌ ${r.name || r.id || `task ${r.index}`}: ${r.error || 'unknown error'}\n`;
      }
    }

    return {
      content: [{ type: "text" as const, text: output }],
      ...(succeeded === 0 ? { isError: true } : {})
    };
  } catch (err: unknown) {
    return {
      content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
      isError: true
    };
  }
}
