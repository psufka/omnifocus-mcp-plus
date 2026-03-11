import { z } from 'zod';
import { batchMoveTasks } from '../primitives/batchMoveTasks.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  tasks: z.array(z.object({
    id: z.string().optional().describe("Task ID"),
    name: z.string().optional().describe("Task name (alternative to ID)")
  })).describe("Array of tasks to move"),
  targetProjectId: z.string().optional().describe("Destination project ID"),
  targetProjectName: z.string().optional().describe("Destination project name"),
  targetParentTaskId: z.string().optional().describe("Destination parent task ID"),
  targetParentTaskName: z.string().optional().describe("Destination parent task name"),
  targetInbox: z.boolean().optional().describe("Move tasks to inbox")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await batchMoveTasks(args);

    if (result.error && !result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
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
        output += `❌ ${r.name || r.id || 'unknown'}: ${r.error}\n`;
      }
    }

    return { content: [{ type: "text" as const, text: output }] };
  } catch (err: unknown) {
    return {
      content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
      isError: true
    };
  }
}
