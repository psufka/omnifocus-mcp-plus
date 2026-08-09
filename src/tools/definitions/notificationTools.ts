import { z } from 'zod';
import { listNotifications, addNotification, removeNotification } from '../primitives/notificationTools.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { isoDateDescription, requiredIsoDate } from '../../utils/zodHelpers.js';

// Renders the notification descriptors returned by the primitives.
function formatNotifications(notifications: any[]): string {
  return notifications.map(n => {
    if (n.kind === 'absolute') {
      const d = n.date ? new Date(n.date).toLocaleString() : 'unknown date';
      return `  [${n.index}] Absolute: ${d}`;
    }
    if (n.kind === 'relative') {
      const mins = n.relativeOffsetSeconds != null ? Math.abs(n.relativeOffsetSeconds / 60) : '?';
      return `  [${n.index}] Relative: ${mins} minutes before due`;
    }
    return `  [${n.index}] ${n.kind}`;
  }).join('\n');
}

// --- list_notifications ---
export const listNotificationsSchema = z.object({
  taskId: z.string().optional().describe("The ID of the task"),
  taskName: z.string().optional().describe("The name of the task (alternative to taskId)")
}).strict();

export async function listNotificationsHandler(args: z.infer<typeof listNotificationsSchema>, extra: RequestHandlerExtra<any, any>) {
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
        output += `${formatNotifications(result.notifications)}\n`;
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
  date: requiredIsoDate(
    isoDateDescription("When the notification fires — required for absolute notifications")
  ).optional(),
  minutesBefore: z.number().min(0).optional().describe("Minutes before the due date for relative notifications (e.g. 30 for 30 minutes before). Requires the task to have a due date.")
}).strict()
  .refine(d => d.type !== 'absolute' || d.date !== undefined, {
    message: "date is required when type is 'absolute'",
    path: ['date']
  })
  .refine(d => d.type !== 'relative' || d.minutesBefore !== undefined, {
    message: "minutesBefore is required when type is 'relative'",
    path: ['minutesBefore']
  });

export async function addNotificationHandler(args: z.infer<typeof addNotificationSchema>, extra: RequestHandlerExtra<any, any>) {
  try {
    if (!args.taskId && !args.taskName) {
      return { content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }], isError: true };
    }
    const result = await addNotification(args);
    if (result.success) {
      const typeDesc = result.type === 'absolute' ? `at ${args.date}` : `${args.minutesBefore} minutes before due`;
      let output = `Added ${result.type} notification ${typeDesc} to "${result.taskName}" (${result.totalNotifications} total)`;
      if (Array.isArray(result.notifications) && result.notifications.length > 0) {
        output += `\n\n${formatNotifications(result.notifications)}`;
      }
      return { content: [{ type: "text" as const, text: output }] };
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
  index: z.number().int().min(0).describe("Index of the notification to remove (use list_notifications to see indices). Indices shift after every removal — the remaining list is returned so you can re-target correctly.")
}).strict();

export async function removeNotificationHandler(args: z.infer<typeof removeNotificationSchema>, extra: RequestHandlerExtra<any, any>) {
  try {
    if (!args.taskId && !args.taskName) {
      return { content: [{ type: "text" as const, text: "Error: Either taskId or taskName must be provided." }], isError: true };
    }
    const result = await removeNotification(args);
    if (result.success) {
      let output = `Removed notification #${result.removedIndex} from "${result.taskName}" (${result.remainingCount} remaining)`;
      if (result.remainingCount > 0) {
        output += `\n\nRemaining notifications (indices have shifted):\n${formatNotifications(result.remainingNotifications)}`;
      }
      return { content: [{ type: "text" as const, text: output }] };
    }
    let output = `Error: ${result.error}`;
    if (Array.isArray(result.notifications) && result.notifications.length > 0) {
      output += `\n\nCurrent notifications:\n${formatNotifications(result.notifications)}`;
    }
    return { content: [{ type: "text" as const, text: output }], isError: true };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}
