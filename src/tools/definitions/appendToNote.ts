import { z } from 'zod';
import { appendToNote } from '../primitives/appendToNote.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  itemType: z.enum(['task', 'project']).optional().describe("Whether to append to a task or project note. Canonical field; legacy alias 'object_type' also accepted."),
  object_type: z.enum(['task', 'project']).optional().describe("[DEPRECATED] Alias for itemType. Prefer itemType."),
  id: z.string().optional().describe("The ID of the task or project. Canonical field; legacy alias 'object_id' also accepted."),
  object_id: z.string().optional().describe("[DEPRECATED] Alias for id. Prefer id."),
  text: z.string().describe("The text to append to the note")
})
  .strict()
  .refine(
    d => d.itemType !== undefined || d.object_type !== undefined,
    { message: "itemType is required (legacy alias 'object_type' also accepted)" }
  )
  .refine(
    d => d.id !== undefined || d.object_id !== undefined,
    { message: "id is required (legacy alias 'object_id' also accepted)" }
  )
  .transform(d => {
    const itemType = (d.itemType ?? d.object_type)!;
    const id = (d.id ?? d.object_id)!;
    return { ...d, itemType, id, object_type: itemType, object_id: id };
  });

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await appendToNote(args);
    if (result.success) {
      return {
        content: [{ type: "text" as const, text: `Appended text to ${args.itemType} "${result.name}" (note is now ${result.noteLength} chars)` }]
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
      content: [{ type: "text" as const, text: `Error appending to note: ${error.message}` }],
      isError: true
    };
  }
}
