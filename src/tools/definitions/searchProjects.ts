import { z } from 'zod';
import { searchProjects } from '../primitives/searchProjects.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  query: z.string().describe("Search query to match against project names"),
  limit: z.number().min(1).max(200).optional().describe("Maximum number of results (default: 50)")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await searchProjects(args);
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
      content: [{ type: "text" as const, text: `Error searching projects: ${error.message}` }],
      isError: true
    };
  }
}
