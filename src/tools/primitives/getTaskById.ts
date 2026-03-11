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
  deferDate?: string;
  plannedDate?: string;
  flagged: boolean;
  completed: boolean;
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
      task = flattenedTasks.filter(t => t.name === args.taskName)[0];
    }
    if (!task) return JSON.stringify({ success: false, error: 'Task not found' });

    const parent = task.parent;
    const isParentTask = parent && parent.constructor === Task;
    const cp = task.containingProject;
    const children = task.children.filter(() => true);

    let plannedDate = null;
    try { plannedDate = task.plannedDate ? task.plannedDate.toISOString() : null; } catch(e) {}

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
        deferDate: task.deferDate ? task.deferDate.toISOString() : undefined,
        plannedDate: plannedDate || undefined,
        flagged: task.flagged,
        completed: task.taskStatus === Task.Status.Completed,
        estimatedMinutes: task.estimatedMinutes || undefined
      }
    });
  `;

  return await runOmniJs(script, params);
}
