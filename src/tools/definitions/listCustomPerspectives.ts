import { z } from 'zod';
import { listCustomPerspectives } from '../primitives/listCustomPerspectives.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  format: z.enum(['simple', 'detailed']).optional().describe("Output format: simple (names only) or detailed (with identifiers) - default: simple"),
  includeRules: z.boolean().optional().describe("Also return each perspective's archived filter rules (raw JSON) and its top-level filter aggregation ('all' | 'any' | none). Use this to inspect a perspective's definition before editing it with update_perspective_rules. Implies detailed output. Default: false")
}).strict();

/** Test-only seam: production always uses the real primitive. */
export interface ListCustomPerspectivesDeps {
  listCustomPerspectives: typeof listCustomPerspectives;
}

/**
 * The primitive swallows its own failures and returns them as a plain
 * "Error: ..." STRING rather than throwing. This tool is registered
 * `cacheable`, and registerStrictTool caches any result that is not flagged
 * isError — so an unflagged failure string got served from cache for the next
 * 30 seconds, long after OmniFocus recovered.
 */
function isPrimitiveError(text: string): boolean {
  return text.trimStart().startsWith('Error');
}

export async function handler(
  args: z.infer<typeof schema>,
  extra: RequestHandlerExtra<any, any>,
  deps: ListCustomPerspectivesDeps = { listCustomPerspectives }
) {
  try {
    const result = await deps.listCustomPerspectives({
      format: args.format || 'simple',
      includeRules: args.includeRules === true
    });

    if (isPrimitiveError(result)) {
      return {
        content: [{
          type: "text" as const,
          text: result
        }],
        isError: true
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: result
      }]
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    return {
      content: [{
        type: "text" as const,
        text: `Error listing custom perspectives: ${errorMessage}`
      }],
      isError: true
    };
  }
}
