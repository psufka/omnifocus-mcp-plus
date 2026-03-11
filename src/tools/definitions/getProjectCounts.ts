import { z } from 'zod';
import { getProjectCounts } from '../primitives/getProjectCounts.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  folder: z.string().optional().describe("Optional folder name to scope counts to")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await getProjectCounts(args);
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
      content: [{ type: "text" as const, text: `Error getting project counts: ${error.message}` }],
      isError: true
    };
  }
}
