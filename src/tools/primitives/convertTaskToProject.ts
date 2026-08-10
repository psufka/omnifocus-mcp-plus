import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

/**
 * Promote an existing task (with its subtasks) into a full project.
 *
 * Verified OmniJS facts this file depends on (probed live, OmniFocus 4.8.13):
 *   - `convertTasksToProjects(tasks, position)` is a GLOBAL function (not a
 *     method on the database), and `library` is a global whose `.ending`
 *     insertion point puts the new project at the top level.
 *   - A project and its root task SHARE a primaryKey: `Project.byIdentifier(id)`
 *     and `Task.byIdentifier(id)` both resolve for a project root, and the root
 *     task IS a member of `flattenedTasks`. That identity is what makes the
 *     "already a project" guard and the post-conversion read-back possible.
 *   - The documented return value is an array of new Projects, but it is never
 *     trusted here: the project is re-read from the database.
 */

export interface ConvertTaskToProjectParams {
  taskId?: string;
  taskName?: string;
  folderId?: string;
  folderName?: string;
  /** Tags always carry over; pass false to strip them from the new project. */
  keepTags?: boolean;
}

export interface ConvertTaskToProjectResult {
  success: boolean;
  id?: string;
  name?: string;
  folder?: string | null;
  /** Subtasks that came across with the converted task. */
  subtaskCount?: number;
  subtaskCountBefore?: number;
  tags?: string[];
  tagsCleared?: boolean;
  verified?: boolean;
  warnings?: string[];
  error?: string;
}

export function validateConvertTaskToProjectParams(params: ConvertTaskToProjectParams): { valid: boolean; error?: string } {
  if (!params.taskId && !params.taskName) {
    return { valid: false, error: 'Either taskId or taskName must be provided.' };
  }
  if (params.taskId && params.taskName) {
    return { valid: false, error: 'Cannot specify both taskId and taskName. Please use only one.' };
  }
  if (params.folderId && params.folderName) {
    return { valid: false, error: 'Cannot specify both folderId and folderName. Please use only one.' };
  }
  return { valid: true };
}

export const CONVERT_TASK_TO_PROJECT_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}

  const lookup = __resolveByIdOrName(flattenedTasks, args.taskId || null, args.taskName || null, 'Task');
  if (lookup.error) {
    return JSON.stringify({ success: false, error: lookup.error });
  }

  const task = lookup.item;
  const taskId = task.id.primaryKey;
  const taskName = task.name;
  const warnings = [];

  // A project's root task shares the project's primaryKey, so a task that also
  // resolves as a Project IS a project root — there is nothing to convert, and
  // converting it again would either no-op or throw deep inside OmniFocus.
  let alreadyProject = null;
  try {
    alreadyProject = (typeof Project !== 'undefined' && typeof Project.byIdentifier === 'function')
      ? Project.byIdentifier(taskId)
      : null;
  } catch (e) { alreadyProject = null; }
  if (alreadyProject) {
    return JSON.stringify({
      success: false,
      id: taskId,
      name: taskName,
      error: 'Task "' + taskName + '" (id ' + taskId + ') is already the root task of a project. Nothing to convert.'
    });
  }

  // The same identity trap from the other direction: a task whose containing
  // project has this exact id would be the project root under another name.
  try {
    const cp = task.containingProject;
    if (cp && cp.id.primaryKey === taskId) {
      return JSON.stringify({
        success: false,
        id: taskId,
        name: taskName,
        error: 'Task "' + taskName + '" is the root task of project "' + cp.name + '" (shared id ' + taskId + '). Nothing to convert.'
      });
    }
  } catch (e) {}

  // Destination: an explicit folder, otherwise the top level of the library.
  let folder = null;
  if (args.folderId || args.folderName) {
    const folderLookup = __resolveByIdOrName(flattenedFolders, args.folderId || null, args.folderName || null, 'Folder');
    if (folderLookup.error) {
      return JSON.stringify({ success: false, error: folderLookup.error });
    }
    folder = folderLookup.item;
  }

  const subtaskCountBefore = task.children.length;
  let tagsBefore = [];
  try { tagsBefore = task.tags.map(function (t) { return t.name; }); } catch (e) { tagsBefore = []; }

  const destination = folder ? folder.ending : library.ending;

  let returned = null;
  try {
    returned = convertTasksToProjects([task], destination);
  } catch (e) {
    return JSON.stringify({
      success: false,
      id: taskId,
      name: taskName,
      verified: false,
      error: 'convertTasksToProjects failed: ' + ((e && e.message) ? e.message : String(e))
    });
  }

  // --- Read the result back; the returned array is only a hint. ---
  let project = null;
  try {
    if (returned && returned.length > 0 && returned[0]) { project = returned[0]; }
  } catch (e) { project = null; }

  // Strongest signal: the new project inherits the converted task's identifier.
  try {
    const byId = Project.byIdentifier(taskId);
    if (byId) { project = byId; }
  } catch (e) {}

  if (!project) {
    const named = flattenedProjects.filter(function (p) { return p.name === taskName; });
    if (named.length === 1) {
      project = named[0];
    } else if (named.length > 1) {
      // Several same-named projects: take the most recently added one, since
      // Project has no .added of its own (the root task carries it).
      let best = named[0];
      for (let i = 1; i < named.length; i++) {
        try {
          if (named[i].task.added && best.task.added && named[i].task.added > best.task.added) { best = named[i]; }
        } catch (e) {}
      }
      project = best;
      warnings.push('Several projects are named "' + taskName + '"; matched the most recently added one. Confirm in OmniFocus.');
    }
  }

  if (!project) {
    return JSON.stringify({
      success: false,
      id: taskId,
      name: taskName,
      verified: false,
      error: 'convertTasksToProjects returned without an identifiable project for task "' + taskName + '" (id ' + taskId + '). Check OmniFocus before retrying — the task may or may not have been converted.'
    });
  }

  const projectId = project.id.primaryKey;
  let rootTaskId = projectId;
  try { rootTaskId = project.task ? project.task.id.primaryKey : projectId; } catch (e) {}

  // The task must either be gone from flattenedTasks or now BE the project root
  // (root tasks are members of flattenedTasks and share the project's id).
  const stillListed = flattenedTasks.filter(function (t) { return t.id.primaryKey === taskId; }).length > 0;
  const identityOk = (!stillListed) || rootTaskId === taskId || projectId === taskId;

  let subtaskCountAfter = 0;
  try { subtaskCountAfter = project.task ? project.task.children.length : project.tasks.length; } catch (e) { subtaskCountAfter = 0; }
  const subtasksOk = subtaskCountAfter === subtaskCountBefore;
  if (!subtasksOk) {
    warnings.push('Subtask count changed during conversion: ' + String(subtaskCountBefore) + ' before, ' + String(subtaskCountAfter) + ' after.');
  }
  if (!identityOk) {
    warnings.push('The original task id ' + taskId + ' is still a separate task — the conversion may have copied rather than moved it.');
  }

  // Tags ride along on the new project root task. Only touch them when the
  // caller explicitly asked for them to be dropped.
  let tagsCleared = false;
  if (args.keepTags === false) {
    try { project.clearTags(); tagsCleared = true; } catch (e) { warnings.push('Could not clear tags on the new project: ' + ((e && e.message) ? e.message : String(e))); }
  }

  let tagsAfter = [];
  try { tagsAfter = project.tags.map(function (t) { return t.name; }); } catch (e) { tagsAfter = tagsBefore; }

  let folderName = null;
  try { folderName = project.parentFolder ? project.parentFolder.name : null; } catch (e) { folderName = null; }

  return JSON.stringify({
    success: true,
    id: projectId,
    name: project.name,
    folder: folderName,
    subtaskCount: subtaskCountAfter,
    subtaskCountBefore: subtaskCountBefore,
    tags: tagsAfter,
    tagsCleared: tagsCleared,
    verified: identityOk && subtasksOk,
    warnings: warnings
  });
`;

/**
 * Convert a task into a project, optionally filing it into a folder.
 * Runs as ONE OmniJS script: resolve, guard, convert, and verify in a single
 * evaluation so background sync cannot move the database underneath us.
 */
export async function convertTaskToProject(params: ConvertTaskToProjectParams): Promise<ConvertTaskToProjectResult> {
  const validation = validateConvertTaskToProjectParams(params);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const raw = await runOmniJs(CONVERT_TASK_TO_PROJECT_SCRIPT, {
      taskId: params.taskId,
      taskName: params.taskName,
      folderId: params.folderId,
      folderName: params.folderName,
      keepTags: params.keepTags
    });

    if (!raw || raw.success !== true) {
      return {
        success: false,
        id: raw?.id,
        name: raw?.name,
        verified: false,
        error: raw?.error || 'convert_task_to_project script returned no result'
      };
    }

    return {
      success: true,
      id: raw.id,
      name: raw.name,
      folder: raw.folder ?? null,
      subtaskCount: raw.subtaskCount,
      subtaskCountBefore: raw.subtaskCountBefore,
      tags: Array.isArray(raw.tags) ? raw.tags : undefined,
      tagsCleared: raw.tagsCleared === true,
      verified: raw.verified === true,
      warnings: Array.isArray(raw.warnings) && raw.warnings.length > 0 ? raw.warnings : undefined
    };
  } catch (error: any) {
    return {
      success: false,
      verified: false,
      error: error?.message || 'Unknown error in convertTaskToProject'
    };
  }
}
