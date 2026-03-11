import { z } from 'zod';
import { appendToNote } from '../primitives/appendToNote.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  object_type: z.enum(['task', 'project']).describe("Whether to append to a task or project note"),
  object_id: z.string().describe("The ID of the task or project"),
  text: z.string().describe("The text to append to the note")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await appendToNote(args);
    if (result.success) {
      return {
        content: [{ type: "text" as const, text: `Appended text to ${args.object_type} "${result.name}" (note is now ${result.noteLength} chars)` }]
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
