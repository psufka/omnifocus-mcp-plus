import { recordToolData } from '../../utils/toolResult.js';
import { z } from 'zod';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { findSimilarTasks } from '../primitives/findSimilarTasks.js';
import type { Scored } from '../../utils/similarity.js';
import type { SimilarTaskCandidate } from '../primitives/findSimilarTasks.js';

export const schema = z.object({
  name: z.string().min(1).describe("The task name you are about to create. Existing tasks are ranked by how closely their names match this."),
  includeCompleted: z.boolean().default(false).describe("Also search completed and dropped tasks. Default false — a finished task is rarely the one you want to reuse, but this is useful for checking whether something was already done."),
  limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of matches to return (1-20). Default 5."),
  minScore: z.number().min(0).max(1).default(0.35).describe("Minimum similarity score (0-1) a task must reach to be listed. Default 0.35. Raise it (e.g. 0.6) for near-exact matches only; lower it to cast a wider net.")
}).strict();

/** Scores are internal 0-1 floats; the caller sees a percentage. */
function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function describeMatch(match: Scored<SimilarTaskCandidate>, rank: number): string {
  const location = match.projectName ? ` — ${match.projectName}` : '';
  return `${rank}. **${match.name}** (${formatScore(match.score)} match)${location} · ${match.status} · id: ${match.id}`;
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await findSimilarTasks(args);
    recordToolData(result);

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true
      };
    }

    const matches = result.matches ?? [];
    const scope = result.includeCompleted ? 'all tasks' : 'incomplete tasks';

    if (matches.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `🔍 **No similar tasks found for "${result.query}"**\n\n` +
            `Scanned ${result.candidatesScanned} ${scope}; nothing scored at or above ${formatScore(result.minScore ?? 0.35)}.\n\n` +
            `Nothing to reuse — creating this task is safe.`
        }]
      };
    }

    const lines = matches.map((match, index) => describeMatch(match, index + 1));
    const best = matches[0];
    const strong = best.score >= 0.7;

    const closing = strong
      ? `⚠️ **"${best.name}" is a ${formatScore(best.score)} match.** Reuse its id (\`${best.id}\`) with edit_item / append_to_note / add a subtask instead of creating a duplicate. Only create a new task if you have confirmed this is genuinely different work.`
      : `These are partial matches. If one of them is the same work, reuse its id instead of creating a duplicate; otherwise go ahead and create the new task.`;

    return {
      content: [{
        type: "text" as const,
        text: `🔍 **${matches.length} task${matches.length === 1 ? '' : 's'} similar to "${result.query}"** ` +
          `(scanned ${result.candidatesScanned} ${scope}, threshold ${formatScore(result.minScore ?? 0.35)})\n\n` +
          `${lines.join('\n')}\n\n${closing}`
      }]
    };
  } catch (err: unknown) {
    return {
      content: [{ type: "text" as const, text: `Error finding similar tasks: ${(err as Error).message}` }],
      isError: true
    };
  }
}
