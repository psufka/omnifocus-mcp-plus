import { z } from 'zod';
import { optionalIsoDate, isoDateDescription } from '../../utils/zodHelpers.js';
import { listProjects } from '../primitives/listProjects.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  folder: z.string().optional().describe("Filter to projects within this folder name"),
  status: z.enum(['active', 'on_hold', 'completed', 'dropped']).optional().describe("Filter by project status"),
  completedBefore: optionalIsoDate(isoDateDescription("Only projects completed before this date")),
  completedAfter: optionalIsoDate(isoDateDescription("Only projects completed after this date")),
  stalledOnly: z.boolean().optional().describe("Only return stalled projects (active with tasks but no next action)"),
  sortBy: z.enum(['name', 'dueDate', 'completionDate', 'remainingTaskCount']).optional().describe("Sort field (default: name)"),
  sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order (default: asc)"),
  limit: z.number().min(1).max(500).optional().describe("Maximum number of projects to return (default: 100)")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await listProjects(args);
    if (result.success) {
      // Re-render date fields local before they reach the caller — the
      // primitive carries raw UTC ISO strings, which read as the wrong
      // calendar day in any timezone behind UTC.
      const localized = {
        ...result,
        projects: (result.projects ?? []).map((p: any) => ({
          ...p,
          ...(p.dueDate ? { dueDate: new Date(p.dueDate).toLocaleString() } : {}),
          ...(p.completionDate ? { completionDate: new Date(p.completionDate).toLocaleString() } : {}),
        })),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(localized, null, 2) }]
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
