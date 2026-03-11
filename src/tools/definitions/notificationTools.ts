import { z } from 'zod';
import { listNotifications, addNotification, removeNotification } from '../primitives/notificationTools.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

// --- list_notifications ---
export const listNotificationsSchema = z.object({
  taskId: z.string().optional().describe("The ID of the task"),
  taskName: z.string().optional().describe("The name of the task (alternative to taskId)")
});

export async function listNotificationsHandler(args: z.infer<typeof listNotificationsSchema>, extra: RequestHandlerExtra) {
  try {
    if (!args.taskId && !args.taskName) {
      return { content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }], isError: true };
    }
    const result = await listNotifications(args);
    if (result.success) {
      let output = `🔔 **Notifications for "${result.taskName}"** [${result.taskId}]\n`;
      if (result.notificationCount === 0) {
        output += 'No notifications set.\n';
      } else {
        output += `${result.notificationCount} notification${result.notificationCount === 1 ? '' : 's'}:\n\n`;
        for (const n of result.notifications) {
          if (n.kind === 'absolute') {
            const d = n.date ? new Date(n.date).toLocaleString() : 'unknown date';
            output += `  [${n.index}] Absolute: ${d}\n`;
          } else if (n.kind === 'relative') {
            const mins = n.relativeOffsetSeconds != null ? Math.abs(n.relativeOffsetSeconds / 60) : '?';
            output += `  [${n.index}] Relative: ${mins} minutes before due\n`;
          } else {
            output += `  [${n.index}] ${n.kind}\n`;
          }
        }
      }
      return { content: [{ type: "text" as const, text: output }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- add_notification ---
export const addNotificationSchema = z.object({
  taskId: z.string().optional().describe("The ID of the task"),
  taskName: z.string().optional().describe("The name of the task (alternative to taskId)"),
  type: z.enum(["absolute", "relative"]).describe("Notification type: 'absolute' for a specific date/time, 'relative' for minutes before due date"),
  date: z.string().optional().describe("ISO date string for absolute notifications (e.g., 2026-03-15T09:00:00-05:00)"),
  minutesBefore: z.number().optional().describe("Minutes before due date for relative notifications (e.g., 30 for 30 minutes before)")
});

export async function addNotificationHandler(args: z.infer<typeof addNotificationSchema>, extra: RequestHandlerExtra) {
  try {
    if (!args.taskId && !args.taskName) {
      return { content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }], isError: true };
    }
    const result = await addNotification(args);
    if (result.success) {
      const typeDesc = result.type === 'absolute' ? `at ${args.date}` : `${args.minutesBefore} minutes before due`;
      return { content: [{ type: "text" as const, text: `Added ${result.type} notification ${typeDesc} to "${result.taskName}" (${result.totalNotifications} total)` }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

// --- remove_notification ---
export const removeNotificationSchema = z.object({
  taskId: z.string().optional().describe("The ID of the task"),
  taskName: z.string().optional().describe("The name of the task (alternative to taskId)"),
  index: z.number().describe("Index of the notification to remove (use list_notifications to see indices)")
});

export async function removeNotificationHandler(args: z.infer<typeof removeNotificationSchema>, extra: RequestHandlerExtra) {
  try {
    if (!args.taskId && !args.taskName) {
      return { content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }], isError: true };
    }
    const result = await removeNotification(args);
    if (result.success) {
      return { content: [{ type: "text" as const, text: `Removed notification #${result.removedIndex} from "${result.taskName}" (${result.remainingNotifications} remaining)` }] };
    }
    return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}
