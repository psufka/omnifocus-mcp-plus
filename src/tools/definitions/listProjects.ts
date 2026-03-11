import { z } from 'zod';
import { listProjects } from '../primitives/listProjects.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  folder: z.string().optional().describe("Filter to projects within this folder name"),
  status: z.enum(['active', 'on_hold', 'completed', 'dropped']).optional().describe("Filter by project status"),
  completedBefore: z.string().optional().describe("ISO date - only projects completed before this date"),
  completedAfter: z.string().optional().describe("ISO date - only projects completed after this date"),
  stalledOnly: z.boolean().optional().describe("Only return stalled projects (active with tasks but no next action)"),
  sortBy: z.enum(['name', 'dueDate', 'completionDate', 'remainingTaskCount']).optional().describe("Sort field (default: name)"),
  sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order (default: asc)"),
  limit: z.number().min(1).max(500).optional().describe("Maximum number of projects to return (default: 100)")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await listProjects(args);
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
      content: [{ type: "text" as const, text: `Error listing projects: ${error.message}` }],
      isError: true
    };
  }
}
