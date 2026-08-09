import { runOmniJs } from '../../utils/scriptExecution.js';

/**
 * Mark a completed task incomplete. Idempotent: a task that is already
 * incomplete is a success with `alreadyIncomplete: true`, not an error — mirrors
 * completeTask so a retry after a timeout does not read as a failure.
 */
export async function uncompleteTask(taskId: string): Promise<{ success: boolean; id?: string; name?: string; alreadyIncomplete?: boolean; status?: string; error?: string }> {
  const script = `
    // OmniJS enum members have no .name — they stringify as
    // "[object Task.Status: Available]", so pull the member name out of that.
    function __statusName(status) {
      const str = String(status);
      const start = str.indexOf(': ');
      const end = str.lastIndexOf(']');
      return (start >= 0 && end > start) ? str.slice(start + 2, end) : str;
    }

    const task = flattenedTasks.filter(t => t.id.primaryKey === args.task_id)[0];
    if (!task) return JSON.stringify({ success: false, error: 'Task not found with ID: ' + args.task_id });
    if (task.taskStatus !== Task.Status.Completed) {
      return JSON.stringify({
        success: true,
        id: task.id.primaryKey,
        name: task.name,
        alreadyIncomplete: true,
        status: __statusName(task.taskStatus)
      });
    }
    task.markIncomplete();
    return JSON.stringify({
      success: true,
      id: task.id.primaryKey,
      name: task.name,
      alreadyIncomplete: false,
      status: __statusName(task.taskStatus)
    });
  `;
  return await runOmniJs(script, { task_id: taskId });
}
