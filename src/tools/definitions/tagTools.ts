import { z } from 'zod';
import { listTags, searchTags, createTag, updateTag, deleteTag } from '../primitives/tagTools.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

// --- list_tags ---
export const listTagsSchema = z.object({
  status: z.enum(['active', 'on_hold', 'dropped']).optional().describe("Filter by tag status"),
  sortBy: z.enum(['name', 'taskCount']).optional().describe("Sort field (default: name)"),
  limit: z.number().min(1).max(500).optional().describe("Maximum number of tags to return (default: 100)")
});

export async function listTagsHandler(args: z.infer<typeof listTagsSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await listTags(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- search_tags ---
export const searchTagsSchema = z.object({
  query: z.string().describe("Search query to match against tag names"),
  limit: z.number().min(1).max(200).optional().describe("Maximum number of results (default: 50)")
});

export async function searchTagsHandler(args: z.infer<typeof searchTagsSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await searchTags(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- create_tag ---
export const createTagSchema = z.object({
  name: z.string().describe("Name for the new tag"),
  parent: z.string().optional().describe("Parent tag name or ID (creates at top level if omitted)")
});

export async function createTagHandler(args: z.infer<typeof createTagSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await createTag(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: `Created tag "${result.name}" (${result.id})` }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- update_tag ---
export const updateTagSchema = z.object({
  name_or_id: z.string().describe("Tag name or ID to update"),
  name: z.string().optional().describe("New name for the tag"),
  status: z.enum(['active', 'on_hold', 'dropped']).optional().describe("New status for the tag")
});

export async function updateTagHandler(args: z.infer<typeof updateTagSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await updateTag(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: `Updated tag "${result.name}" (status: ${result.status})` }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- delete_tag ---
export const deleteTagSchema = z.object({
  name_or_id: z.string().describe("Tag name or ID to delete")
});

export async function deleteTagHandler(args: z.infer<typeof deleteTagSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await deleteTag(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: `Deleted tag "${result.name}"` }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}
