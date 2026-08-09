import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

export interface DuplicateTaskParams {
  taskId?: string;
  taskName?: string;
  newName?: string;
  newProjectId?: string;
  newProjectName?: string;
  includeTags?: boolean;
  includeNote?: boolean;
}

/**
 * Duplicate a task.
 *
 * Uses OmniJS's native `duplicateTasks(tasks, position)` (Database.duplicateTasks,
 * verified against OmniFocus 185.19) rather than constructing a new Task and
 * hand-copying fields. The hand-copy approach silently dropped the repetition
 * rule, subtasks and notifications; the native call deep-copies everything.
 */
export async function duplicateTask(params: DuplicateTaskParams): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  const script = `
    ${OMNIJS_LOOKUP_HELPERS}

    // Find source task
    const allTasks = flattenedTasks.filter(() => true);
    const resolvedSource = __resolveByIdOrName(allTasks, args.taskId, args.taskName, 'Source task');
    if (resolvedSource.error) return JSON.stringify({ success: false, error: resolvedSource.error });
    const source = resolvedSource.item;

    // Determine destination
    let location;
    let destContainer;
    if (args.newProjectId || args.newProjectName) {
      const allProjects = flattenedProjects.filter(() => true);
      const resolvedProject = __resolveByIdOrName(allProjects, args.newProjectId, args.newProjectName, 'Destination project');
      if (resolvedProject.error) return JSON.stringify({ success: false, error: resolvedProject.error });
      destContainer = resolvedProject.item;
      location = destContainer.ending;
    } else if (source.containingProject) {
      destContainer = source.containingProject;
      location = destContainer.ending;
    } else {
      destContainer = inbox;
      location = inbox.ending;
    }

    function __destTaskIds() {
      const list = destContainer === inbox ? inbox.filter(() => true) : destContainer.tasks.filter(() => true);
      return list.map(t => t.id.primaryKey);
    }

    // Native deep copy: carries note, dates, flag, estimate, tags, repetition
    // rule, subtasks and notifications.
    const beforeIds = __destTaskIds();
    const duplicates = duplicateTasks([source], location);

    let newTask = (duplicates && duplicates.length > 0) ? duplicates[0] : null;
    if (!newTask) {
      // Defensive fallback in case a future OmniFocus build stops returning the
      // duplicates: diff the destination container's direct children.
      const beforeSet = {};
      for (const id of beforeIds) { beforeSet[id] = true; }
      const list = destContainer === inbox ? inbox.filter(() => true) : destContainer.tasks.filter(() => true);
      const added = list.filter(t => !beforeSet[t.id.primaryKey]);
      newTask = added.length > 0 ? added[added.length - 1] : null;
    }
    if (!newTask) {
      return JSON.stringify({ success: false, error: 'Duplicate was created but could not be located to apply overrides.' });
    }

    // Apply overrides on top of the deep copy
    if (args.newName) newTask.name = args.newName;
    if (args.includeNote === false) newTask.note = '';
    if (args.includeTags === false) newTask.clearTags();

    return JSON.stringify({
      success: true,
      id: newTask.id.primaryKey,
      name: newTask.name,
      sourceId: source.id.primaryKey,
      sourceName: source.name,
      subtaskCount: newTask.children.filter(() => true).length,
      hasRepetitionRule: !!newTask.repetitionRule,
      notificationCount: newTask.notifications ? newTask.notifications.length : 0
    });
  `;

  return await runOmniJs(script, params);
}
