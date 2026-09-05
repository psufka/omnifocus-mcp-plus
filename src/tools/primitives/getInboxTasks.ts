import { executeOmniFocusScript } from '../../utils/scriptExecution.js';

export interface GetInboxTasksOptions {
  hideCompleted?: boolean;
}

export async function getInboxTasks(options: GetInboxTasksOptions = {}): Promise<string> {
  const { hideCompleted = true } = options;

  try {
    // Execute the inbox script
    const result = await executeOmniFocusScript('@inboxTasks.js', {
      hideCompleted: hideCompleted
    }, { readOnly: true });

    // If result is an object, format it
    if (result && typeof result === 'object') {
      const data = result as any;

      if (data.error) {
        throw new Error(data.error);
      }

      // Format the inbox tasks
      let output = `# INBOX TASKS\n\n`;

      if (data.tasks && Array.isArray(data.tasks)) {
        if (data.tasks.length === 0) {
          output += '📪 Inbox is empty - well done!\n';
        } else {
          output += `📥 Found ${data.tasks.length} task${data.tasks.length === 1 ? '' : 's'} in inbox:\n\n`;

          data.tasks.forEach((task: any, index: number) => {
            const flagSymbol = task.flagged ? '🚩 ' : '';
            // Fall back to inherited dates with an '(eff)' marker, matching filter_tasks
            const dueDateStr = task.dueDate
              ? ` [DUE: ${new Date(task.dueDate).toLocaleDateString()}]`
              : (task.effectiveDueDate ? ` [DUE (eff): ${new Date(task.effectiveDueDate).toLocaleDateString()}]` : '');
            const deferDateStr = task.deferDate
              ? ` [DEFER: ${new Date(task.deferDate).toLocaleDateString()}]`
              : (task.effectiveDeferDate ? ` [DEFER (eff): ${new Date(task.effectiveDeferDate).toLocaleDateString()}]` : '');
            const plannedDateStr = task.plannedDate ? ` [PLAN: ${new Date(task.plannedDate).toLocaleDateString()}]` : '';
            const statusStr = task.taskStatus !== 'Available' ? ` (${task.taskStatus})` : '';
            const idStr = task.id ? ` [${task.id}]` : '';

            output += `${index + 1}. ${flagSymbol}${task.name}${idStr}${dueDateStr}${deferDateStr}${plannedDateStr}${statusStr}\n`;

            if (task.note && task.note.trim()) {
              output += `   📝 ${task.note.trim()}\n`;
            }
          });
        }
      } else {
        output += 'No inbox data available\n';
      }

      return output;
    }

    return 'Unexpected result format from OmniFocus';
  } catch (error) {
    console.error('Error in getInboxTasks:', error);
    throw new Error(`Failed to get inbox tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
