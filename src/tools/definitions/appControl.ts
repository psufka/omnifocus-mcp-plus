import { z } from 'zod';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { appControl, type AppControlResult, type FocusSection } from '../primitives/appControl.js';

const OPERATIONS = ['sync', 'undo', 'redo', 'get_focus', 'set_focus', 'clear_focus', 'reveal'] as const;

const FOCUS_ONLY_FIELDS = ['folderNames', 'folderIds', 'projectNames', 'projectIds'] as const;
const REVEAL_ONLY_FIELDS = ['taskId', 'taskName', 'projectId', 'projectName'] as const;

export const schema = z.object({
  operation: z.enum(OPERATIONS).describe(
    "What to do: " +
    "'sync' starts an OmniFocus sync (fire-and-forget). " +
    "'undo' / 'redo' step the OmniFocus undo stack — DESTRUCTIVE, requires confirm: true. " +
    "'get_focus' reports what the front window is focused on. " +
    "'set_focus' focuses the sidebar on specific folders/projects. " +
    "'clear_focus' removes any focus. " +
    "'reveal' selects a task or project in the front window."
  ),
  confirm: z.boolean().optional().describe(
    "Required (true) for 'undo' and 'redo'. Without it those operations only REPORT the undo/redo state and change nothing. Only valid with undo/redo."
  ),

  // set_focus targets (plural — these are lists)
  folderNames: z.array(z.string().min(1)).optional().describe("set_focus only: folder names to focus on."),
  folderIds: z.array(z.string().min(1)).optional().describe("set_focus only: folder IDs to focus on."),
  projectNames: z.array(z.string().min(1)).optional().describe("set_focus only: project names to focus on."),
  projectIds: z.array(z.string().min(1)).optional().describe("set_focus only: project IDs to focus on."),

  // reveal target (singular — exactly one)
  taskId: z.string().min(1).optional().describe("reveal only: ID of the task to select."),
  taskName: z.string().min(1).optional().describe("reveal only: name of the task to select (alternative to taskId)."),
  projectId: z.string().min(1).optional().describe("reveal only: ID of the project to select. NOTE: for set_focus use projectIds (plural)."),
  projectName: z.string().min(1).optional().describe("reveal only: name of the project to select. NOTE: for set_focus use projectNames (plural).")
}).strict()
  .refine(
    data => data.operation !== 'set_focus' ||
      FOCUS_ONLY_FIELDS.some(field => Array.isArray(data[field]) && data[field]!.length > 0),
    {
      message: "set_focus requires at least one of folderNames, folderIds, projectNames, projectIds",
      path: ['folderNames']
    }
  )
  .refine(
    data => data.operation === 'set_focus' ||
      !FOCUS_ONLY_FIELDS.some(field => data[field] !== undefined),
    {
      message: "folderNames/folderIds/projectNames/projectIds are only valid with operation 'set_focus' (for 'reveal' use the singular taskId/taskName/projectId/projectName)",
      path: ['operation']
    }
  )
  .refine(
    data => data.operation !== 'reveal' ||
      REVEAL_ONLY_FIELDS.filter(field => data[field] !== undefined).length === 1,
    {
      message: "reveal requires exactly one of taskId, taskName, projectId, projectName",
      path: ['taskId']
    }
  )
  .refine(
    data => data.operation === 'reveal' ||
      !REVEAL_ONLY_FIELDS.some(field => data[field] !== undefined),
    {
      message: "taskId/taskName/projectId/projectName are only valid with operation 'reveal' (for 'set_focus' use the plural folderNames/folderIds/projectNames/projectIds)",
      path: ['operation']
    }
  )
  .refine(
    data => data.confirm === undefined || data.operation === 'undo' || data.operation === 'redo',
    {
      message: "confirm is only meaningful for operation 'undo' or 'redo'",
      path: ['confirm']
    }
  );

function formatFocus(sections: FocusSection[] | undefined): string {
  if (!sections || sections.length === 0) return 'no focus (whole database visible)';
  return sections.map(s => `- **${s.name}** (${s.kind}, id: ${s.id})`).join('\n');
}

function describeUndoState(result: AppControlResult): string {
  const undoable = result.canUndo ? 'available' : 'empty';
  const redoable = result.canRedo ? 'available' : 'empty';
  return `Undo stack: ${undoable} · Redo stack: ${redoable}`;
}

function renderSuccess(operation: string, result: AppControlResult): string {
  switch (operation) {
    case 'sync':
      return '🔄 **Sync started.** OmniFocus syncs in the background, so this reports that the sync was initiated — not that it finished. Re-read data in a few seconds if you need post-sync state.';

    case 'undo':
    case 'redo': {
      if (result.needsConfirmation) {
        return `⚠️ **${operation} not performed — confirmation required.**\n\n` +
          `${describeUndoState(result)}\n\n` +
          `The top of the OmniFocus undo stack may be **the user's own manual action**, not anything this server did — ` +
          `there is no way to inspect what it contains before running it. Ask the user before proceeding, then call again with confirm: true.`;
      }
      return `↩️ **${operation === 'undo' ? 'Undo' : 'Redo'} performed.**\n\n${describeUndoState(result)}\n\n` +
        `If this reverted something unexpected, ${operation === 'undo' ? 'redo' : 'undo'} it immediately — the stack is shallow and further edits will bury it.`;
    }

    case 'get_focus': {
      const sections = result.focus ?? [];
      return sections.length === 0
        ? '🎯 **No focus set.** The front window shows the whole database.'
        : `🎯 **Focused on ${sections.length} section${sections.length === 1 ? '' : 's'}:**\n\n${formatFocus(sections)}`;
    }

    case 'set_focus': {
      const sections = result.focus ?? [];
      const verified = result.verified === true
        ? ''
        : `\n\n⚠️ Read-back mismatch: requested ${result.requestedCount} section(s) but the window reports ${sections.length}. OmniFocus may have coalesced or rejected some targets.`;
      return `🎯 **Focus set to ${sections.length} section${sections.length === 1 ? '' : 's'}:**\n\n${formatFocus(sections)}${verified}`;
    }

    case 'clear_focus':
      return result.verified === true
        ? '🎯 **Focus cleared.** The front window shows the whole database again.'
        : `⚠️ **Focus clear could not be verified** — the window still reports ${(result.focus ?? []).length} focused section(s).`;

    case 'reveal': {
      const where = result.perspective ? ` (current perspective: ${result.perspective})` : '';
      if (result.selected) {
        return `👁️ **Selected ${result.itemKind} "${result.itemName}"** in the front window${where}.\n\nid: ${result.itemId}\n\n` +
          `If it is not visible on screen, the current perspective may filter it out — switch perspectives in OmniFocus yourself; this tool never changes them.`;
      }
      return `⚠️ **Could not select ${result.itemKind} "${result.itemName}"** (id: ${result.itemId})${where}.\n\n` +
        `OmniFocus rejected the selection${result.selectError ? `: ${result.selectError}` : ''}. This usually means the item is not shown by the current perspective. Switch to a perspective that includes it and retry.`;
    }

    default:
      return JSON.stringify(result);
  }
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await appControl(args);

    if (!result.success) {
      const extraState = (args.operation === 'undo' || args.operation === 'redo') && result.canUndo !== undefined
        ? `\n\n${describeUndoState(result)}`
        : '';
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}${extraState}` }],
        isError: true
      };
    }

    return {
      content: [{ type: "text" as const, text: renderSuccess(args.operation, result) }]
    };
  } catch (err: unknown) {
    return {
      content: [{ type: "text" as const, text: `Error running app_control: ${(err as Error).message}` }],
      isError: true
    };
  }
}
