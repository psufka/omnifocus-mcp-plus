import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { toLocalDateTimeString } from '../../utils/localDate.js';

/**
 * OmniJS source for describing a task's notifications as a plain array of
 * { index, kind, ... } entries. Shared by list_notifications and
 * remove_notification (which returns the post-removal list so the caller never
 * acts on stale indices).
 */
const OMNIJS_NOTIFICATION_HELPERS = `
  function __describeNotifications(task) {
    const notifications = task.notifications.filter(function () { return true; });
    return notifications.map(function (n, idx) {
      const entry = { index: idx };
      try {
        const kindStr = String(n.kind);
        if (kindStr.indexOf('DueRelative') !== -1) {
          entry.kind = 'relative';
          try { entry.relativeOffsetSeconds = n.relativeFireOffset; } catch(e) {}
          try { entry.fireDate = n.initialFireDate ? n.initialFireDate.toISOString() : null; } catch(e) {}
        } else {
          entry.kind = 'absolute';
          try { entry.date = n.initialFireDate ? n.initialFireDate.toISOString() : null; } catch(e) {}
        }
      } catch(e) {
        entry.kind = 'unknown';
      }
      return entry;
    });
  }
`;

export const LIST_NOTIFICATIONS_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${OMNIJS_NOTIFICATION_HELPERS}

  const lookup = __resolveByIdOrName(flattenedTasks, args.taskId, args.taskName, 'Task');
  if (lookup.error) { return JSON.stringify({ success: false, error: lookup.error }); }
  const task = lookup.item;

  const result = __describeNotifications(task);

  return JSON.stringify({
    success: true,
    taskId: task.id.primaryKey,
    taskName: task.name,
    notificationCount: result.length,
    notifications: result
  });
`;

export async function listNotifications(params: { taskId?: string; taskName?: string }): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  return await runOmniJs(LIST_NOTIFICATIONS_SCRIPT, params);
}

export const ADD_NOTIFICATION_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${OMNIJS_NOTIFICATION_HELPERS}

  const lookup = __resolveByIdOrName(flattenedTasks, args.taskId, args.taskName, 'Task');
  if (lookup.error) { return JSON.stringify({ success: false, error: lookup.error }); }
  const task = lookup.item;

  if (args.type === 'absolute') {
    const fireDate = new Date(args.date);
    if (isNaN(fireDate.getTime())) {
      return JSON.stringify({ success: false, error: 'Invalid date for absolute notification: ' + args.date });
    }
    task.addNotification(fireDate);
  } else {
    // A relative notification fires N minutes before the DUE date — with no
    // due date there is nothing to offset from, and OmniFocus would store a
    // reminder that never fires.
    if (!task.dueDate) {
      return JSON.stringify({
        success: false,
        error: 'Cannot add a relative notification to "' + task.name + '": the task has no due date. Set a due date first, or use an absolute notification.'
      });
    }
    // offset in seconds before due date (negative = before)
    const offsetSeconds = -(args.minutesBefore * 60);
    task.addNotification(offsetSeconds);
  }

  return JSON.stringify({
    success: true,
    taskId: task.id.primaryKey,
    taskName: task.name,
    type: args.type,
    totalNotifications: task.notifications.filter(() => true).length,
    notifications: __describeNotifications(task)
  });
`;

export async function addNotification(params: {
  taskId?: string;
  taskName?: string;
  type: 'absolute' | 'relative';
  date?: string;
  minutesBefore?: number;
}): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  if (params.type === 'absolute' && !params.date) {
    return { success: false, error: "date is required for absolute notifications" };
  }

  if (params.type === 'relative' && params.minutesBefore === undefined) {
    return { success: false, error: "minutesBefore is required for relative notifications" };
  }

  if (params.type === 'relative' && params.minutesBefore! < 0) {
    return { success: false, error: "minutesBefore must be 0 or greater (it is applied as an offset BEFORE the due date)" };
  }

  // Bare 'YYYY-MM-DD' must become local midnight before OmniJS parses it.
  const scriptArgs = params.date ? { ...params, date: toLocalDateTimeString(params.date) } : params;
  return await runOmniJs(ADD_NOTIFICATION_SCRIPT, scriptArgs);
}

export const REMOVE_NOTIFICATION_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${OMNIJS_NOTIFICATION_HELPERS}

  const lookup = __resolveByIdOrName(flattenedTasks, args.taskId, args.taskName, 'Task');
  if (lookup.error) { return JSON.stringify({ success: false, error: lookup.error }); }
  const task = lookup.item;

  const notifications = task.notifications.filter(() => true);
  if (notifications.length === 0) {
    return JSON.stringify({ success: false, error: 'Task "' + task.name + '" has no notifications to remove.' });
  }
  if (args.index < 0 || args.index >= notifications.length) {
    return JSON.stringify({
      success: false,
      error: 'Notification index ' + args.index + ' is out of range: task "' + task.name + '" has ' + notifications.length + ' notification(s), valid indices are 0-' + (notifications.length - 1) + '. Use list_notifications to see current indices.',
      notifications: __describeNotifications(task)
    });
  }

  const toRemove = notifications[args.index];
  task.removeNotification(toRemove);

  // Indices shift after a removal — return the current list so the caller
  // never removes the wrong notification on a follow-up call.
  const remaining = __describeNotifications(task);

  return JSON.stringify({
    success: true,
    taskId: task.id.primaryKey,
    taskName: task.name,
    removedIndex: args.index,
    remainingCount: remaining.length,
    remainingNotifications: remaining
  });
`;

export async function removeNotification(params: {
  taskId?: string;
  taskName?: string;
  index: number;
}): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  if (!Number.isInteger(params.index) || params.index < 0) {
    return { success: false, error: "index must be a non-negative integer (use list_notifications to see valid indices)" };
  }

  return await runOmniJs(REMOVE_NOTIFICATION_SCRIPT, params);
}
