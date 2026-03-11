import { runOmniJs } from '../../utils/scriptExecution.js';

export interface ListSubtasksParams {
  taskId?: string;
  taskName?: string;
  recursive?: boolean;
}

export async function listSubtasks(params: ListSubtasksParams): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  const script = `
    const statusMap = {
      [Task.Status.Available]: "Available",
      [Task.Status.Blocked]: "Blocked",
      [Task.Status.Completed]: "Completed",
      [Task.Status.Dropped]: "Dropped",
      [Task.Status.DueSoon]: "DueSoon",
      [Task.Status.Next]: "Next",
      [Task.Status.Overdue]: "Overdue"
    };

    function formatDate(d) { return d ? d.toISOString() : null; }

    function mapTask(task, depth, parentId) {
      const children = task.children.filter(() => true);
      const result = {
        id: task.id.primaryKey,
        name: task.name,
        note: task.note || '',
        taskStatus: statusMap[task.taskStatus] || 'Unknown',
        flagged: task.flagged,
        dueDate: formatDate(task.dueDate),
        effectiveDueDate: formatDate(task.effectiveDueDate),
        deferDate: formatDate(task.deferDate),
        effectiveDeferDate: formatDate(task.effectiveDeferDate),
        tags: task.tags.map(t => t.name),
        hasChildren: children.length > 0,
        childrenCount: children.length,
        estimatedMinutes: task.estimatedMinutes || null,
        depth: depth,
        parentId: parentId
      };
      return result;
    }

    function collectDescendants(task, depth, parentId, maxDepth) {
      if (depth > maxDepth) return [];
      const children = task.children.filter(() => true);
      let results = [];
      for (const child of children) {
        results.push(mapTask(child, depth, parentId));
        if (args.recursive) {
          results = results.concat(collectDescendants(child, depth + 1, child.id.primaryKey, maxDepth));
        }
      }
      return results;
    }

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

    const subtasks = collectDescendants(task, 0, task.id.primaryKey, 10);

    return JSON.stringify({
      success: true,
      parentId: task.id.primaryKey,
      parentName: task.name,
      subtaskCount: subtasks.length,
      recursive: !!args.recursive,
      subtasks: subtasks
    });
  `;

  return await runOmniJs(script, params);
}
