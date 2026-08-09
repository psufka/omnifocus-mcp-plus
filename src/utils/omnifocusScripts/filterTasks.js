// filter_tasks engine.
//
// Every filter (status, perspective, project, text, tags, and the due / defer /
// planned / completion date ranges) is applied HERE, before the sort and before
// the `limit` truncation, so the cap can never drop a task that a later
// client-side pass would have kept. The payload reports which filters were
// applied plus whether the result was capped, so the TypeScript layer knows it
// does not need to re-filter and can tell the user when more tasks matched.
//
// Date strings arrive already normalized to local "YYYY-MM-DDTHH:mm:ss" by the
// TypeScript layer, so a bare "YYYY-MM-DD" parses as local midnight here, not
// UTC midnight (which lands on the previous evening west of UTC).
(() => {
  try {
    // Get injected arguments
    const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};

    function toArray(value) {
      if (value === undefined || value === null) return [];
      return Array.isArray(value) ? value : [value];
    }

    const filters = {
      taskStatus: args.taskStatus || null,
      perspective: args.perspective || "all",
      flagged: args.flagged !== undefined ? args.flagged : null,

      // Completion date filters
      completedToday: args.completedToday || false,
      completedYesterday: args.completedYesterday || false,
      completedThisWeek: args.completedThisWeek || false,
      completedThisMonth: args.completedThisMonth || false,
      completedBefore: args.completedBefore || null,
      completedAfter: args.completedAfter || null,

      // Due date filters
      dueToday: args.dueToday || false,
      dueThisWeek: args.dueThisWeek || false,
      dueThisMonth: args.dueThisMonth || false,
      overdue: args.overdue || false,
      dueBefore: args.dueBefore || null,
      dueAfter: args.dueAfter || null,

      // Defer date filters
      deferToday: args.deferToday || false,
      deferThisWeek: args.deferThisWeek || false,
      deferAvailable: args.deferAvailable || false,
      deferBefore: args.deferBefore || null,
      deferAfter: args.deferAfter || null,

      // Planned date filters
      plannedToday: args.plannedToday || false,
      plannedThisWeek: args.plannedThisWeek || false,
      plannedThisMonth: args.plannedThisMonth || false,
      plannedBefore: args.plannedBefore || null,
      plannedAfter: args.plannedAfter || null,

      // Tag filters
      tagFilter: toArray(args.tagFilter)
        .map(tag => String(tag).trim().toLowerCase())
        .filter(tag => tag.length > 0),
      exactTagMatch: args.exactTagMatch === true,
      tagMatchMode: args.tagMatchMode === "all" ? "all" : "any",

      // Other filters
      projectFilter: args.projectFilter || null,
      searchText: args.searchText || null,
      limit: args.limit || 100,
      sortBy: args.sortBy || "name",
      sortOrder: args.sortOrder || "asc"
    };

    // Helper functions
    function getTaskStatus(status) {
      const taskStatusMap = {
        [Task.Status.Available]: "Available",
        [Task.Status.Blocked]: "Blocked",
        [Task.Status.Completed]: "Completed",
        [Task.Status.Dropped]: "Dropped",
        [Task.Status.DueSoon]: "DueSoon",
        [Task.Status.Next]: "Next",
        [Task.Status.Overdue]: "Overdue"
      };
      return taskStatusMap[status] || "Unknown";
    }

    function formatDate(date) {
      if (!date) return null;
      return date.toISOString();
    }

    function toDate(value) {
      if (!value) return null;
      const parsed = value instanceof Date ? value : new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }

    // Reading a date property can throw on some task kinds; never let that
    // decide the task's fate for an unrelated filter.
    function taskDate(task, key) {
      try {
        return toDate(task[key]);
      } catch (error) {
        return null;
      }
    }

    function startOfDay(date) {
      const result = new Date(date);
      result.setHours(0, 0, 0, 0);
      return result;
    }

    function addDays(date, days) {
      const result = new Date(date);
      result.setDate(result.getDate() + days);
      return result;
    }

    function startOfMonth(date) {
      const result = startOfDay(date);
      result.setDate(1);
      return result;
    }

    // All boundaries are computed from the local clock inside OmniFocus.
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const yesterdayStart = addDays(todayStart, -1);

    // Completion windows: "this week" starts at the most recent Monday 00:00
    // local, "this month" at the 1st 00:00 local.
    const completedWeekStart = addDays(todayStart, (todayStart.getDay() + 6) % 7 * -1);
    const completedMonthStart = startOfMonth(now);

    // Due / defer / planned windows use a Sunday-start week and the calendar
    // month, matching the client-side helpers in filterTasks.ts.
    const weekStart = addDays(todayStart, todayStart.getDay() * -1);
    const weekEnd = addDays(weekStart, 7);
    const monthStart = startOfMonth(now);
    const nextMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

    // Explicit date bounds supplied by the caller.
    const argDates = {
      dueBefore: toDate(filters.dueBefore),
      dueAfter: toDate(filters.dueAfter),
      deferBefore: toDate(filters.deferBefore),
      deferAfter: toDate(filters.deferAfter),
      plannedBefore: toDate(filters.plannedBefore),
      plannedAfter: toDate(filters.plannedAfter),
      completedBefore: toDate(filters.completedBefore),
      completedAfter: toDate(filters.completedAfter)
    };

    function inRange(date, start, end) {
      if (!date) return false;
      return date >= start && date < end;
    }

    function isToday(date) {
      return inRange(toDate(date), todayStart, tomorrowStart);
    }

    function isYesterday(date) {
      return inRange(toDate(date), yesterdayStart, todayStart);
    }

    function matchesTags(task) {
      if (filters.tagFilter.length === 0) return true;

      let tagNames = [];
      try {
        tagNames = task.tags
          .map(tag => (tag.name || '').toLowerCase())
          .filter(name => name.trim() !== '');
      } catch (error) {
        tagNames = [];
      }
      if (tagNames.length === 0) return false;

      const matchOne = filterTag => tagNames.some(tagName =>
        filters.exactTagMatch ? tagName === filterTag : tagName.indexOf(filterTag) !== -1
      );

      return filters.tagMatchMode === "all"
        ? filters.tagFilter.every(matchOne)
        : filters.tagFilter.some(matchOne);
    }

    // Filters the TypeScript layer used to apply after truncation. Reported back
    // so it can skip them instead of double-filtering.
    const PUSHED_DOWN_FILTER_KEYS = [
      "tagFilter",
      "dueToday", "dueThisWeek", "dueThisMonth", "overdue", "dueBefore", "dueAfter",
      "deferToday", "deferThisWeek", "deferAvailable", "deferBefore", "deferAfter",
      "plannedToday", "plannedThisWeek", "plannedThisMonth", "plannedBefore", "plannedAfter"
    ];

    const appliedFilters = PUSHED_DOWN_FILTER_KEYS.filter(key => {
      // An unparseable bound is skipped, so it must not be reported as applied.
      if (Object.prototype.hasOwnProperty.call(argDates, key)) return argDates[key] !== null;
      const value = filters[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });

    // Get all tasks
    const allTasks = flattenedTasks;

    // Determine whether completed tasks are needed
    const wantsCompletedTasks = filters.completedToday || filters.completedYesterday ||
                               filters.completedThisWeek || filters.completedThisMonth ||
                               filters.completedBefore || filters.completedAfter;
    const includeCompletedByStatus = filters.taskStatus &&
      (filters.taskStatus.includes("Completed") || filters.taskStatus.includes("Dropped"));

    // Select the task set
    let availableTasks;
    if (wantsCompletedTasks || includeCompletedByStatus) {
      availableTasks = allTasks;
    } else {
      availableTasks = allTasks.filter(task =>
        task.taskStatus !== Task.Status.Completed &&
        task.taskStatus !== Task.Status.Dropped
      );
    }

    // Apply perspective filter
    let baseTasks = [];
    switch (filters.perspective) {
      case "inbox":
        baseTasks = availableTasks.filter(task => task.inInbox);
        break;
      case "flagged":
        baseTasks = availableTasks.filter(task => task.flagged);
        break;
      default:
        baseTasks = availableTasks;
        break;
    }

    // Apply all filters
    let filteredTasks = baseTasks.filter(task => {
      try {
        const taskStatus = getTaskStatus(task.taskStatus);

        // Completed task logic
        if (wantsCompletedTasks) {
          // Only include completed tasks
          if (taskStatus !== "Completed") {
            return false;
          }
        } else {
          // Exclude completed tasks (unless status explicitly requested)
          if (!includeCompletedByStatus && (taskStatus === "Completed" || taskStatus === "Dropped")) {
            return false;
          }
        }

        // Status filter
        if (filters.taskStatus && filters.taskStatus.length > 0) {
          if (!filters.taskStatus.includes(taskStatus)) {
            return false;
          }
        }

        // Flagged filter
        if (filters.flagged !== null && task.flagged !== filters.flagged) {
          return false;
        }

        // Project filter
        if (filters.projectFilter) {
          const projectName = task.containingProject ? task.containingProject.name : '';
          if (!projectName.toLowerCase().includes(filters.projectFilter.toLowerCase())) {
            return false;
          }
        }

        // Search text filter
        if (filters.searchText) {
          const searchLower = filters.searchText.toLowerCase();
          const taskName = (task.name || '').toLowerCase();
          const taskNote = (task.note || '').toLowerCase();
          if (!taskName.includes(searchLower) && !taskNote.includes(searchLower)) {
            return false;
          }
        }

        // Tag filter
        if (!matchesTags(task)) {
          return false;
        }

        // Due date filters
        const dueDate = taskDate(task, 'dueDate');
        if (filters.dueToday && !inRange(dueDate, todayStart, tomorrowStart)) {
          return false;
        }
        if (filters.dueThisWeek && !inRange(dueDate, weekStart, weekEnd)) {
          return false;
        }
        if (filters.dueThisMonth && !inRange(dueDate, monthStart, nextMonthStart)) {
          return false;
        }
        if (filters.overdue && !(dueDate && dueDate < now)) {
          return false;
        }
        if (argDates.dueBefore && !(dueDate && dueDate < argDates.dueBefore)) {
          return false;
        }
        if (argDates.dueAfter && !(dueDate && dueDate > argDates.dueAfter)) {
          return false;
        }

        // Defer date filters
        const deferDate = taskDate(task, 'deferDate');
        if (filters.deferToday && !inRange(deferDate, todayStart, tomorrowStart)) {
          return false;
        }
        if (filters.deferThisWeek && !inRange(deferDate, weekStart, weekEnd)) {
          return false;
        }
        if (argDates.deferBefore && !(deferDate && deferDate < argDates.deferBefore)) {
          return false;
        }
        if (argDates.deferAfter && !(deferDate && deferDate > argDates.deferAfter)) {
          return false;
        }
        // "Available" means no defer date at all, or one that has already passed.
        if (filters.deferAvailable && deferDate && deferDate > now) {
          return false;
        }

        // Planned date filters
        const plannedDate = taskDate(task, 'plannedDate');
        if (filters.plannedToday && !inRange(plannedDate, todayStart, tomorrowStart)) {
          return false;
        }
        if (filters.plannedThisWeek && !inRange(plannedDate, weekStart, weekEnd)) {
          return false;
        }
        if (filters.plannedThisMonth && !inRange(plannedDate, monthStart, nextMonthStart)) {
          return false;
        }
        if (argDates.plannedBefore && !(plannedDate && plannedDate < argDates.plannedBefore)) {
          return false;
        }
        if (argDates.plannedAfter && !(plannedDate && plannedDate > argDates.plannedAfter)) {
          return false;
        }

        // Completion date filter
        if (wantsCompletedTasks) {
          const completionDate = taskDate(task, 'completionDate');

          if (filters.completedToday && !isToday(completionDate)) {
            return false;
          }
          if (filters.completedYesterday && !isYesterday(completionDate)) {
            return false;
          }
          if (filters.completedThisWeek && !(completionDate && completionDate >= completedWeekStart)) {
            return false;
          }
          if (filters.completedThisMonth && !(completionDate && completionDate >= completedMonthStart)) {
            return false;
          }
          if (argDates.completedBefore && completionDate &&
              completionDate >= argDates.completedBefore) {
            return false;
          }
          if (argDates.completedAfter && completionDate &&
              completionDate <= argDates.completedAfter) {
            return false;
          }
        }

        return true;
      } catch (error) {
        return false;
      }
    });

    // Everything above has already been filtered, so the count below is the true
    // number of matches — the limit applies to the sorted match set only.
    const matchedCount = filteredTasks.length;

    // Sort results (mirrors sortTasks() in filterTasks.ts so the truncated slice
    // is the same slice the TypeScript layer would have chosen).
    const direction = filters.sortOrder === "desc" ? -1 : 1;

    function compareDateKey(a, b, key) {
      const dateA = taskDate(a, key);
      const dateB = taskDate(b, key);
      const valueA = dateA ? dateA.getTime() : Infinity;
      const valueB = dateB ? dateB.getTime() : Infinity;
      if (valueA === valueB) return 0;
      return (valueA < valueB ? -1 : 1) * direction;
    }

    function compareText(a, b) {
      // localeCompare, not raw < / >, so "apple" and "Zebra" order the way a
      // reader expects instead of by code point.
      return a.localeCompare(b) * direction;
    }

    filteredTasks.sort((a, b) => {
      switch (filters.sortBy) {
        case "completedDate":
          return compareDateKey(a, b, 'completionDate');
        case "dueDate":
          return compareDateKey(a, b, 'dueDate');
        case "deferDate":
          return compareDateKey(a, b, 'deferDate');
        case "plannedDate":
          return compareDateKey(a, b, 'plannedDate');
        case "flagged":
          return ((a.flagged ? 1 : 0) - (b.flagged ? 1 : 0)) * direction;
        case "project": {
          const projectA = (a.containingProject ? a.containingProject.name : '') || '';
          const projectB = (b.containingProject ? b.containingProject.name : '') || '';
          return compareText(projectA.toLowerCase(), projectB.toLowerCase());
        }
        case "name":
        default:
          return compareText((a.name || '').toLowerCase(), (b.name || '').toLowerCase());
      }
    });

    // Limit result count — safe here, after every filter and the final sort.
    const limitApplied = filters.limit;
    let truncated = false;
    if (limitApplied && filteredTasks.length > limitApplied) {
      filteredTasks = filteredTasks.slice(0, limitApplied);
      truncated = true;
    }

    // Build return data
    const exportData = {
      exportDate: new Date().toISOString(),
      tasks: [],
      totalCount: baseTasks.length,
      matchedCount: matchedCount,
      filteredCount: filteredTasks.length,
      limitApplied: limitApplied,
      truncated: truncated,
      appliedFilters: appliedFilters,
      sortedBy: filters.sortBy,
      sortOrder: filters.sortOrder
    };

    // Process each task
    filteredTasks.forEach(task => {
      try {
        const taskData = {
          id: task.id.primaryKey,
          name: task.name,
          note: task.note || "",
          taskStatus: getTaskStatus(task.taskStatus),
          flagged: task.flagged,
          dueDate: formatDate(task.dueDate),
          deferDate: formatDate(task.deferDate),
          plannedDate: formatDate(task.plannedDate),
          completedDate: formatDate(task.completionDate),
          effectiveDueDate: formatDate(task.effectiveDueDate),
          effectiveDeferDate: formatDate(task.effectiveDeferDate),
          estimatedMinutes: task.estimatedMinutes,
          projectId: task.containingProject ? task.containingProject.id.primaryKey : null,
          projectName: task.containingProject ? task.containingProject.name : null,
          inInbox: task.inInbox,
          tags: task.tags.map(tag => ({
            id: tag.id.primaryKey,
            name: tag.name
          }))
        };

        exportData.tasks.push(taskData);
      } catch (taskError) {
        // Skip tasks that fail to process
      }
    });

    return JSON.stringify(exportData);

  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Error filtering tasks: ${error}`
    });
  }
})();
