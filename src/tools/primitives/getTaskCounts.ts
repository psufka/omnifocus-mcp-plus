import { runOmniJs } from '../../utils/scriptExecution.js';
import { toLocalDateTimeString } from '../../utils/localDate.js';

export interface GetTaskCountsParams {
  project?: string;
  tag?: string;
  flagged?: boolean;
  dueBefore?: string;
  dueAfter?: string;
}

/**
 * Aggregate task counts.
 *
 * `available` counts every actionable status (Available, Next, DueSoon,
 * Overdue), and `dueSoon` comes from Task.Status.DueSoon so it follows the
 * user's own OmniFocus "due soon" setting instead of a hardcoded window.
 */
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

    // Filter by due dates. The bounds arrive normalized to local
    // "YYYY-MM-DDTHH:mm:ss", so a bare date means local midnight, not UTC.
    if (args.dueBefore) {
      const before = new Date(args.dueBefore);
      tasks = tasks.filter(t => t.dueDate && t.dueDate < before);
    }
    if (args.dueAfter) {
      const after = new Date(args.dueAfter);
      tasks = tasks.filter(t => t.dueDate && t.dueDate > after);
    }

    const now = new Date();

    // "Available" in OmniFocus terms means actionable right now. Task.Status
    // splits that across four values — a task that is the next action reports
    // Next, one inside the due-soon window reports DueSoon, a late one reports
    // Overdue — so counting only Task.Status.Available reported 0 for projects
    // whose sole actionable task happened to be the next action.
    const ACTIONABLE_STATUSES = [
      Task.Status.Available,
      Task.Status.Next,
      Task.Status.DueSoon,
      Task.Status.Overdue
    ];

    let total = 0, available = 0, completed = 0, overdue = 0, dueSoon = 0, flagged = 0, deferred = 0;
    tasks.forEach(t => {
      total++;
      if (ACTIONABLE_STATUSES.indexOf(t.taskStatus) !== -1) available++;
      if (t.taskStatus === Task.Status.Completed) completed++;
      // Task.Status.DueSoon honours the user's own "due soon" preference in
      // OmniFocus rather than a hardcoded window.
      if (t.taskStatus === Task.Status.DueSoon) dueSoon++;
      if (t.deferDate && new Date(t.deferDate) > now) deferred++;
      if (t.flagged) flagged++;
      if (t.dueDate && t.dueDate < now && t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped) overdue++;
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

  const normalized: GetTaskCountsParams = { ...params };
  if (typeof normalized.dueBefore === 'string' && normalized.dueBefore.trim() !== '') {
    normalized.dueBefore = toLocalDateTimeString(normalized.dueBefore);
  }
  if (typeof normalized.dueAfter === 'string' && normalized.dueAfter.trim() !== '') {
    normalized.dueAfter = toLocalDateTimeString(normalized.dueAfter);
  }

  return await runOmniJs(script, normalized);
}
