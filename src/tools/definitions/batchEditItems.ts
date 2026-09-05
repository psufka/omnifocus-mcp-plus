import { z } from 'zod';
import { schema as editSchema } from './editItem.js';
import { batchEditItems } from '../primitives/batchEditItems.js';

export const schema = z.object({
  items: z.array(editSchema.omit({ dryRun: true })).min(1).max(100).describe('Up to 100 task/project edits, in order. Each item resolves and verifies independently.'),
  dryRun: z.boolean().optional().describe('Preview all edits without changing OmniFocus.'),
  stopOnError: z.boolean().optional().describe('Stop after the first failure. Earlier successful edits remain; this is not an atomic batch.')
}).strict();
export async function handler(args: z.infer<typeof schema>) {
  const result = await batchEditItems(args);
  const lines = result.results.map((r: any) => `[${r.index}] ${r.status}: ${r.itemType} ${r.name ?? ''} (${r.id ?? 'unresolved'})${r.error ? ': ' + r.error : ''}${r.changes ? ' ' + JSON.stringify(r.changes) : ''}${r.mismatches?.length ? ' Mismatches: ' + JSON.stringify(r.mismatches) : ''}`);
  return { content: [{ type: 'text' as const, text: lines.join('\n') }], ...(result.success ? {} : { isError: true }) };
}
