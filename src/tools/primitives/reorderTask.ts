import { runOmniJs } from '../../utils/scriptExecution.js';

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
    // Find the task to reorder
    let task;
    if (args.taskId) {
      task = flattenedTasks.filter(t => t.id.primaryKey === args.taskId)[0];
    } else {
      const matches = flattenedTasks.filter(t => t.name === args.taskName);
      if (matches.length > 1) {
        return JSON.stringify({ success: false, error: 'Ambiguous task name: multiple matches found. Please use taskId.' });
      }
      task = matches[0];
    }
    if (!task) return JSON.stringify({ success: false, error: 'Task not found' });

    // Determine the container (parent task or project)
    const parent = task.parent;
    const isParentTask = parent && parent.constructor === Task;
    const container = isParentTask ? parent : (task.containingProject || null);

    if (!container && !task.inInbox) {
      return JSON.stringify({ success: false, error: 'Cannot determine task container for reordering' });
    }

    if (args.beforeTaskId) {
      const sibling = flattenedTasks.filter(t => t.id.primaryKey === args.beforeTaskId)[0];
      if (!sibling) return JSON.stringify({ success: false, error: 'beforeTaskId task not found' });
      moveTasks([task], sibling.before);
    } else if (args.afterTaskId) {
      const sibling = flattenedTasks.filter(t => t.id.primaryKey === args.afterTaskId)[0];
      if (!sibling) return JSON.stringify({ success: false, error: 'afterTaskId task not found' });
      moveTasks([task], sibling.after);
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
