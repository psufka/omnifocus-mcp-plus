import { runOmniJs } from '../../utils/scriptExecution.js';

export interface GetTaskCountsParams {
  project?: string;
  tag?: string;
  flagged?: boolean;
  dueBefore?: string;
  dueAfter?: string;
}

export async function getTaskCounts(params: GetTaskCountsParams = {}): Promise<any> {
  const script = `
    let tasks = flattenedTasks.filter(() => true);

    // Filter by project
    if (args.project) {
      const projName = args.project.toLowerCase();
      tasks = tasks.filter(t => {
        const cp = t.containingProject;
        return cp && cp.name.toLowerCase().includes(projName);
      });
    }

    // Filter by tag
    if (args.tag) {
      const tagName = args.tag.toLowerCase();
      tasks = tasks.filter(t =>
        t.tags.some(tag => tag.name.toLowerCase().includes(tagName))
      );
    }

    // Filter by flagged
    if (args.flagged !== undefined) {
      tasks = tasks.filter(t => t.flagged === args.flagged);
    }

    // Filter by due dates
    if (args.dueBefore) {
      const before = new Date(args.dueBefore);
      tasks = tasks.filter(t => t.dueDate && t.dueDate < before);
    }
    if (args.dueAfter) {
      const after = new Date(args.dueAfter);
      tasks = tasks.filter(t => t.dueDate && t.dueDate > after);
    }

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const threeDays = new Date(now);
    threeDays.setDate(threeDays.getDate() + 3);
    threeDays.setHours(23, 59, 59, 999);

    let total = 0, available = 0, completed = 0, overdue = 0, dueSoon = 0, flagged = 0, deferred = 0;
    tasks.forEach(t => {
      total++;
      if (t.taskStatus === Task.Status.Available) available++;
      if (t.taskStatus === Task.Status.Completed) completed++;
      if (t.deferDate && new Date(t.deferDate) > now) deferred++;
      if (t.flagged) flagged++;
      if (t.dueDate) {
        if (t.dueDate < now && t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped) overdue++;
        if (t.dueDate >= now && t.dueDate <= threeDays && t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped) dueSoon++;
      }
    });

    return JSON.stringify({
      success: true,
      total: total,
      available: available,
      completed: completed,
      overdue: overdue,
      dueSoon: dueSoon,
      flagged: flagged,
      deferred: deferred
    });
  `;
  return await runOmniJs(script, params);
}
