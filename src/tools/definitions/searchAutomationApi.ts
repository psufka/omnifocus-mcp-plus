import { z } from 'zod';
import { searchAutomationApi } from '../primitives/searchAutomationApi.js';
import { recordToolData } from '../../utils/toolResult.js';

export const schema = z.object({
  query: z.string().trim().min(1).max(200).describe('API search text, e.g. Task.RepetitionRule or getTypeScriptDeclarations. Searches documentation, not tasks.'),
  offset: z.number().int().min(0).max(10_000_000).optional().describe('UTF-16 character offset; use nextOffset from the previous page (default 0).'),
  maxCharacters: z.number().int().min(256).max(40_000).optional().describe('Maximum returned text characters (default 12000).'),
  refresh: z.boolean().optional().describe('Bypass the documentation cache. The running OmniFocus version/build is checked on every call regardless.')
}).strict();

export async function handler(args: z.infer<typeof schema>) {
  const data = recordToolData(await searchAutomationApi(args));
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    ...(data.success ? {} : { isError: true }) };
}
