import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

/**
 * app_control — application-level OmniFocus operations that act on the app or
 * its front window rather than on database items: sync, undo/redo, sidebar
 * focus, and reveal-in-window.
 *
 * Design notes:
 *
 *   - ONE script per call. Every operation is a branch of the same OmniJS
 *     source, so nothing is read-modify-written across two evaluations (the
 *     background sync mutates the database between calls).
 *   - Undo and redo are guarded by an explicit `confirm`. The top of the
 *     OmniFocus undo stack is frequently the USER's own manual edit, not
 *     something this server did — undoing it without asking silently destroys
 *     their work. Without confirm the script reports the stack state and
 *     changes nothing.
 *   - `document.windows` can legitimately be empty (all windows closed, app
 *     running headless in the background). Every window operation checks that
 *     first and returns an actionable error instead of a TypeError.
 *   - `document.sync()` is fire-and-forget: it starts a sync and returns
 *     immediately. The result says "initiated", never "completed".
 */

export type AppControlOperation =
  | 'sync'
  | 'undo'
  | 'redo'
  | 'get_focus'
  | 'set_focus'
  | 'clear_focus'
  | 'reveal';

export interface AppControlParams {
  operation: AppControlOperation;
  confirm?: boolean;
  folderNames?: string[];
  folderIds?: string[];
  projectNames?: string[];
  projectIds?: string[];
  taskId?: string;
  taskName?: string;
  projectId?: string;
  projectName?: string;
}

export interface FocusSection {
  name: string;
  id: string;
  kind: string;
}

export interface AppControlResult {
  success: boolean;
  operation?: AppControlOperation;
  error?: string;
  /** undo/redo: false when confirm was withheld. */
  performed?: boolean;
  needsConfirmation?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  initiated?: boolean;
  focus?: FocusSection[];
  requestedCount?: number;
  verified?: boolean;
  selected?: boolean;
  selectError?: string | null;
  itemId?: string;
  itemName?: string;
  itemKind?: string;
  perspective?: string | null;
}

const APP_CONTROL_HELPERS = `
  function __windowOrError() {
    var windows = null;
    try { windows = document.windows; } catch (e) {
      return { error: 'Could not read the OmniFocus window list: ' + e.message };
    }
    if (!windows || windows.length === 0) {
      return { error: 'OmniFocus has no open window; open one (OmniFocus > File > New Window, or click the OmniFocus icon in the Dock) and retry.' };
    }
    return { window: windows[0] };
  }

  function __sectionKind(s) {
    try { if (typeof Project !== 'undefined' && s.constructor === Project) { return 'project'; } } catch (e) {}
    try { if (typeof Folder !== 'undefined' && s.constructor === Folder) { return 'folder'; } } catch (e) {}
    return 'section';
  }

  // Reads windows[0].focus into a plain array of descriptors. An empty
  // SectionArray (length 0) means "no focus", which is not an error.
  function __describeFocus(w) {
    var f = null;
    try { f = w.focus; } catch (e) {
      return { error: 'Could not read the focus of the front window: ' + e.message };
    }
    if (!f) { return { sections: [] }; }
    var plain = [];
    try { plain = f.filter(function () { return true; }); } catch (e) {
      return { error: 'Could not enumerate the focused sections: ' + e.message };
    }
    var out = [];
    for (var i = 0; i < plain.length; i++) {
      var s = plain[i];
      var entry = { name: '(unnamed)', id: '', kind: __sectionKind(s) };
      try { entry.name = s.name; } catch (e) {}
      try { entry.id = s.id.primaryKey; } catch (e) {}
      out.push(entry);
    }
    return { sections: out };
  }
`;

export const APP_CONTROL_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${APP_CONTROL_HELPERS}

  const op = args.operation;

  if (op === 'sync') {
    try {
      document.sync();
    } catch (e) {
      return JSON.stringify({ success: false, operation: op, error: 'OmniFocus could not start a sync: ' + e.message });
    }
    return JSON.stringify({ success: true, operation: op, initiated: true });
  }

  if (op === 'undo' || op === 'redo') {
    var couldUndo = false;
    var couldRedo = false;
    try { couldUndo = canUndo; couldRedo = canRedo; } catch (e) {
      return JSON.stringify({ success: false, operation: op, error: 'Could not read the OmniFocus undo state: ' + e.message });
    }

    if (args.confirm !== true) {
      return JSON.stringify({
        success: true,
        operation: op,
        performed: false,
        needsConfirmation: true,
        canUndo: couldUndo,
        canRedo: couldRedo
      });
    }

    if (op === 'undo' && !couldUndo) {
      return JSON.stringify({ success: false, operation: op, error: 'Nothing to undo: the OmniFocus undo stack is empty.', canUndo: couldUndo, canRedo: couldRedo });
    }
    if (op === 'redo' && !couldRedo) {
      return JSON.stringify({ success: false, operation: op, error: 'Nothing to redo: the OmniFocus redo stack is empty.', canUndo: couldUndo, canRedo: couldRedo });
    }

    try {
      if (op === 'undo') { undo(); } else { redo(); }
    } catch (e) {
      return JSON.stringify({ success: false, operation: op, error: 'OmniFocus rejected the ' + op + ': ' + e.message, canUndo: couldUndo, canRedo: couldRedo });
    }

    var nowUndo = couldUndo;
    var nowRedo = couldRedo;
    try { nowUndo = canUndo; nowRedo = canRedo; } catch (e) {}
    return JSON.stringify({ success: true, operation: op, performed: true, canUndo: nowUndo, canRedo: nowRedo });
  }

  // Everything below acts on the front window.
  const wr = __windowOrError();
  if (wr.error) { return JSON.stringify({ success: false, operation: op, error: wr.error }); }
  const w = wr.window;

  if (op === 'get_focus') {
    const current = __describeFocus(w);
    if (current.error) { return JSON.stringify({ success: false, operation: op, error: current.error }); }
    return JSON.stringify({ success: true, operation: op, focus: current.sections });
  }

  if (op === 'clear_focus') {
    try {
      w.focus = [];
    } catch (e) {
      return JSON.stringify({ success: false, operation: op, error: 'OmniFocus rejected clearing the focus: ' + e.message });
    }
    const cleared = __describeFocus(w);
    if (cleared.error) { return JSON.stringify({ success: false, operation: op, error: cleared.error }); }
    return JSON.stringify({
      success: true,
      operation: op,
      focus: cleared.sections,
      verified: cleared.sections.length === 0
    });
  }

  if (op === 'set_focus') {
    const resolved = [];
    const errors = [];
    const seen = {};

    function __collect(res) {
      if (res.error) { errors.push(res.error); return; }
      var key = 'k_' + res.item.id.primaryKey;
      if (seen[key]) { return; }
      seen[key] = true;
      resolved.push(res.item);
    }

    const folderIds = args.folderIds || [];
    for (var fi = 0; fi < folderIds.length; fi++) {
      __collect(__resolveByIdOrName(flattenedFolders, folderIds[fi], null, 'Folder'));
    }
    const folderNames = args.folderNames || [];
    for (var fn = 0; fn < folderNames.length; fn++) {
      __collect(__resolveByIdOrName(flattenedFolders, null, folderNames[fn], 'Folder'));
    }
    const projectIds = args.projectIds || [];
    for (var pi = 0; pi < projectIds.length; pi++) {
      __collect(__resolveByIdOrName(flattenedProjects, projectIds[pi], null, 'Project'));
    }
    const projectNames = args.projectNames || [];
    for (var pn = 0; pn < projectNames.length; pn++) {
      __collect(__resolveByIdOrName(flattenedProjects, null, projectNames[pn], 'Project'));
    }

    // All-or-nothing: a partially applied focus is worse than none, because
    // the caller would believe it focused things it did not.
    if (errors.length > 0) {
      return JSON.stringify({ success: false, operation: op, error: 'Focus unchanged. Could not resolve: ' + errors.join(' | ') });
    }
    if (resolved.length === 0) {
      return JSON.stringify({ success: false, operation: op, error: 'No focus targets were provided. Pass at least one of folderNames, folderIds, projectNames, projectIds.' });
    }

    try {
      w.focus = resolved;
    } catch (e) {
      return JSON.stringify({ success: false, operation: op, error: 'OmniFocus rejected the focus assignment: ' + e.message });
    }

    const after = __describeFocus(w);
    if (after.error) { return JSON.stringify({ success: false, operation: op, error: after.error }); }
    return JSON.stringify({
      success: true,
      operation: op,
      focus: after.sections,
      requestedCount: resolved.length,
      verified: after.sections.length === resolved.length
    });
  }

  if (op === 'reveal') {
    var lookup = null;
    var kind = 'task';
    if (args.taskId || args.taskName) {
      lookup = __resolveByIdOrName(flattenedTasks, args.taskId, args.taskName, 'Task');
    } else {
      kind = 'project';
      lookup = __resolveByIdOrName(flattenedProjects, args.projectId, args.projectName, 'Project');
    }
    if (lookup.error) { return JSON.stringify({ success: false, operation: op, error: lookup.error }); }
    const target = lookup.item;

    var selected = false;
    var selectError = null;
    try {
      w.selectObjects([target]);
      selected = true;
    } catch (e) {
      selectError = e.message;
    }

    var perspective = null;
    try { perspective = w.perspective ? String(w.perspective.name) : null; } catch (e) {}

    return JSON.stringify({
      success: true,
      operation: op,
      itemId: target.id.primaryKey,
      itemName: target.name,
      itemKind: kind,
      selected: selected,
      selectError: selectError,
      perspective: perspective
    });
  }

  return JSON.stringify({ success: false, error: 'Unknown operation: ' + op });
`;

const FOCUS_FIELDS: Array<keyof AppControlParams> = ['folderNames', 'folderIds', 'projectNames', 'projectIds'];
const REVEAL_FIELDS: Array<keyof AppControlParams> = ['taskId', 'taskName', 'projectId', 'projectName'];

/**
 * Node-side guards. These mirror the schema refinements so the primitive is
 * safe when called directly (tests, future callers) and never spends an
 * osascript round-trip on input that cannot succeed.
 */
export function validateAppControlParams(params: AppControlParams): { valid: boolean; error?: string } {
  const { operation } = params;

  if (operation === 'set_focus') {
    const provided = FOCUS_FIELDS.filter(field => {
      const value = params[field];
      return Array.isArray(value) && value.length > 0;
    });
    if (provided.length === 0) {
      return {
        valid: false,
        error: "set_focus requires at least one of folderNames, folderIds, projectNames, projectIds."
      };
    }
  }

  if (operation === 'reveal') {
    const provided = REVEAL_FIELDS.filter(field => typeof params[field] === 'string' && (params[field] as string).length > 0);
    if (provided.length !== 1) {
      return {
        valid: false,
        error: `reveal requires exactly one of taskId, taskName, projectId, projectName (got ${provided.length}).`
      };
    }
  }

  return { valid: true };
}

type OmniJsRunner = typeof runOmniJs;

export async function appControl(
  params: AppControlParams,
  run: OmniJsRunner = runOmniJs
): Promise<AppControlResult> {
  const validation = validateAppControlParams(params);
  if (!validation.valid) {
    return { success: false, operation: params.operation, error: validation.error };
  }

  // get_focus is the only operation that never writes. Undo/redo without
  // confirm writes nothing either, but it shares a script with the confirmed
  // path, so it is not classified read-only.
  const options = params.operation === 'get_focus' ? { readOnly: true } : undefined;

  const result = await run(APP_CONTROL_SCRIPT, params as Record<string, any>, options);
  if (!result || typeof result !== 'object') {
    return { success: false, operation: params.operation, error: 'OmniFocus returned no result.' };
  }
  return result as AppControlResult;
}
