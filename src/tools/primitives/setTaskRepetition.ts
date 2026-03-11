import { runOmniJs } from '../../utils/scriptExecution.js';

export interface SetTaskRepetitionParams {
  task_id: string;
  rule_string?: string;
  schedule_type: 'regularly' | 'from_completion' | 'none';
}

export async function setTaskRepetition(params: SetTaskRepetitionParams): Promise<{ success: boolean; id?: string; name?: string; repetitionRule?: string | null; error?: string }> {
  const script = `
    const task = flattenedTasks.filter(t => t.id.primaryKey === args.task_id)[0];
    if (!task) return JSON.stringify({ success: false, error: 'Task not found with ID: ' + args.task_id });

    if (args.schedule_type === 'none') {
      task.repetitionRule = null;
      return JSON.stringify({
        success: true,
        id: task.id.primaryKey,
        name: task.name,
        repetitionRule: null
      });
    }

    if (!args.rule_string) {
      return JSON.stringify({ success: false, error: 'rule_string is required when schedule_type is not none' });
    }

    const method = args.schedule_type === 'from_completion'
      ? Task.RepetitionMethod.DueAfterCompletion
      : Task.RepetitionMethod.Fixed;

    task.repetitionRule = new Task.RepetitionRule(args.rule_string, method);

    return JSON.stringify({
      success: true,
      id: task.id.primaryKey,
      name: task.name,
      repetitionRule: args.rule_string
    });
  `;
  return await runOmniJs(script, params);
}
