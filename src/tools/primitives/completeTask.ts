import { runOmniJs } from '../../utils/scriptExecution.js';

/**
 * Mark a task complete. Idempotent: completing an already-completed task is a
 * success with `alreadyCompleted: true`, not an error — a retry after a timeout
 * must not read as a failure.
 *
 * The write is verified by reading the task back inside the SAME script: a
 * markComplete() that silently did nothing is reported as a failure instead of
 * being announced as success. Repeating tasks are the documented exception —
 * OmniFocus completes this occurrence and returns a NEW task for the next one,
 * so a fresh occurrence id counts as verification.
 */
export async function completeTask(taskId: string): Promise<{
  success: boolean;
  id?: string;
  name?: string;
  alreadyCompleted?: boolean;
  verified?: boolean;
  nextOccurrenceId?: string;
  error?: string;
}> {
  const script = `
    // "[object Task.Status: Available]" -> "Available" (OmniJS enums have no .name).
    function __statusName(status) {
      try {
        var s = String(status);
        var i = s.indexOf(': ');
        if (i >= 0 && s.charAt(s.length - 1) === ']') { return s.slice(i + 2, -1); }
        return s;
      } catch (e) { return 'unknown'; }
    }

    const task = flattenedTasks.filter(t => t.id.primaryKey === args.task_id)[0];
    if (!task) return JSON.stringify({ success: false, error: 'Task not found with ID: ' + args.task_id });
    if (task.taskStatus === Task.Status.Completed) {
      return JSON.stringify({
        success: true,
        id: task.id.primaryKey,
        name: task.name,
        alreadyCompleted: true,
        verified: true
      });
    }

    const taskId = task.id.primaryKey;
    const taskName = task.name;

    let produced = null;
    try {
      produced = task.markComplete();
    } catch (e) {
      return JSON.stringify({
        success: false,
        id: taskId,
        name: taskName,
        verified: false,
        error: 'markComplete() failed: ' + ((e && e.message) ? e.message : String(e))
      });
    }

    // --- Read-back verification (same script; sync cannot intervene) ---
    let nextOccurrenceId = null;
    try {
      if (produced && produced.id && produced.id.primaryKey !== taskId) {
        nextOccurrenceId = produced.id.primaryKey;
      }
    } catch (e) {}

    const completed = (task.taskStatus === Task.Status.Completed) || task.completed === true;
    const verified = completed || nextOccurrenceId !== null;

    if (!verified) {
      return JSON.stringify({
        success: false,
        id: taskId,
        name: taskName,
        verified: false,
        error: 'markComplete() did not take effect: task "' + taskName + '" still reads as ' + __statusName(task.taskStatus) + '.'
      });
    }

    return JSON.stringify({
      success: true,
      id: taskId,
      name: taskName,
      alreadyCompleted: false,
      verified: true,
      nextOccurrenceId: nextOccurrenceId || undefined
    });
  `;
  return await runOmniJs(script, { task_id: taskId });
}
