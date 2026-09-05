import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

export interface GetTaskByIdParams {
  taskId?: string;
  taskName?: string;
}

export interface TaskInfo {
  id: string;
  name: string;
  note: string;
  parentId?: string;
  parentName?: string;
  projectId?: string;
  projectName?: string;
  hasChildren: boolean;
  childrenCount: number;
  tags: string[];
  dueDate?: string;
  effectiveDueDate?: string;
  deferDate?: string;
  effectiveDeferDate?: string;
  plannedDate?: string;
  flagged: boolean;
  completed: boolean;
  dropped: boolean;
  taskStatus: string;
  estimatedMinutes?: number;
}

export async function getTaskById(params: GetTaskByIdParams): Promise<{ success: boolean, task?: TaskInfo, error?: string }> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  const script = `
    ${OMNIJS_LOOKUP_HELPERS}

    // Shared strict lookup: byIdentifier fast path, a stale ID is an error that
    // never falls back to the name, an ambiguous name lists every match, and a
    // name matching one active plus stale copies resolves to the active one.
    const lookup = __resolveByIdOrName(flattenedTasks, args.taskId || null, args.taskName || null, 'Task');
    if (lookup.error) {
      return JSON.stringify({ success: false, error: lookup.error });
    }
    const task = lookup.item;

    const parent = task.parent;
    const isParentTask = parent && parent.constructor === Task;
    const cp = task.containingProject;
    const children = task.children.filter(() => true);

    let plannedDate = null;
    try { plannedDate = task.plannedDate ? task.plannedDate.toISOString() : null; } catch(e) {}

    // Full status string, same mapping list_subtasks returns — a completed
    // boolean alone cannot distinguish Dropped from Available.
    const statusMap = {
      [Task.Status.Available]: 'Available',
      [Task.Status.Blocked]: 'Blocked',
      [Task.Status.Completed]: 'Completed',
      [Task.Status.Dropped]: 'Dropped',
      [Task.Status.DueSoon]: 'DueSoon',
      [Task.Status.Next]: 'Next',
      [Task.Status.Overdue]: 'Overdue'
    };

    return JSON.stringify({
      success: true,
      task: {
        id: task.id.primaryKey,
        name: task.name,
        note: task.note || '',
        parentId: isParentTask ? parent.id.primaryKey : undefined,
        parentName: isParentTask ? parent.name : undefined,
        projectId: cp ? cp.id.primaryKey : undefined,
        projectName: cp ? cp.name : undefined,
        hasChildren: children.length > 0,
        childrenCount: children.length,
        tags: task.tags.map(t => t.name),
        dueDate: task.dueDate ? task.dueDate.toISOString() : undefined,
        effectiveDueDate: task.effectiveDueDate ? task.effectiveDueDate.toISOString() : undefined,
        deferDate: task.deferDate ? task.deferDate.toISOString() : undefined,
        effectiveDeferDate: task.effectiveDeferDate ? task.effectiveDeferDate.toISOString() : undefined,
        plannedDate: plannedDate || undefined,
        flagged: task.flagged,
        completed: task.taskStatus === Task.Status.Completed,
        dropped: task.taskStatus === Task.Status.Dropped,
        taskStatus: statusMap[task.taskStatus] || 'Unknown',
        estimatedMinutes: task.estimatedMinutes || undefined
      }
    });
  `;

  return await runOmniJs(script, params, { readOnly: true });
}
