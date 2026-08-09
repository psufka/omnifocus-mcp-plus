import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { toLocalDateTimeString } from '../../utils/localDate.js';

// Interface for task creation parameters
export interface AddOmniFocusTaskParams {
  name: string;
  note?: string;
  dueDate?: string; // ISO date string
  deferDate?: string; // ISO date string
  plannedDate?: string; // ISO date string
  flagged?: boolean;
  estimatedMinutes?: number;
  tags?: string[]; // Tag names
  projectName?: string; // Project name to add task to
  parentTaskId?: string; // Parent task ID for subtask creation
  parentTaskName?: string; // Parent task name for subtask creation (alternative to ID)
}

/**
 * Normalize the date fields of a creation spec so a bare 'YYYY-MM-DD' means
 * local midnight instead of UTC midnight (which lands on the previous evening
 * for every timezone west of UTC). Always call this before handing dates to
 * OmniJS — `new Date(...)` inside the script has the same UTC-parsing rule.
 */
export function normalizeItemDates<T extends { dueDate?: string; deferDate?: string; plannedDate?: string }>(item: T): T {
  const normalized: T = { ...item };
  if (normalized.dueDate) normalized.dueDate = toLocalDateTimeString(normalized.dueDate);
  if (normalized.deferDate) normalized.deferDate = toLocalDateTimeString(normalized.deferDate);
  if (normalized.plannedDate) normalized.plannedDate = toLocalDateTimeString(normalized.plannedDate);
  return normalized;
}

/**
 * Validate task creation parameters (parent/project conflicts). Pure and
 * synchronous so batch_add_items can pre-flight every item with the exact same
 * rules the single-task tool applies.
 */
export function validateAddTaskParams(params: AddOmniFocusTaskParams): { valid: boolean, error?: string } {
  if (!params.name) {
    return {
      valid: false,
      error: "Task name is required."
    };
  }

  if (params.parentTaskId && params.parentTaskName) {
    return {
      valid: false,
      error: "Cannot specify both parentTaskId and parentTaskName. Please use only one."
    };
  }

  if ((params.parentTaskId || params.parentTaskName) && params.projectName) {
    return {
      valid: false,
      error: "Cannot specify both parent task and project. Subtasks inherit project from their parent."
    };
  }

  return { valid: true };
}

/**
 * OmniJS source for `__createTask(spec, warnings)` — the single implementation
 * of task creation, shared by add_omnifocus_task and batch_add_items so the two
 * can never drift. Returns { task } or { error }; failures to write plannedDate
 * (older OmniFocus builds have no such property) are pushed onto `warnings`
 * rather than silently swallowed.
 *
 * Requires OMNIJS_LOOKUP_HELPERS to be prepended. Written without template
 * literals, backslashes or '$' so the runOmniJs escaping layer leaves it alone.
 */
export const OMNIJS_CREATE_TASK_HELPER = `
  function __applyTagsTo(item, tagNames) {
    for (var ti = 0; ti < tagNames.length; ti++) {
      var tagName = tagNames[ti];
      var tag = flattenedTags.filter(function (t) { return t.name === tagName; })[0];
      if (!tag) { tag = new Tag(tagName); }
      item.addTag(tag);
    }
  }

  function __setPlannedDate(item, value, warnings) {
    try {
      item.plannedDate = new Date(value);
    } catch (e) {
      warnings.push('plannedDate was not applied (this OmniFocus version may not support planned dates): ' + ((e && e.message) ? e.message : e));
    }
  }

  function __createTask(spec, warnings) {
    var location;
    if (spec.parentTaskId || spec.parentTaskName) {
      var parentLookup = __resolveByIdOrName(flattenedTasks, spec.parentTaskId, spec.parentTaskName, 'Parent task');
      if (parentLookup.error) { return { error: parentLookup.error }; }
      location = parentLookup.item.ending;
    } else if (spec.projectName) {
      var projectLookup = __resolveByIdOrName(flattenedProjects, null, spec.projectName, 'Project');
      if (projectLookup.error) { return { error: projectLookup.error }; }
      location = projectLookup.item.ending;
    } else {
      location = inbox.ending;
    }

    var task = new Task(spec.name, location);

    if (spec.note !== undefined) { task.note = spec.note; }
    if (spec.dueDate) { task.dueDate = new Date(spec.dueDate); }
    if (spec.deferDate) { task.deferDate = new Date(spec.deferDate); }
    if (spec.plannedDate) { __setPlannedDate(task, spec.plannedDate, warnings); }
    if (spec.flagged !== undefined) { task.flagged = spec.flagged; }
    if (spec.estimatedMinutes !== undefined) { task.estimatedMinutes = spec.estimatedMinutes; }
    if (spec.tags && spec.tags.length > 0) { __applyTagsTo(task, spec.tags); }

    return { task: task };
  }
`;

// The script is static — every user value arrives through the injected `args`
// object — so it is built once at module load.
export const ADD_TASK_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${OMNIJS_CREATE_TASK_HELPER}

  const warnings = [];
  const created = __createTask(args, warnings);
  if (created.error) {
    return JSON.stringify({ success: false, error: created.error });
  }

  return JSON.stringify({
    success: true,
    taskId: created.task.id.primaryKey,
    name: created.task.name,
    warnings: warnings
  });
`;

/**
 * Add a task to OmniFocus
 */
export async function addOmniFocusTask(params: AddOmniFocusTaskParams): Promise<{ success: boolean, taskId?: string, name?: string, warnings?: string[], error?: string }> {
  try {
    // Validate parent task parameters
    const validation = validateAddTaskParams(params);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const result = await runOmniJs(ADD_TASK_SCRIPT, normalizeItemDates(params));
    return {
      success: result.success,
      taskId: result.taskId,
      name: result.name,
      warnings: Array.isArray(result.warnings) && result.warnings.length > 0 ? result.warnings : undefined,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Unknown error in addOmniFocusTask"
    };
  }
}
