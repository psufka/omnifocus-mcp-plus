import { runOmniJs } from '../../utils/scriptExecution.js';

export type RepetitionScheduleType = 'regularly' | 'from_completion' | 'defer_from_completion' | 'none';

export interface SetTaskRepetitionParams {
  task_id: string;
  rule_string?: string;
  schedule_type: RepetitionScheduleType;
}

/**
 * Set or clear a task's repetition rule.
 *
 * NOTE: OmniJS has no "due-after-completion" repetition method. The members of
 * Task.RepetitionMethod are None / Fixed / DeferUntilDate / DueDate (verified
 * against OmniFocus 185.19), and `new Task.RepetitionRule(rule, undefined)`
 * silently builds a *Fixed* rule — so the old mapping made "repeat after
 * completion" repeat on a fixed schedule instead. `DueDate` is OmniFocus's
 * "Due Again" (next due date measured from the completion date);
 * `DeferUntilDate` is "Defer Another".
 */
export async function setTaskRepetition(params: SetTaskRepetitionParams): Promise<{ success: boolean; id?: string; name?: string; repetitionRule?: string | null; scheduleType?: string; error?: string }> {
  const script = `
    const task = flattenedTasks.filter(t => t.id.primaryKey === args.task_id)[0];
    if (!task) return JSON.stringify({ success: false, error: 'Task not found with ID: ' + args.task_id });

    if (args.schedule_type === 'none') {
      task.repetitionRule = null;
      return JSON.stringify({
        success: true,
        id: task.id.primaryKey,
        name: task.name,
        repetitionRule: null,
        scheduleType: 'none'
      });
    }

    if (!args.rule_string) {
      return JSON.stringify({ success: false, error: 'rule_string is required when schedule_type is not none' });
    }

    // 'from_completion' -> DueDate ("Due Again"), 'defer_from_completion' ->
    // DeferUntilDate ("Defer Another"), anything else -> Fixed.
    let method;
    if (args.schedule_type === 'from_completion') {
      method = Task.RepetitionMethod.DueDate;
    } else if (args.schedule_type === 'defer_from_completion') {
      method = Task.RepetitionMethod.DeferUntilDate;
    } else {
      method = Task.RepetitionMethod.Fixed;
    }

    // A missing method would silently construct a Fixed rule — fail loudly instead.
    if (!method) {
      return JSON.stringify({ success: false, error: 'Unsupported schedule_type for this OmniFocus version: ' + args.schedule_type });
    }

    task.repetitionRule = new Task.RepetitionRule(args.rule_string, method);

    return JSON.stringify({
      success: true,
      id: task.id.primaryKey,
      name: task.name,
      repetitionRule: args.rule_string,
      scheduleType: args.schedule_type
    });
  `;
  return await runOmniJs(script, params);
}
