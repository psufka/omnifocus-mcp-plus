import { runOmniJs } from '../../utils/scriptExecution.js';

export async function listNotifications(params: { taskId?: string; taskName?: string }): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  const script = `
    let task;
    if (args.taskId) {
      task = flattenedTasks.filter(t => t.id.primaryKey === args.taskId)[0];
    } else {
      const matches = flattenedTasks.filter(t => t.name === args.taskName);
      if (matches.length > 1) {
        return JSON.stringify({ success: false, error: 'Ambiguous task name: multiple matches found. Please use taskId.' });
      }
      task = matches[0];
    }
    if (!task) return JSON.stringify({ success: false, error: 'Task not found' });

    const notifications = task.notifications.filter(() => true);
    const result = notifications.map((n, idx) => {
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

    return JSON.stringify({
      success: true,
      taskId: task.id.primaryKey,
      taskName: task.name,
      notificationCount: result.length,
      notifications: result
    });
  `;

  return await runOmniJs(script, params);
}

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

  const script = `
    let task;
    if (args.taskId) {
      task = flattenedTasks.filter(t => t.id.primaryKey === args.taskId)[0];
    } else {
      const matches = flattenedTasks.filter(t => t.name === args.taskName);
      if (matches.length > 1) {
        return JSON.stringify({ success: false, error: 'Ambiguous task name. Please use taskId.' });
      }
      task = matches[0];
    }
    if (!task) return JSON.stringify({ success: false, error: 'Task not found' });

    if (args.type === 'absolute') {
      task.addNotification(new Date(args.date));
    } else {
      // relative: offset in seconds before due date (negative = before)
      const offsetSeconds = -(args.minutesBefore * 60);
      task.addNotification(offsetSeconds);
    }

    return JSON.stringify({
      success: true,
      taskId: task.id.primaryKey,
      taskName: task.name,
      type: args.type,
      totalNotifications: task.notifications.filter(() => true).length
    });
  `;

  return await runOmniJs(script, params);
}

export async function removeNotification(params: {
  taskId?: string;
  taskName?: string;
  index: number;
}): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  const script = `
    let task;
    if (args.taskId) {
      task = flattenedTasks.filter(t => t.id.primaryKey === args.taskId)[0];
    } else {
      const matches = flattenedTasks.filter(t => t.name === args.taskName);
      if (matches.length > 1) {
        return JSON.stringify({ success: false, error: 'Ambiguous task name. Please use taskId.' });
      }
      task = matches[0];
    }
    if (!task) return JSON.stringify({ success: false, error: 'Task not found' });

    const notifications = task.notifications.filter(() => true);
    if (args.index < 0 || args.index >= notifications.length) {
      return JSON.stringify({ success: false, error: 'Notification index out of range. Use list_notifications to see valid indices.' });
    }

    const toRemove = notifications[args.index];
    task.removeNotification(toRemove);

    return JSON.stringify({
      success: true,
      taskId: task.id.primaryKey,
      taskName: task.name,
      removedIndex: args.index,
      remainingNotifications: task.notifications.filter(() => true).length
    });
  `;

  return await runOmniJs(script, params);
}
