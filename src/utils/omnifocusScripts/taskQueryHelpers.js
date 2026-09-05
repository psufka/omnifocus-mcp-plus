// Shared by inline and packaged OmniJS scripts. No Node APIs in this file.
function __isRealTask(task) {
  try { return task.project === null || task.project === undefined; }
  catch (e) { return false; }
}

function __queryTasks(includeProjectRoots) {
  return flattenedTasks.filter(function (task) { return includeProjectRoots === true || __isRealTask(task); });
}

function __queryDate(task, key, mode) {
  try {
    if (mode === 'effective') {
      var inheritedKey = {dueDate: 'effectiveDueDate', deferDate: 'effectiveDeferDate', plannedDate: 'effectivePlannedDate'}[key];
      if (inheritedKey && task[inheritedKey]) return task[inheritedKey];
    }
    return task[key] || null;
  } catch (e) { return null; }
}
