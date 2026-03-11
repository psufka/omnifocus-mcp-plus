import { runOmniJs } from '../../utils/scriptExecution.js';

export async function uncompleteTask(taskId: string): Promise<{ success: boolean; id?: string; name?: string; error?: string }> {
  const script = `
    const task = flattenedTasks.filter(t => t.id.primaryKey === args.task_id)[0];
    if (!task) return JSON.stringify({ success: false, error: 'Task not found with ID: ' + args.task_id });
    if (task.taskStatus !== Task.Status.Completed) {
      return JSON.stringify({ success: false, error: 'Task is not completed (status: ' + task.taskStatus.name + ')' });
    }
    task.markIncomplete();
    return JSON.stringify({
      success: true,
      id: task.id.primaryKey,
      name: task.name
    });
  `;
  return await runOmniJs(script, { task_id: taskId });
}
