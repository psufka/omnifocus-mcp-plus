import { z } from 'zod';
import { getTaskById, GetTaskByIdParams } from '../primitives/getTaskById.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  taskId: z.string().optional().describe("The ID of the task to retrieve"),
  taskName: z.string().optional().describe("The name of the task to retrieve (alternative to taskId)")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    // Validate that either taskId or taskName is provided
    if (!args.taskId && !args.taskName) {
      return {
        content: [{
          type: "text" as const,
          text: "Error: Either taskId or taskName must be provided."
        }],
        isError: true
      };
    }

    // Call the getTaskById function
    const result = await getTaskById(args as GetTaskByIdParams);

    if (result.success && result.task) {
      const task = result.task;

      // Format task information for display
      let infoText = `📋 **Task Information**\n`;
      infoText += `• **Name**: ${task.name}\n`;
      infoText += `• **ID**: ${task.id}\n`;

      if (task.note) {
        infoText += `• **Note**: ${task.note}\n`;
      }

      if (task.parentId && task.parentName) {
        infoText += `• **Parent Task**: ${task.parentName} (${task.parentId})\n`;
      }

      if (task.projectId && task.projectName) {
        infoText += `• **Project**: ${task.projectName} (${task.projectId})\n`;
      }

      if (task.dueDate) {
        const d = new Date(task.dueDate);
        infoText += `• **Due**: ${isNaN(d.getTime()) ? task.dueDate : d.toLocaleString()}\n`;
      }
      if (task.effectiveDueDate && task.effectiveDueDate !== task.dueDate) {
        const d = new Date(task.effectiveDueDate);
        infoText += `• **Effective Due**: ${isNaN(d.getTime()) ? task.effectiveDueDate : d.toLocaleString()} (inherited)\n`;
      }

      if (task.deferDate) {
        const d = new Date(task.deferDate);
        infoText += `• **Defer**: ${isNaN(d.getTime()) ? task.deferDate : d.toLocaleString()}\n`;
      }
      if (task.effectiveDeferDate && task.effectiveDeferDate !== task.deferDate) {
        const d = new Date(task.effectiveDeferDate);
        infoText += `• **Effective Defer**: ${isNaN(d.getTime()) ? task.effectiveDeferDate : d.toLocaleString()} (inherited)\n`;
      }

      if (task.plannedDate) {
        const d = new Date(task.plannedDate);
        infoText += `• **Planned**: ${isNaN(d.getTime()) ? task.plannedDate : d.toLocaleString()}\n`;
      }

      infoText += `• **Has Children**: ${task.hasChildren ? `Yes (${task.childrenCount} subtasks)` : 'No'}\n`;

      return {
        content: [{
          type: "text" as const,
          text: infoText
        }]
      };
    } else {
      // Task retrieval failed
      return {
        content: [{
          type: "text" as const,
          text: `Failed to retrieve task: ${result.error}`
        }],
        isError: true
      };
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`Tool execution error: ${error.message}`);
    return {
      content: [{
        type: "text" as const,
        text: `Error retrieving task: ${error.message}`
      }],
      isError: true
    };
  }
}
