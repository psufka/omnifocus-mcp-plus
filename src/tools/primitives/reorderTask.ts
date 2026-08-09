import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

export interface ReorderTaskParams {
  taskId?: string;
  taskName?: string;
  beforeTaskId?: string;
  afterTaskId?: string;
  position?: 'beginning' | 'ending';
}

export async function reorderTask(params: ReorderTaskParams): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  const destCount = [
    params.beforeTaskId ? 1 : 0,
    params.afterTaskId ? 1 : 0,
    params.position ? 1 : 0
  ].reduce((sum, val) => sum + val, 0);

  if (destCount !== 1) {
    return { success: false, error: "Exactly one of beforeTaskId, afterTaskId, or position must be provided" };
  }

  const script = `
    ${OMNIJS_LOOKUP_HELPERS}

    // Identity key for a task's container. Verified against OmniFocus 185.19:
    //   - inbox task:            parent === null, inInbox === true
    //   - top-level project task: parent === the project's root Task, whose
    //                             primaryKey equals the project's own id
    //   - subtask:               parent === the containing Task
    // so parent id alone separates "top-level in project X" from "nested under
    // task Y", and both from the inbox.
    function __containerKey(t) {
      if (t.parent && t.parent.id) { return 'parent:' + t.parent.id.primaryKey; }
      if (t.inInbox) { return 'inbox'; }
      if (t.containingProject) { return 'project:' + t.containingProject.id.primaryKey; }
      return 'none';
    }

    function __containerLabel(t) {
      if (t.parent && t.parent.id) {
        if (t.containingProject && t.containingProject.id.primaryKey === t.parent.id.primaryKey) {
          return 'project "' + t.containingProject.name + '" (top level)';
        }
        return 'task "' + t.parent.name + '"';
      }
      if (t.inInbox) { return 'the inbox'; }
      if (t.containingProject) { return 'project "' + t.containingProject.name + '"'; }
      return 'an unknown container';
    }

    const allTasks = flattenedTasks.filter(() => true);

    // Find the task to reorder
    const resolved = __resolveByIdOrName(allTasks, args.taskId, args.taskName, 'Task');
    if (resolved.error) return JSON.stringify({ success: false, error: resolved.error });
    const task = resolved.item;

    // Determine the container (parent task or project)
    const parent = task.parent;
    const isParentTask = parent && parent.constructor === Task;
    const container = isParentTask ? parent : (task.containingProject || null);

    if (!container && !task.inInbox) {
      return JSON.stringify({ success: false, error: 'Cannot determine task container for reordering' });
    }

    if (args.beforeTaskId || args.afterTaskId) {
      const siblingId = args.beforeTaskId || args.afterTaskId;
      const field = args.beforeTaskId ? 'beforeTaskId' : 'afterTaskId';
      const sibling = allTasks.filter(t => t.id.primaryKey === siblingId)[0];
      if (!sibling) return JSON.stringify({ success: false, error: field + ' task not found: ' + siblingId });

      if (sibling.id.primaryKey === task.id.primaryKey) {
        return JSON.stringify({ success: false, error: field + ' refers to the task being reordered.' });
      }

      // reorder_task only reorders WITHIN a container. moveTasks() would happily
      // relocate the task into the reference task's project, which is a silent
      // cross-container move, so require true siblingship.
      if (__containerKey(task) !== __containerKey(sibling)) {
        return JSON.stringify({
          success: false,
          error: field + ' task "' + sibling.name + '" is not a sibling: it is in ' + __containerLabel(sibling) +
                 ' while "' + task.name + '" is in ' + __containerLabel(task) +
                 '. reorder_task only reorders within a container — use move_task to relocate the task first.'
        });
      }

      moveTasks([task], args.beforeTaskId ? sibling.before : sibling.after);
    } else if (args.position === 'beginning') {
      if (task.inInbox) {
        moveTasks([task], inbox.beginning);
      } else if (isParentTask) {
        moveTasks([task], parent.beginning);
      } else {
        moveTasks([task], container.beginning);
      }
    } else if (args.position === 'ending') {
      if (task.inInbox) {
        moveTasks([task], inbox.ending);
      } else if (isParentTask) {
        moveTasks([task], parent.ending);
      } else {
        moveTasks([task], container.ending);
      }
    }

    return JSON.stringify({
      success: true,
      id: task.id.primaryKey,
      name: task.name
    });
  `;

  try {
    return await runOmniJs(script, params);
  } catch (error: any) {
    return { success: false, error: error?.message || "Unknown error in reorderTask" };
  }
}
