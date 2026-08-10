/**
 * Server-level instructions surfaced to the model in the MCP initialize
 * response (`new McpServer(info, { instructions: SERVER_INSTRUCTIONS })`).
 *
 * Kept deliberately short — this text is prepended to every session, so it
 * carries only the rules whose absence produces a *wrong* result rather than
 * a merely slower one. Per-tool detail belongs in tool descriptions.
 */
export const SERVER_INSTRUCTIONS = [
  'OmniFocus MCP Plus — operating rules:',
  '- Prefer filter_tasks or search_items for lookups. dump_database returns the whole database and costs enormous context; use it only when a full snapshot is genuinely required.',
  '- Never invent, guess, or hand-construct an item id. Get ids from a list/search tool (filter_tasks, search_items, list_projects, list_folders, list_tags, get_inbox_tasks) and pass them back verbatim.',
  '- An "ambiguous name" error means two items share that name: re-run the lookup, then address the item by id instead of by name.',
  '- Before creating a task or project, run find_similar_tasks — OmniFocus databases accumulate near-duplicates fast.',
  '- All date inputs and outputs are LOCAL time. A bare YYYY-MM-DD means local midnight that day; never convert to UTC or append "Z".',
  '- After a session that changed data, call app_control sync exactly once at the end — not after every write.',
  '- Destructive tools (remove_item, batch_remove_items, delete_folder, delete_tag, app_control undo) act immediately and delete_folder cascades to the projects inside it. Re-read the ids from a list tool and confirm they name the intended items before calling.',
  '- Report what the tools actually returned. Do not invent counts, scores, or health numbers that no tool produced.',
].join('\n');
