import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { OMNIJS_TAG_HELPERS } from '../../utils/omniJsTags.js';
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
  tagIds?: string[];
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
 * OmniJS source for placement resolution and post-write verification, shared by
 * add_omnifocus_task and all three batch tools (it lives here, next to
 * __createTask, so the resolve step a dry run performs is byte-for-byte the one
 * the real write performs).
 *
 * Two jobs:
 *   1. `__resolveTaskPlacement` / `__resolveProjectPlacement` / `__resolveTagsSpec`
 *      answer "where would this go / which tags are missing" WITHOUT writing.
 *      A dry run stops after this step; a real run hands the resolved placement
 *      straight to the create helper.
 *   2. `__verifyTaskPlacement` / `__verifyProjectPlacement` read the object back
 *      after the write and compare its ACTUAL container against the requested
 *      one. Upstream once shipped schema drift that silently routed every
 *      batched task to the inbox while reporting success — this is what makes
 *      that class of bug loud instead of invisible.
 *
 * Requires OMNIJS_LOOKUP_HELPERS to be prepended. Written without template
 * literals, backslashes or '$' so the runOmniJs escaping layer leaves it alone.
 */
export const OMNIJS_PLACEMENT_HELPERS = `
  ${OMNIJS_TAG_HELPERS}
  // A placement carries an OmniJS insertion point in .location that must never
  // be serialized (JSON.stringify on an OmniJS object yields {}).
  function __publicPlacement(p) {
    if (!p) { return null; }
    var out = { kind: p.kind };
    if (p.id) { out.id = p.id; }
    if (p.name) { out.name = p.name; }
    if (p.tempId) { out.tempId = p.tempId; }
    if (p.pending === true) { out.pending = true; }
    return out;
  }

  function __placementLabel(p) {
    if (!p) { return 'an unknown location'; }
    if (p.kind === 'inbox') { return 'the inbox'; }
    if (p.kind === 'library') { return 'the library top level'; }
    var label = p.name ? '"' + p.name + '"' : (p.id ? p.id : '(unnamed)');
    if (p.kind === 'parentTask') { return 'parent task ' + label; }
    if (p.kind === 'project') { return 'project ' + label; }
    if (p.kind === 'folder') { return 'folder ' + label; }
    return p.kind + ' ' + label;
  }

  function __placementMatches(requested, actual) {
    if (!requested || !actual) { return false; }
    if (requested.kind !== actual.kind) { return false; }
    if (requested.kind === 'inbox' || requested.kind === 'library') { return true; }
    if (requested.id && actual.id) { return requested.id === actual.id; }
    return requested.name === actual.name;
  }

  // inInbox is true only for a DIRECT child of the inbox; an inbox subtask
  // reports its parent task instead.
  function __isDirectInboxItem(task) {
    var flag = false;
    try { flag = (task.inInbox === true); } catch (e) { flag = false; }
    return flag;
  }

  function __actualTaskPlacement(task) {
    var proj = null;
    try { proj = task.containingProject; } catch (e) { proj = null; }
    var projId = null;
    var projName = null;
    if (proj) {
      try { projId = proj.id.primaryKey; projName = proj.name; } catch (e) { projId = null; }
    }

    if (!projId && __isDirectInboxItem(task)) { return { kind: 'inbox', id: null, name: null }; }

    var parent = null;
    try { parent = task.parent; } catch (e) { parent = null; }
    var parentIsTask = false;
    try { parentIsTask = !!(parent && typeof Task !== 'undefined' && parent.constructor === Task); } catch (e) { parentIsTask = false; }
    var parentId = null;
    var parentName = null;
    if (parentIsTask) {
      try { parentId = parent.id.primaryKey; parentName = parent.name; } catch (e) { parentId = null; }
    }

    // A project's root task shares the project's primaryKey, so a task sitting
    // directly under a project reports that project as its parent.
    if (parentId && parentId !== projId) { return { kind: 'parentTask', id: parentId, name: parentName }; }
    if (projId) { return { kind: 'project', id: projId, name: projName }; }
    return { kind: 'inbox', id: null, name: null };
  }

  function __actualProjectPlacement(project) {
    var folder = null;
    try { folder = project.parentFolder; } catch (e) { folder = null; }
    if (folder) {
      var fid = null;
      var fname = null;
      try { fid = folder.id.primaryKey; fname = folder.name; } catch (e) { fid = null; }
      return { kind: 'folder', id: fid, name: fname };
    }
    return { kind: 'library', id: null, name: null };
  }

  function __resolveTaskPlacement(spec) {
    if (spec.parentTaskId || spec.parentTaskName) {
      var parentLookup = __resolveByIdOrName(flattenedTasks, spec.parentTaskId, spec.parentTaskName, 'Parent task');
      if (parentLookup.error) { return { error: parentLookup.error }; }
      var parentTask = parentLookup.item;
      return { placement: { kind: 'parentTask', id: parentTask.id.primaryKey, name: parentTask.name, location: parentTask.ending } };
    }
    if (spec.projectName) {
      var projectLookup = __resolveByIdOrName(flattenedProjects, null, spec.projectName, 'Project');
      if (projectLookup.error) { return { error: projectLookup.error }; }
      var project = projectLookup.item;
      return { placement: { kind: 'project', id: project.id.primaryKey, name: project.name, location: project.ending } };
    }
    return { placement: { kind: 'inbox', id: null, name: null, location: inbox.ending } };
  }

  function __resolveProjectPlacement(spec) {
    if (spec.folderName) {
      var folderLookup = __resolveByNameOrId(flattenedFolders, spec.folderName, 'Folder');
      if (folderLookup.error) { return { error: folderLookup.error }; }
      var folder = folderLookup.item;
      return { placement: { kind: 'folder', id: folder.id.primaryKey, name: folder.name, location: folder.ending } };
    }
    return { placement: { kind: 'library', id: null, name: null, location: library.ending } };
  }

  // Pure read: which of these tag names exist already, and which would have to
  // be created. Lets a dry run report new tags without creating any.
  function __resolveTagsSpec(tagNames, tagIds) {
    return __resolveTagPlan(tagNames, tagIds, true);
  }

  // Returns { exists, verified, actual, warning }. exists=false means the write
  // did not land at all (a hard failure); verified=false with exists=true means
  // it landed somewhere other than requested.
  function __verifyTaskPlacement(task, requested) {
    var out = { exists: false, verified: false, actual: null, warning: null };
    var id = null;
    try { id = task.id.primaryKey; } catch (e) { id = null; }
    if (!id) {
      out.warning = 'Task could not be identified after the write (no primaryKey).';
      return out;
    }

    var fetched = task;
    if (typeof Task !== 'undefined' && typeof Task.byIdentifier === 'function') {
      fetched = Task.byIdentifier(id);
    }
    if (!fetched) {
      out.warning = 'Task ' + id + ' does not exist after the write (read-back returned null).';
      return out;
    }

    out.exists = true;
    out.actual = __actualTaskPlacement(fetched);
    if (__placementMatches(requested, out.actual)) {
      out.verified = true;
      return out;
    }
    out.warning = 'Placement not verified: requested ' + __placementLabel(requested) + ' but the task is in ' + __placementLabel(out.actual) + '.';
    return out;
  }

  function __verifyProjectPlacement(project, requested) {
    var out = { exists: false, verified: false, actual: null, warning: null };
    var id = null;
    try { id = project.id.primaryKey; } catch (e) { id = null; }
    if (!id) {
      out.warning = 'Project could not be identified after the write (no primaryKey).';
      return out;
    }

    var fetched = project;
    if (typeof Project !== 'undefined' && typeof Project.byIdentifier === 'function') {
      fetched = Project.byIdentifier(id);
    }
    if (!fetched) {
      out.warning = 'Project ' + id + ' does not exist after the write (read-back returned null).';
      return out;
    }

    out.exists = true;
    out.actual = __actualProjectPlacement(fetched);
    if (__placementMatches(requested, out.actual)) {
      out.verified = true;
      return out;
    }
    out.warning = 'Placement not verified: requested ' + __placementLabel(requested) + ' but the project is in ' + __placementLabel(out.actual) + '.';
    return out;
  }
`;

/**
 * OmniJS source for `__createTask(spec, warnings, created, presetPlacement)` —
 * the single implementation of task creation, shared by add_omnifocus_task and
 * batch_add_items so the two can never drift. Returns { task, placement } or
 * { error }; failures to write plannedDate (older OmniFocus builds have no such
 * property) are pushed onto `warnings` rather than silently swallowed.
 *
 * `created` (optional) is the batch's creation-order ledger used for atomic
 * rollback — every object this helper brings into existence, including tags it
 * has to create, is appended to it.
 *
 * Requires OMNIJS_LOOKUP_HELPERS and OMNIJS_PLACEMENT_HELPERS to be prepended.
 * Written without template literals, backslashes or '$' so the runOmniJs
 * escaping layer leaves it alone.
 */
export const OMNIJS_CREATE_TASK_HELPER = `
  function __applyTagsTo(item, plan, created) {
    __materializeTagPlan(plan, created).forEach(function (tag) { item.addTag(tag); });
  }

  function __setPlannedDate(item, value, warnings) {
    try {
      item.plannedDate = new Date(value);
    } catch (e) {
      warnings.push('plannedDate was not applied (this OmniFocus version may not support planned dates): ' + ((e && e.message) ? e.message : e));
    }
  }

  function __applyTaskFields(task, spec, warnings, created, tagPlan) {
    if (spec.note !== undefined) { task.note = spec.note; }
    if (spec.dueDate) { task.dueDate = new Date(spec.dueDate); }
    if (spec.deferDate) { task.deferDate = new Date(spec.deferDate); }
    if (spec.plannedDate) { __setPlannedDate(task, spec.plannedDate, warnings); }
    if (spec.flagged !== undefined) { task.flagged = spec.flagged; }
    if (spec.estimatedMinutes !== undefined) { task.estimatedMinutes = spec.estimatedMinutes; }
    __applyTagsTo(task, tagPlan, created);
  }

  function __createTask(spec, warnings, created, presetPlacement) {
    var placement = presetPlacement;
    if (!placement) {
      var resolved = __resolveTaskPlacement(spec);
      if (resolved.error) { return { error: resolved.error }; }
      placement = resolved.placement;
    }

    var tagPlan = __resolveTagsSpec(spec.tags, spec.tagIds);
    if (tagPlan.error) return { error: tagPlan.error };
    var task = new Task(spec.name, placement.location);
    if (created) { created.push({ obj: task, kind: 'task', name: spec.name }); }

    __applyTaskFields(task, spec, warnings, created, tagPlan);

    return { task: task, placement: placement, tagPlan: tagPlan };
  }
`;

/**
 * OmniJS source for `__createProject(spec, warnings, created, presetPlacement)`.
 * Shared by single-project and batch creation inside one OmniJS evaluation. Requires OMNIJS_PLACEMENT_HELPERS and OMNIJS_CREATE_TASK_HELPER.
 */
export const OMNIJS_CREATE_PROJECT_HELPER = `
  function __createProject(spec, warnings, created, presetPlacement) {
    var placement = presetPlacement;
    if (!placement) {
      var resolved = __resolveProjectPlacement(spec);
      if (resolved.error) { return { error: resolved.error }; }
      placement = resolved.placement;
    }

    var tagPlan = __resolveTagsSpec(spec.tags, spec.tagIds);
    if (tagPlan.error) return { error: tagPlan.error };
    var project = new Project(spec.name, placement.location);
    if (created) { created.push({ obj: project, kind: 'project', name: spec.name }); }

    if (spec.note !== undefined) { project.note = spec.note; }
    if (spec.dueDate) { project.dueDate = new Date(spec.dueDate); }
    if (spec.deferDate) { project.deferDate = new Date(spec.deferDate); }
    if (spec.plannedDate) { __setPlannedDate(project, spec.plannedDate, warnings); }
    if (spec.flagged !== undefined) { project.flagged = spec.flagged; }
    if (spec.estimatedMinutes !== undefined) { project.estimatedMinutes = spec.estimatedMinutes; }
    project.sequential = spec.sequential === true;
    __applyTagsTo(project, tagPlan, created);

    return { project: project, placement: placement, tagPlan: tagPlan };
  }
`;

// The script is static — every user value arrives through the injected `args`
// object — so it is built once at module load.
export const ADD_TASK_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${OMNIJS_PLACEMENT_HELPERS}
  ${OMNIJS_CREATE_TASK_HELPER}

  const warnings = [];
  const created = __createTask(args, warnings);
  if (created.error) {
    return JSON.stringify({ success: false, verified: false, error: created.error });
  }

  // Read the task back in THIS script and confirm it landed where it was asked
  // to. Background sync mutates the database between script invocations, so a
  // second round-trip would be verifying a different database state.
  const check = __verifyTaskPlacement(created.task, created.placement);
  if (!__verifyTagPlan(created.task, created.tagPlan)) {
    check.verified = false;
    check.warning = 'Tag verification failed: requested tag IDs were not all retained. Check mutually exclusive tag groups.';
  }
  if (!check.exists) {
    return JSON.stringify({ success: false, verified: false, error: check.warning });
  }

  return JSON.stringify({
    success: true,
    taskId: created.task.id.primaryKey,
    name: created.task.name,
    warnings: warnings,
    verified: check.verified,
    warning: check.warning,
    requestedPlacement: __publicPlacement(created.placement),
    actualPlacement: __publicPlacement(check.actual),
    tagIds: __tagIds(created.task)
  });
`;

export interface AddOmniFocusTaskResult {
  success: boolean;
  taskId?: string;
  tagIds?: string[];
  name?: string;
  warnings?: string[];
  error?: string;
  /** Read-back inside the same script confirmed existence AND placement. */
  verified?: boolean;
  /** Set when the task exists but landed outside the requested container. */
  warning?: string;
  requestedPlacement?: { kind: string; id?: string; name?: string };
  actualPlacement?: { kind: string; id?: string; name?: string };
}

/**
 * Add a task to OmniFocus
 */
export async function addOmniFocusTask(params: AddOmniFocusTaskParams): Promise<AddOmniFocusTaskResult> {
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
      tagIds: result.tagIds,
      name: result.name,
      warnings: Array.isArray(result.warnings) && result.warnings.length > 0 ? result.warnings : undefined,
      error: result.error,
      verified: typeof result.verified === 'boolean' ? result.verified : undefined,
      warning: typeof result.warning === 'string' && result.warning ? result.warning : undefined,
      requestedPlacement: result.requestedPlacement || undefined,
      actualPlacement: result.actualPlacement || undefined
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Unknown error in addOmniFocusTask"
    };
  }
}
