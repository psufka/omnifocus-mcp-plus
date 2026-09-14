import { runOmniJs } from '../../utils/scriptExecution.js';

/**
 * Mark a task complete. An already-completed task returns `alreadyCompleted`.
 * Repeating tasks retain an active original, so completing them again advances
 * another occurrence. A lost response must not be blindly retried.
 *
 * The write is verified by reading the task back inside the SAME script: a
 * markComplete() that silently did nothing is reported as a failure instead of
 * being announced as success. Repeating tasks are the documented exception —
 * OmniFocus returns the task that was completed. For repetition, that is a new
 * completed clone; the original task remains active with its next dates.
 */
export async function completeTask(taskId: string): Promise<{
  success: boolean;
  id?: string;
  name?: string;
  alreadyCompleted?: boolean;
  verified?: boolean;
  nextOccurrenceId?: string;
  completedOccurrenceId?: string;
  error?: string;
}> {
  return await runOmniJs(COMPLETE_TASK_SCRIPT, { task_id: taskId });
}

export const COMPLETE_TASK_SCRIPT = `
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
    let completedOccurrenceId = null;
    const completed = (task.taskStatus === Task.Status.Completed) || task.completed === true;
    try {
      if (produced && produced.id && (produced.taskStatus === Task.Status.Completed || produced.completed === true)) {
        completedOccurrenceId = produced.id.primaryKey;
        if (!completed && task.taskStatus !== Task.Status.Dropped && task.repetitionRule && completedOccurrenceId !== taskId) {
          nextOccurrenceId = taskId;
        }
      }
    } catch (e) {}

    const verified = completed || completedOccurrenceId !== null;

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
      completedOccurrenceId: completedOccurrenceId || (completed ? taskId : undefined),
      nextOccurrenceId: nextOccurrenceId || undefined
    });
`;
