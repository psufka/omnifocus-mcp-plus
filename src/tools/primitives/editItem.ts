import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_TAG_HELPERS } from '../../utils/omniJsTags.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { toLocalDateTimeString } from '../../utils/localDate.js';

// Status options for tasks and projects
type TaskStatus = 'incomplete' | 'completed' | 'dropped';
type ProjectStatus = 'active' | 'completed' | 'dropped' | 'onHold';

// Interface for item edit parameters
export interface EditItemParams {
  id?: string;                  // ID of the task or project to edit
  name?: string;                // Name of the task or project to edit (used only when no ID is given)
  itemType: 'task' | 'project'; // Type of item to edit

  // Common editable fields
  newName?: string;             // New name for the item
  newNote?: string;             // New note for the item
  newDueDate?: string;          // New due date in ISO format (empty string to clear)
  newDeferDate?: string;        // New defer date in ISO format (empty string to clear)
  newPlannedDate?: string;      // New planned date in ISO format (empty string to clear)
  newFlagged?: boolean;         // New flagged status (false to remove flag, true to add flag)
  newEstimatedMinutes?: number; // New estimated minutes
  addTags?: string[];           // Tags to add (tasks and projects both support tags)
  removeTags?: string[];        // Tags to remove (tasks and projects both support tags)
  replaceTags?: string[];       // Tags to replace all existing tags with ([] clears every tag)
  addTagIds?: string[];
  removeTagIds?: string[];
  replaceTagIds?: string[];
  dryRun?: boolean;
  dropAllOccurrences?: boolean; // When dropping a repeating item, drop every future occurrence (default false)

  // Task-specific fields
  newStatus?: TaskStatus;       // New status for tasks (incomplete, completed, dropped)
  newProjectId?: string;        // Move task to a new project by ID
  newProjectName?: string;      // Move task to a new project by name
  newParentTaskId?: string;     // Move task under a new parent task by ID
  newParentTaskName?: string;   // Move task under a new parent task by name
  moveToInbox?: boolean;        // Move task to inbox

  // Project-specific fields
  newSequential?: boolean;      // Whether the project should be sequential
  newFolderName?: string;       // New folder to move the project to (by name; accepts slash-paths)
  newFolderId?: string;         // New folder to move the project to (by ID)
  newProjectStatus?: ProjectStatus; // New status for projects
}

// Date fields normalized to local time before the script parses them.
const DATE_FIELDS = ['newDueDate', 'newDeferDate', 'newPlannedDate'] as const;

// Fields the script only honours for one itemType. Passing them with the other
// type used to be a silent no-op reported as "updated successfully".
const PROJECT_ONLY_FIELDS: Array<[keyof EditItemParams, string]> = [
  ['newSequential', ''],
  ['newProjectStatus', ' For tasks use newStatus.'],
  ['newFolderName', ''],
  ['newFolderId', '']
];

function hasTaskMoveTarget(params: EditItemParams): boolean {
  return Boolean(
    params.newProjectId ||
    params.newProjectName ||
    params.newParentTaskId ||
    params.newParentTaskName ||
    params.moveToInbox === true
  );
}

/**
 * Validate edit parameters before script generation.
 */
export function validateEditItemParams(params: EditItemParams): { valid: boolean; error?: string } {
  if (!params.id && !params.name) {
    return {
      valid: false,
      error: 'Either id or name must be provided'
    };
  }

  if ((params.replaceTags !== undefined || params.replaceTagIds !== undefined) &&
      [params.addTags, params.addTagIds, params.removeTags, params.removeTagIds].some(v => v !== undefined)) {
    return { valid: false, error: 'Cannot combine replacement tags with add/remove tags.' };
  }

  const hasMoveTarget = hasTaskMoveTarget(params);

  if (params.itemType !== 'task' && hasMoveTarget) {
    return {
      valid: false,
      error: 'Task move parameters are only supported when itemType is "task".'
    };
  }

  if (params.itemType !== 'task' && params.newStatus !== undefined) {
    return {
      valid: false,
      error: 'newStatus is only supported when itemType is "task". For projects use newProjectStatus.'
    };
  }

  if (params.itemType !== 'project') {
    for (const [field, hint] of PROJECT_ONLY_FIELDS) {
      if (params[field] !== undefined) {
        return {
          valid: false,
          error: `${field} is only supported when itemType is "project".${hint}`
        };
      }
    }
  }

  if (params.newFolderId && params.newFolderName) {
    return {
      valid: false,
      error: 'Cannot specify both newFolderId and newFolderName. Please use only one.'
    };
  }

  if (params.itemType === 'task') {
    if (params.newProjectId && params.newProjectName) {
      return {
        valid: false,
        error: 'Cannot specify both newProjectId and newProjectName. Please use only one.'
      };
    }

    if (params.newParentTaskId && params.newParentTaskName) {
      return {
        valid: false,
        error: 'Cannot specify both newParentTaskId and newParentTaskName. Please use only one.'
      };
    }

    const destinationTypeCount = [
      params.newProjectId || params.newProjectName ? 1 : 0,
      params.newParentTaskId || params.newParentTaskName ? 1 : 0,
      params.moveToInbox === true ? 1 : 0
    ].reduce((sum, val) => sum + val, 0);

    if (destinationTypeCount > 1) {
      return {
        valid: false,
        error: 'Invalid destination selection: specify exactly one destination type (project, parent task, or inbox).'
      };
    }
  }

  return { valid: true };
}

/**
 * Normalize date arguments so a bare "YYYY-MM-DD" means local midnight.
 * Without this the OmniJS `new Date(str)` call parses it as UTC midnight,
 * which lands on the previous day everywhere west of UTC.
 */
export function normalizeDateParams(params: EditItemParams): EditItemParams {
  const normalized: EditItemParams = { ...params };

  for (const field of DATE_FIELDS) {
    const value = params[field];
    if (typeof value === 'string' && value !== '') {
      normalized[field] = toLocalDateTimeString(value);
    }
  }

  return normalized;
}

/**
 * One field whose read-back did not match what the caller asked for.
 *
 * Date fields carry `kind: 'date'` and epoch milliseconds (or null) in
 * `expected`/`actual` — never a rendered string. The wire format stays
 * timezone-free and the definition layer renders it local, so a mismatch report
 * can never leak a `…Z` timestamp to the caller.
 */
export interface EditItemMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
  kind?: 'date';
}

export const EDIT_ITEM_SCRIPT = `
      ${OMNIJS_LOOKUP_HELPERS}
      ${OMNIJS_TAG_HELPERS}

      const collection = args.itemType === 'task' ? flattenedTasks : flattenedProjects;
      const changedProperties = [];
      const warnings = [];

      // Find the item. An explicit id that matches nothing is an error — it must
      // never fall back to name matching, or a stale id plus a name matching a
      // DIFFERENT item silently edits the wrong target.
      const itemLookup = __resolveByIdOrName(collection, args.id || null, args.name || null, args.itemType);
      if (itemLookup.error) {
        return JSON.stringify({ success: false, error: itemLookup.error });
      }
      const item = itemLookup.item;
      const itemId = item.id.primaryKey;

      // =====================================================================
      // Phase 1 — resolve and validate EVERY destination first.
      // Nothing in this phase may mutate the database: a lookup failure has to
      // leave the item completely untouched (a half-applied edit that renames
      // the item and then reports "Folder not found" is worse than no edit).
      // =====================================================================
      let moveToInbox = false;
      let destProject = null;
      let destParent = null;
      let destFolder = null;

      if (args.itemType === 'task') {
        if (args.moveToInbox === true) {
          moveToInbox = true;
        } else if (args.newProjectId || args.newProjectName) {
          const projectLookup = __resolveByIdOrName(flattenedProjects, args.newProjectId || null, args.newProjectName || null, 'Destination project');
          if (projectLookup.error) {
            return JSON.stringify({ success: false, error: projectLookup.error });
          }
          destProject = projectLookup.item;
        } else if (args.newParentTaskId || args.newParentTaskName) {
          const parentLookup = __resolveByIdOrName(flattenedTasks, args.newParentTaskId || null, args.newParentTaskName || null, 'Destination parent task');
          if (parentLookup.error) {
            return JSON.stringify({ success: false, error: parentLookup.error });
          }
          destParent = parentLookup.item;

          // Cycle prevention: walk up from destParent, ensure we don't find item
          let cursor = destParent;
          while (cursor) {
            if (cursor.id.primaryKey === itemId) {
              return JSON.stringify({ success: false, error: 'Invalid move target: cannot move a task into itself or its descendants.' });
            }
            const parent = cursor.parent;
            cursor = (parent && parent.constructor === Task) ? parent : null;
          }
        }
      }

      if (args.itemType === 'project') {
        if (args.newFolderId) {
          destFolder = flattenedFolders.filter(f => f.id.primaryKey === args.newFolderId)[0];
          if (!destFolder) {
            return JSON.stringify({ success: false, error: 'Folder not found with ID: ' + args.newFolderId });
          }
        } else if (args.newFolderName !== undefined) {
          // Recursive path resolver. Tries the input as a literal folder name first
          // (so a folder literally named e.g. 'Someday/Maybe' wins). If not a unique
          // match, splits at each '/' position (rightmost first → longest literal
          // prefix preferred) and recursively resolves parent + child. Handles paths
          // where an intermediate segment itself contains '/' in its literal name.
          const resolveFolderPath = function(pathStr) {
            const literal = flattenedFolders.filter(f => f.name === pathStr);
            if (literal.length === 1) return literal[0];
            for (let i = pathStr.length - 1; i >= 0; i--) {
              if (pathStr[i] === '/') {
                const parentPath = pathStr.substring(0, i);
                const leafName = pathStr.substring(i + 1);
                const parent = resolveFolderPath(parentPath);
                if (parent) {
                  const child = flattenedFolders.filter(f =>
                    f.parent && f.parent.id.primaryKey === parent.id.primaryKey && f.name === leafName
                  );
                  if (child.length === 1) return child[0];
                }
              }
            }
            return null;
          };

          // Tier 1: literal name match. Wins even when name contains '/' so existing folders like '📀Resources/Archives ' keep working.
          let folderMatches = flattenedFolders.filter(f => f.name === args.newFolderName);

          // Tier 2: if literal didn't uniquely resolve AND name looks like a path, resolve recursively.
          if (folderMatches.length !== 1 && args.newFolderName.indexOf('/') !== -1) {
            const resolved = resolveFolderPath(args.newFolderName);
            if (resolved) folderMatches = [resolved];
          }

          if (folderMatches.length === 0) {
            return JSON.stringify({ success: false, error: 'Folder not found: ' + args.newFolderName + '. Create it first with create_folder, or pass newFolderId.' });
          }
          if (folderMatches.length > 1) {
            return JSON.stringify({ success: false, error: 'Ambiguous folder name: ' + args.newFolderName + ". Use a slash-separated path (e.g. 'Parent/Child') or newFolderId." });
          }
          destFolder = folderMatches[0];
        }
      }

      const replacingTags = args.replaceTags !== undefined || args.replaceTagIds !== undefined;
      const replacePlan = __resolveTagPlan(args.replaceTags, args.replaceTagIds, true);
      const addPlan = __resolveTagPlan(args.addTags, args.addTagIds, true);
      const removePlan = __resolveTagPlan(args.removeTags, args.removeTagIds, 'ignoreMissing');
      for (const plan of [replacePlan, addPlan, removePlan]) {
        if (plan.error) return JSON.stringify({ success: false, id: itemId, name: item.name, error: plan.error });
      }
      if (args.dryRun === true) {
        const changes = {};
        Object.keys(args).forEach(function (key) {
          if (['id', 'name', 'itemType', 'dryRun'].indexOf(key) === -1) changes[key] = args[key];
        });
        return JSON.stringify({ success: true, id: itemId, name: item.name, dryRun: true,
          status: 'wouldEdit', changes: changes, tagsToCreate: replacingTags ? replacePlan.missing : addPlan.missing });
      }

      // =====================================================================
      // Phase 2 — every destination resolved; now apply the mutations.
      // =====================================================================

      // --- Moves (do first, before property edits) ---
      if (moveToInbox) {
        moveTasks([item], inbox.ending);
        changedProperties.push('moved (inbox)');
      } else if (destProject) {
        moveTasks([item], destProject.ending);
        changedProperties.push('moved (project)');
      } else if (destParent) {
        moveTasks([item], destParent.ending);
        changedProperties.push('moved (parent task)');
      }

      if (destFolder) {
        // OF's Omni Automation: there is no moveProjects(); Project.parentFolder
        // is read-only. The way to move a project (or folder) is moveSections()
        // with a positional reference like folder.ending — parallels moveTasks().
        moveSections([item], destFolder.ending);
        changedProperties.push('folder');
      }

      // --- Common property updates ---
      if (args.newName !== undefined) {
        item.name = args.newName;
        changedProperties.push('name');
      }

      if (args.newNote !== undefined) {
        item.note = args.newNote;
        changedProperties.push('note');
      }

      if (args.newDueDate !== undefined) {
        if (args.newDueDate === '') {
          item.dueDate = null;
        } else {
          item.dueDate = new Date(args.newDueDate);
        }
        changedProperties.push('due date');
      }

      if (args.newDeferDate !== undefined) {
        if (args.newDeferDate === '') {
          item.deferDate = null;
        } else {
          item.deferDate = new Date(args.newDeferDate);
        }
        changedProperties.push('defer date');
      }

      let plannedDateApplied = false;
      if (args.newPlannedDate !== undefined) {
        try {
          if (args.newPlannedDate === '') {
            item.plannedDate = null;
          } else {
            item.plannedDate = new Date(args.newPlannedDate);
          }
          plannedDateApplied = true;
          changedProperties.push('planned date');
        } catch(e) {
          warnings.push('plannedDate not supported by this OmniFocus version — skipped');
        }
      }

      if (args.newFlagged !== undefined) {
        item.flagged = args.newFlagged;
        changedProperties.push('flagged');
      }

      if (args.newEstimatedMinutes !== undefined) {
        item.estimatedMinutes = args.newEstimatedMinutes;
        changedProperties.push('estimated minutes');
      }

      // Tag identities were resolved before any write. Build and verify the final ID set.
      const expectedTagIds = replacingTags ? [] : __tagIds(item);
      if (replacingTags) {
        const tags = __materializeTagPlan(replacePlan);
        item.clearTags();
        tags.forEach(function (tag) { item.addTag(tag); expectedTagIds.push(tag.id.primaryKey); });
        changedProperties.push(tags.length === 0 ? 'tags (cleared)' : 'tags (replaced)');
      } else {
        const additions = __materializeTagPlan(addPlan);
        additions.forEach(function (tag) {
          item.addTag(tag);
          if (expectedTagIds.indexOf(tag.id.primaryKey) === -1) expectedTagIds.push(tag.id.primaryKey);
        });
        removePlan.entries.forEach(function (entry) {
          item.removeTag(entry.tag);
          const index = expectedTagIds.indexOf(entry.id);
          if (index >= 0) expectedTagIds.splice(index, 1);
        });
        if (additions.length) changedProperties.push('tags (added)');
        if (removePlan.entries.length) changedProperties.push('tags (removed)');
      }

      // --- Task-specific updates ---
      if (args.itemType === 'task') {
        if (args.newStatus !== undefined) {
          if (args.newStatus === 'completed') {
            item.markComplete();
            changedProperties.push('status (completed)');
          } else if (args.newStatus === 'dropped') {
            // drop(allOccurrences): false drops only this occurrence of a repeat.
            item.drop(args.dropAllOccurrences === true);
            changedProperties.push('status (dropped)');
          } else if (args.newStatus === 'incomplete') {
            item.markIncomplete();
            changedProperties.push('status (incomplete)');
          }
        }
      }

      // --- Project-specific updates ---
      if (args.itemType === 'project') {
        if (args.newSequential !== undefined) {
          item.sequential = args.newSequential;
          changedProperties.push('sequential');
        }

        if (args.newProjectStatus !== undefined) {
          const statusMap = {
            'active': Project.Status.Active,
            'completed': Project.Status.Done,
            'dropped': Project.Status.Dropped,
            'onHold': Project.Status.OnHold
          };
          const newStatus = statusMap[args.newProjectStatus];
          if (newStatus !== undefined) {
            if (args.newProjectStatus === 'completed') {
              item.markComplete();
            } else if (args.newProjectStatus === 'dropped') {
              // Project has no drop() in current OmniJS builds (verified against
              // OmniFocus 4) — assigning status is the documented equivalent.
              // Use drop() when a build does provide it so dropAllOccurrences applies.
              if (typeof item.drop === 'function') {
                item.drop(args.dropAllOccurrences === true);
              } else {
                item.status = Project.Status.Dropped;
              }
            } else {
              item.status = newStatus;
            }
            changedProperties.push('status');
          }
        }
      }

      // =====================================================================
      // Phase 3 — read-back verification.
      // Every field the caller asked for is re-read from the database and
      // compared against the requested value, inside this same script so
      // background sync cannot intervene. A property that silently refused the
      // write (unsupported in this OmniFocus build, read-only, coerced) is
      // reported as a mismatch instead of being announced as a clean edit.
      // =====================================================================
      const mismatches = [];
      const recordMismatch = function (field, expected, actual, kind) {
        mismatches.push({ field: field, expected: expected, actual: actual, kind: kind });
      };
      const dateMs = function (value) {
        if (value === null || value === undefined) { return null; }
        try { const ms = value.getTime(); return isNaN(ms) ? null : ms; } catch (e) { return null; }
      };
      const requestedMs = function (value) {
        if (value === '') { return null; }
        const ms = new Date(value).getTime();
        return isNaN(ms) ? null : ms;
      };
      const verifyDate = function (field, requested, actual) {
        const want = requestedMs(requested);
        const got = dateMs(actual);
        if (want === null && got === null) { return; }
        // A second of slack: OmniFocus stores some dates truncated to the
        // minute, which is not a failed write.
        if (want === null || got === null || Math.abs(want - got) > 1000) {
          // Epoch milliseconds, NOT an ISO string: toISOString() here would be
          // rendered verbatim by the definition and leak a UTC "…Z" timestamp.
          // The 'date' kind tells the renderer to format it in local time.
          recordMismatch(field, want, got, 'date');
        }
      };
      const sameSet = function (a, b) {
        if (a.length !== b.length) { return false; }
        for (let i = 0; i < a.length; i++) { if (b.indexOf(a[i]) === -1) { return false; } }
        return true;
      };
      const currentTags = (function () {
        try { return __tagIds(item); } catch (e) { return []; }
      })();

      // --- Moves ---
      if (moveToInbox) {
        let inInbox = false;
        try { inInbox = item.inInbox === true || item.containingProject === null; } catch (e) { inInbox = false; }
        if (!inInbox) {
          recordMismatch('moveToInbox', 'inbox', item.containingProject ? item.containingProject.name : 'unknown');
        }
      } else if (destProject) {
        const cp = item.containingProject;
        if (!cp || cp.id.primaryKey !== destProject.id.primaryKey) {
          recordMismatch('project', destProject.name, cp ? cp.name : null);
        }
      } else if (destParent) {
        const nowParent = item.parent;
        if (!nowParent || nowParent.id.primaryKey !== destParent.id.primaryKey) {
          recordMismatch('parentTask', destParent.name, nowParent ? nowParent.name : null);
        }
      }

      if (destFolder) {
        let nowFolder = null;
        try { nowFolder = item.parentFolder; } catch (e) { nowFolder = null; }
        if (!nowFolder || nowFolder.id.primaryKey !== destFolder.id.primaryKey) {
          recordMismatch('folder', destFolder.name, nowFolder ? nowFolder.name : null);
        }
      }

      // --- Common properties ---
      if (args.newName !== undefined && item.name !== args.newName) {
        recordMismatch('newName', args.newName, item.name);
      }
      if (args.newNote !== undefined && item.note !== args.newNote) {
        recordMismatch('newNote', args.newNote, item.note);
      }
      if (args.newDueDate !== undefined) { verifyDate('newDueDate', args.newDueDate, item.dueDate); }
      if (args.newDeferDate !== undefined) { verifyDate('newDeferDate', args.newDeferDate, item.deferDate); }
      if (args.newPlannedDate !== undefined && plannedDateApplied) {
        try {
          verifyDate('newPlannedDate', args.newPlannedDate, item.plannedDate);
        } catch (e) {
          warnings.push('plannedDate was written but could not be read back for verification on this OmniFocus version.');
        }
      }
      if (args.newFlagged !== undefined && item.flagged !== args.newFlagged) {
        recordMismatch('newFlagged', args.newFlagged, item.flagged);
      }
      if (args.newEstimatedMinutes !== undefined && item.estimatedMinutes !== args.newEstimatedMinutes) {
        recordMismatch('newEstimatedMinutes', args.newEstimatedMinutes, item.estimatedMinutes === undefined ? null : item.estimatedMinutes);
      }

      // --- Tags: compare identities, including mutually exclusive group effects. ---
      const tagsRequested = replacingTags || args.addTags !== undefined || args.addTagIds !== undefined ||
        args.removeTags !== undefined || args.removeTagIds !== undefined;
      if (tagsRequested && !sameSet(expectedTagIds, currentTags)) {
        recordMismatch(replacingTags ? 'replaceTags' : (addPlan.entries.length ? 'addTags' : 'removeTags'), expectedTagIds, currentTags);
      }

      // --- Task status ---
      if (args.itemType === 'task' && args.newStatus !== undefined) {
        const statusName = __statusLabel(item);
        let repeating = false;
        try { repeating = item.repetitionRule ? true : false; } catch (e) { repeating = false; }

        if (args.newStatus === 'completed') {
          if (item.taskStatus !== Task.Status.Completed) {
            if (repeating) {
              warnings.push('Repeating task: this occurrence was completed and OmniFocus created the next one, so the task still reads as ' + statusName + '.');
            } else {
              recordMismatch('newStatus', 'completed', statusName);
            }
          }
        } else if (args.newStatus === 'dropped') {
          if (item.taskStatus !== Task.Status.Dropped) {
            if (repeating && args.dropAllOccurrences !== true) {
              warnings.push('Repeating task: only this occurrence was dropped, so the task still reads as ' + statusName + '. Pass dropAllOccurrences to drop every future occurrence.');
            } else {
              recordMismatch('newStatus', 'dropped', statusName);
            }
          }
        } else if (args.newStatus === 'incomplete') {
          if (item.taskStatus === Task.Status.Completed || item.taskStatus === Task.Status.Dropped) {
            recordMismatch('newStatus', 'incomplete', statusName);
          }
        }
      }

      // --- Project properties ---
      if (args.itemType === 'project') {
        if (args.newSequential !== undefined && item.sequential !== args.newSequential) {
          recordMismatch('newSequential', args.newSequential, item.sequential);
        }
        if (args.newProjectStatus !== undefined) {
          // Project.taskStatus exists but reports the ROOT TASK's status
          // (Blocked/Next), so the project status must come from .status.
          let projectStatusName = 'unknown';
          try {
            const raw = String(item.status);
            const sep = raw.indexOf(': ');
            projectStatusName = (sep >= 0 && raw.charAt(raw.length - 1) === ']') ? raw.slice(sep + 2, -1) : raw;
          } catch (e) { projectStatusName = 'unknown'; }

          const expectedStatusNames = { active: 'Active', completed: 'Done', dropped: 'Dropped', onHold: 'OnHold' };
          const expectedStatusName = expectedStatusNames[args.newProjectStatus];
          if (expectedStatusName && projectStatusName !== expectedStatusName) {
            recordMismatch('newProjectStatus', args.newProjectStatus, projectStatusName);
          }
        }
      }

      return JSON.stringify({
        success: true,
        id: itemId,
        name: item.name,
        tagIds: __tagIds(item),
        changedFields: changedProperties,
        changedProperties: changedProperties.join(', '),
        warnings: warnings,
        verified: mismatches.length === 0,
        mismatches: mismatches
      });
    `;


/**
 * Edit a task or project in OmniFocus.
 *
 * The result is additive-only on purpose: `success`, `id`, `name`,
 * `changedProperties` and `warnings` keep their existing meaning (move_task
 * renders them), and `verified` / `mismatches` are new fields carrying the
 * post-write read-back. `verified: false` means the edit was applied but at
 * least one field did not read back as requested — callers should surface that
 * rather than report a clean success.
 */
export async function editItem(params: EditItemParams): Promise<{
  success: boolean,
  id?: string,
  name?: string,
  changedProperties?: string,
  warnings?: string[],
  verified?: boolean,
  mismatches?: EditItemMismatch[],
  error?: string,
  dryRun?: boolean,
  changes?: Record<string, unknown>,
  tagIds?: string[],
  changedFields?: string[]
}> {
  try {
    const validation = validateEditItemParams(params);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }


    const result = await runOmniJs(EDIT_ITEM_SCRIPT, normalizeDateParams(params), { readOnly: params.dryRun === true });
    const mismatches: EditItemMismatch[] = Array.isArray(result.mismatches) ? result.mismatches : [];
    return {
      success: result.success,
      id: result.id,
      dryRun: result.dryRun,
      changes: result.changes,
      tagIds: result.tagIds,
      changedFields: result.changedFields,
      name: result.name,
      changedProperties: result.changedProperties,
      warnings: result.warnings,
      // Absent on the error paths (the script returns before verification) —
      // only claim verification when the script actually reported it.
      verified: result.success ? result.verified === true : undefined,
      mismatches: mismatches.length > 0 ? mismatches : undefined,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Unknown error in editItem'
    };
  }
}
