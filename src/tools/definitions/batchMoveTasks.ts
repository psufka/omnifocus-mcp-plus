import { recordToolData } from '../../utils/toolResult.js';
import { z } from 'zod';
import { batchMoveTasks } from '../primitives/batchMoveTasks.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { BatchPlacement } from '../../utils/batchResults.js';

export const schema = z.object({
  tasks: z.array(z.object({
    id: z.string().optional().describe("Task ID"),
    name: z.string().optional().describe("Task name (alternative to ID)")
  }).strict()).describe("Array of tasks to move"),
  targetProjectId: z.string().optional().describe("Destination project ID"),
  targetProjectName: z.string().optional().describe("Destination project name"),
  targetParentTaskId: z.string().optional().describe("Destination parent task ID"),
  targetParentTaskName: z.string().optional().describe("Destination parent task name"),
  targetInbox: z.boolean().optional().describe("Move tasks to inbox"),
  dryRun: z.boolean().optional().describe("Resolve the destination and every task exactly as a real move would and report what WOULD move (including each task's current container), without moving anything. Default false.")
}).strict();

function describePlacement(placement?: BatchPlacement): string {
  if (!placement) return 'an unknown location';
  if (placement.kind === 'inbox') return 'inbox';
  if (placement.kind === 'library') return 'library top level';
  const label = placement.name ? `"${placement.name}"` : (placement.id ?? '(unnamed)');
  if (placement.kind === 'parentTask') return `parent task ${label}`;
  if (placement.kind === 'project') return `project ${label}`;
  if (placement.kind === 'folder') return `folder ${label}`;
  return `${placement.kind} ${label}`;
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await batchMoveTasks(args);
    recordToolData(result);

    // Validation / destination failures abort before any task is attempted, so
    // there is no per-item detail to show. Anything else renders per item, even
    // when every task failed.
    if (!result.success && result.results.length === 0) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error || 'no tasks were processed'}` }],
        isError: true
      };
    }

    const succeeded = result.results.filter(r => r.success).length;
    const failed = result.results.filter(r => !r.success).length;

    let output = result.dryRun ? `# Batch Move Results (dry run)\n\n` : `# Batch Move Results\n\n`;
    output += result.dryRun
      ? `🔍 Nothing was moved. ${succeeded}/${result.results.length} tasks would move`
      : `Moved ${succeeded}/${result.results.length} tasks`;
    if (failed > 0) output += ` (${failed} failed)`;
    if (!result.dryRun && succeeded > 0 && result.verified === false) {
      output += ` ⚠️ destination could not be verified for every task`;
    }
    output += '\n\n';

    for (const r of result.results) {
      const label = r.name || r.id || `task ${r.index}`;
      if (r.success && result.dryRun) {
        output += `➡️ ${label}: ${describePlacement(r.wouldMove?.from)} → ${describePlacement(r.wouldMove?.to)}\n`;
      } else if (r.success && r.verified === false) {
        output += `⚠️ ${label}: moved, but destination NOT verified — ${r.warning || 'unknown mismatch'}\n`;
      } else if (r.success) {
        output += `✅ ${label}\n`;
      } else {
        output += `❌ ${label}: ${r.error || 'unknown error'}\n`;
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
