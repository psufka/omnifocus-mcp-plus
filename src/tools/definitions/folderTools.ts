import { z } from 'zod';
import { listFolders, getFolder, createFolder, updateFolder, deleteFolder } from '../primitives/folderTools.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

// --- list_folders ---
export const listFoldersSchema = z.object({
  limit: z.number().min(1).max(500).optional().describe("Maximum number of folders to return (default: 100)")
});

export async function listFoldersHandler(args: z.infer<typeof listFoldersSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await listFolders(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- get_folder ---
export const getFolderSchema = z.object({
  name_or_id: z.string().describe("Folder name or ID to look up")
});

export async function getFolderHandler(args: z.infer<typeof getFolderSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await getFolder(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- create_folder ---
export const createFolderSchema = z.object({
  name: z.string().describe("Name for the new folder"),
  parent: z.string().optional().describe("Parent folder name or ID (creates at top level if omitted)")
});

export async function createFolderHandler(args: z.infer<typeof createFolderSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await createFolder(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: `Created folder "${result.name}" (${result.id})` }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- update_folder ---
export const updateFolderSchema = z.object({
  name_or_id: z.string().describe("Folder name or ID to update"),
  name: z.string().optional().describe("New name for the folder"),
  status: z.enum(['active', 'dropped']).optional().describe("New status for the folder")
});

export async function updateFolderHandler(args: z.infer<typeof updateFolderSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await updateFolder(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: `Updated folder "${result.name}" (status: ${result.status})` }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- delete_folder ---
export const deleteFolderSchema = z.object({
  name_or_id: z.string().describe("Folder name or ID to delete. WARNING: deleting a folder deletes all projects inside it.")
});

export async function deleteFolderHandler(args: z.infer<typeof deleteFolderSchema>, extra: RequestHandlerExtra) {
  try {
    const result = await deleteFolder(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: `Deleted folder "${result.name}"` }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}
