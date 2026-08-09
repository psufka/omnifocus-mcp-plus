import { runOmniJs } from '../../utils/scriptExecution.js';

/**
 * Mark a task complete. Idempotent: completing an already-completed task is a
 * success with `alreadyCompleted: true`, not an error — a retry after a timeout
 * must not read as a failure.
 */
export async function completeTask(taskId: string): Promise<{ success: boolean; id?: string; name?: string; alreadyCompleted?: boolean; error?: string }> {
  const script = `
    const task = flattenedTasks.filter(t => t.id.primaryKey === args.task_id)[0];
    if (!task) return JSON.stringify({ success: false, error: 'Task not found with ID: ' + args.task_id });
    if (task.taskStatus === Task.Status.Completed) {
      return JSON.stringify({
        success: true,
        id: task.id.primaryKey,
        name: task.name,
        alreadyCompleted: true
      });
    }
    task.markComplete();
    return JSON.stringify({
      success: true,
      id: task.id.primaryKey,
      name: task.name,
      alreadyCompleted: false
    });
  `;
  return await runOmniJs(script, { task_id: taskId });
}
