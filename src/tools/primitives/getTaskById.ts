import { runOmniJs } from '../../utils/scriptExecution.js';

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
    let task;
    if (args.taskId) {
      task = flattenedTasks.filter(t => t.id.primaryKey === args.taskId)[0];
    } else {
      const matches = flattenedTasks.filter(t => t.name === args.taskName);
      if (matches.length > 1) {
        return JSON.stringify({ success: false, error: 'Ambiguous task name: ' + args.taskName + '. Multiple matches found; please use taskId.' });
      }
      task = matches[0];
    }
    if (!task) return JSON.stringify({ success: false, error: 'Task not found' });

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

  return await runOmniJs(script, params);
}
