import { z } from 'zod';
import { searchItems } from '../primitives/searchItems.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

const ItemTypeEnum = z.enum(["task", "project", "folder", "tag"]);

export const schema = z.object({
  includeProjectRoots: z.boolean().optional().describe('Include project root tasks (default false).'),
  query: z.string().min(1).describe("Text to look for. Plain case-insensitive SUBSTRING match — not fuzzy, not a regular expression"),
  types: z.array(ItemTypeEnum).optional().describe("Which entity types to search (default: all four — task, project, folder, tag)"),
  searchIn: z.enum(["names", "notes", "both"]).optional().describe("Where to look (default: names). Notes only exist on tasks and projects, so 'notes' returns nothing for folders and tags"),
  includeCompleted: z.boolean().optional().describe("Include finished work (default: false, which hides completed/dropped tasks and done/dropped projects)"),
  limitPerType: z.number().int().min(1).max(100).optional().describe("Maximum rows returned PER TYPE (default: 20, max: 100). Every match is counted before the cut, so the output always reports the true total")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await searchItems(args);

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
        text: `Error searching items: ${errorMessage}`
      }],
      isError: true
    };
  }
}
