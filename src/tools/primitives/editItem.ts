import { runOmniJs } from '../../utils/scriptExecution.js';
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
function normalizeDateParams(params: EditItemParams): EditItemParams {
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
 * Edit a task or project in OmniFocus
 */
export async function editItem(params: EditItemParams): Promise<{
  success: boolean,
  id?: string,
  name?: string,
  changedProperties?: string,
  warnings?: string[],
  error?: string
}> {
  try {
    const validation = validateEditItemParams(params);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const script = `
      ${OMNIJS_LOOKUP_HELPERS}

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

      if (args.newPlannedDate !== undefined) {
        try {
          if (args.newPlannedDate === '') {
            item.plannedDate = null;
          } else {
            item.plannedDate = new Date(args.newPlannedDate);
          }
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

      // --- Tag operations (tasks AND projects) ---
      // OmniFocus projects carry tags on their root task and expose the same
      // addTag/removeTag/clearTags methods as Task, so one code path serves both.
      // replaceTags: [] means "clear every tag"; omitted means "leave tags alone".
      if (args.replaceTags !== undefined) {
        item.clearTags();
        for (const tagName of args.replaceTags) {
          let tag = flattenedTags.filter(t => t.name === tagName)[0];
          if (!tag) tag = new Tag(tagName);
          item.addTag(tag);
        }
        changedProperties.push(args.replaceTags.length === 0 ? 'tags (cleared)' : 'tags (replaced)');
      } else {
        if (args.addTags && args.addTags.length > 0) {
          for (const tagName of args.addTags) {
            let tag = flattenedTags.filter(t => t.name === tagName)[0];
            if (!tag) tag = new Tag(tagName);
            item.addTag(tag);
          }
          changedProperties.push('tags (added)');
        }

        if (args.removeTags && args.removeTags.length > 0) {
          for (const tagName of args.removeTags) {
            const tag = flattenedTags.filter(t => t.name === tagName)[0];
            if (tag) {
              item.removeTag(tag);
            }
          }
          changedProperties.push('tags (removed)');
        }
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

      return JSON.stringify({
        success: true,
        id: itemId,
        name: item.name,
        changedProperties: changedProperties.join(', '),
        warnings: warnings
      });
    `;

    const result = await runOmniJs(script, normalizeDateParams(params));
    return {
      success: result.success,
      id: result.id,
      name: result.name,
      changedProperties: result.changedProperties,
      warnings: result.warnings,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Unknown error in editItem'
    };
  }
}
