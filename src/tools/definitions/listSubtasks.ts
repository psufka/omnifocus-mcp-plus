import { z } from 'zod';
import { listSubtasks } from '../primitives/listSubtasks.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  taskId: z.string().optional().describe("The ID of the parent task"),
  taskName: z.string().optional().describe("The name of the parent task (alternative to taskId)"),
  recursive: z.boolean().optional().describe("Include all descendants, not just direct children (default: false)")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    if (!args.taskId && !args.taskName) {
      return {
        content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }],
        isError: true
      };
    }

    const result = await listSubtasks(args);

    if (result.success) {
      let output = `📋 **Subtasks of "${result.parentName}"** [${result.parentId}]\n`;
      output += `Found ${result.subtaskCount} subtask${result.subtaskCount === 1 ? '' : 's'}`;
      if (result.recursive) output += ' (recursive)';
      output += ':\n\n';

      if (result.subtasks.length === 0) {
        output += 'No subtasks found.\n';
      } else {
        for (const task of result.subtasks) {
          const indent = '  '.repeat(task.depth);
          const flag = task.flagged ? '🚩 ' : '';
          const statusEmoji = task.taskStatus === 'Completed' ? '✅' :
            task.taskStatus === 'Dropped' ? '⚫' :
            task.taskStatus === 'Blocked' ? '🔴' :
            task.taskStatus === 'DueSoon' ? '🟡' :
            task.taskStatus === 'Overdue' ? '🔴' : '⚪';

          output += `${indent}${statusEmoji} ${flag}${task.name} [${task.id}]`;

          if (task.dueDate) {
            const d = new Date(task.dueDate).toLocaleDateString();
            output += ` 📅 ${d}`;
          } else if (task.effectiveDueDate) {
            const d = new Date(task.effectiveDueDate).toLocaleDateString();
            output += ` 📅 ${d} (eff)`;
          }

          if (task.hasChildren) {
            output += ` [${task.childrenCount} children]`;
          }

          if (task.tags.length > 0) {
            output += ` 🏷 ${task.tags.join(', ')}`;
          }

          output += '\n';
        }
      }

      return { content: [{ type: "text" as const, text: output }] };
    }

    return {
      content: [{ type: "text" as const, text: `Error: ${result.error}` }],
      isError: true
    };
  } catch (err: unknown) {
    return {
      content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
      isError: true
    };
  }
}
