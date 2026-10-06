/** OmniJS shared by project listings, counts and analytics. */
export const OMNIJS_PROJECT_ACTIONS = `
  function __projectActions(project, now) {
    var remaining = project.flattenedTasks.filter(function (t) {
      return !t.project && t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped;
    });
    // After finished tasks are removed, only Blocked is unavailable; the
    // other statuses are Available, Next, DueSoon and Overdue. A future
    // effective defer date explains waiting, including sequential followers.
    var hasAvailableOrDeferred = remaining.some(function (t) {
      return t.taskStatus !== Task.Status.Blocked || t.effectiveDeferDate > now;
    });
    return { remainingTasks: remaining.length, noNextAction: remaining.length > 0 && !hasAvailableOrDeferred };
  }
`;
