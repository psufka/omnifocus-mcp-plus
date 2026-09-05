// filter_tasks engine.
//
// Every filter (status, perspective, project, folder scope, text, name, tags,
// note/repetition/estimate predicates, the due / defer / planned / completion /
// added / modified / dropped date ranges, and the and/or/not clause bodies) is
// applied HERE, before the sort and before the offset+limit page slice, so the
// cap can never drop a task that a later client-side pass would have kept. The
// payload reports which filters were applied plus whether more matches exist,
// so the TypeScript layer knows it does not need to re-filter and can tell the
// user how many tasks matched in total.
//
// Date strings arrive already normalized to local "YYYY-MM-DDTHH:mm:ss" by the
// TypeScript layer, so a bare "YYYY-MM-DD" parses as local midnight here, not
// UTC midnight (which lands on the previous evening west of UTC).
//
// Injection safety: every user value reaches this script through injectedArgs.
// The nameMatches pattern is compiled with the RegExp CONSTRUCTOR from that
// injected value — it is never spliced into a regex literal in this source.
(() => {
  /* @task-query-helpers */
  try {
    // Get injected arguments
    const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};
    const dateMode = args.dateMode || 'direct';
    const weekStartsOn = args.weekStartsOn || 'sunday';

    function toArray(value) {
      if (value === undefined || value === null) return [];
      return Array.isArray(value) ? value : [value];
    }

    // ---------------------------------------------------------------------
    // Clause vocabulary. CONDITION_KEYS is the authoritative list of keys this
    // script can EVALUATE; anything else in an and/or/not clause is rejected
    // loudly rather than silently ignored (an ignored predicate would return a
    // wider result set that looks like a real answer). The TypeScript layer
    // mirrors this list and a unit test asserts the two never drift.
    // ---------------------------------------------------------------------
    const CONDITION_DATE_KEYS = [
      "dueBefore", "dueAfter",
      "deferBefore", "deferAfter",
      "plannedBefore", "plannedAfter",
      "completedBefore", "completedAfter",
      "addedBefore", "addedAfter",
      "modifiedBefore", "modifiedAfter",
      "droppedBefore", "droppedAfter"
    ];

    const CONDITION_KEYS = [
      "taskStatus", "flagged", "hasNote", "isRepeating", "projectFilter",
      "tagFilter", "tagMatchMode", "nameContains", "nameMatches", "searchText"
    ].concat(CONDITION_DATE_KEYS);

    // Which task property each date bound reads.
    const CONDITION_DATE_PROPERTY = {
      dueBefore: "dueDate", dueAfter: "dueDate",
      deferBefore: "deferDate", deferAfter: "deferDate",
      plannedBefore: "plannedDate", plannedAfter: "plannedDate",
      completedBefore: "completionDate", completedAfter: "completionDate",
      addedBefore: "added", addedAfter: "added",
      modifiedBefore: "modified", modifiedAfter: "modified",
      droppedBefore: "dropDate", droppedAfter: "dropDate"
    };

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

      // Metadata date filters
      addedBefore: args.addedBefore || null,
      addedAfter: args.addedAfter || null,
      modifiedBefore: args.modifiedBefore || null,
      modifiedAfter: args.modifiedAfter || null,
      droppedBefore: args.droppedBefore || null,
      droppedAfter: args.droppedAfter || null,

      // Tag filters
      tagFilter: toArray(args.tagFilter)
        .map(tag => String(tag).trim().toLowerCase())
        .filter(tag => tag.length > 0),
      exactTagMatch: args.exactTagMatch === true,
      tagMatchMode: args.tagMatchMode === "all" ? "all" : "any",

      // Folder scope
      folderName: args.folderName || null,
      folderId: args.folderId || null,

      // Content predicates
      isRepeating: args.isRepeating !== undefined ? args.isRepeating : null,
      hasNote: args.hasNote !== undefined ? args.hasNote : null,
      nameContains: args.nameContains || null,
      nameMatches: args.nameMatches || null,

      // Other filters
      projectFilter: args.projectFilter || null,
      searchText: args.searchText || null,

      // Output controls
      countOnly: args.countOnly === true,
      offset: Math.max(0, Math.floor(Number(args.offset) || 0)),
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
        return toDate(__queryDate(task, key, dateMode));
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

    // All week predicates share one local-calendar boundary.
    const weekOffset = (todayStart.getDay() + (weekStartsOn === 'monday' ? 6 : 0)) % 7;
    const weekStart = addDays(todayStart, -weekOffset);
    const completedWeekStart = weekStart;
    const completedMonthStart = startOfMonth(now);
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
      completedAfter: toDate(filters.completedAfter),
      addedBefore: toDate(filters.addedBefore),
      addedAfter: toDate(filters.addedAfter),
      modifiedBefore: toDate(filters.modifiedBefore),
      modifiedAfter: toDate(filters.modifiedAfter),
      droppedBefore: toDate(filters.droppedBefore),
      droppedAfter: toDate(filters.droppedAfter)
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

    function tagNamesOf(task) {
      try {
        return task.tags
          .map(tag => (tag.name || '').toLowerCase())
          .filter(name => name.trim() !== '');
      } catch (error) {
        return [];
      }
    }

    function matchesTagList(task, wanted, mode, exact) {
      if (wanted.length === 0) return true;
      const tagNames = tagNamesOf(task);
      if (tagNames.length === 0) return false;

      const matchOne = filterTag => tagNames.some(tagName =>
        exact ? tagName === filterTag : tagName.indexOf(filterTag) !== -1
      );

      return mode === "all" ? wanted.every(matchOne) : wanted.some(matchOne);
    }

    function matchesTags(task) {
      return matchesTagList(task, filters.tagFilter, filters.tagMatchMode, filters.exactTagMatch);
    }

    function noteTextOf(task) {
      try {
        const note = task.note;
        return note ? String(note) : '';
      } catch (error) {
        return '';
      }
    }

    function hasNoteValue(task) {
      return noteTextOf(task).trim() !== '';
    }

    function isRepeatingValue(task) {
      try {
        const rule = task.repetitionRule;
        return rule !== null && rule !== undefined;
      } catch (error) {
        return false;
      }
    }

    function projectNameOf(task) {
      try {
        return task.containingProject ? (task.containingProject.name || '') : '';
      } catch (error) {
        return '';
      }
    }

    // Regexes are ALWAYS built through the constructor from an injected value.
    function compileRegex(pattern, where) {
      try {
        return new RegExp(String(pattern), 'i');
      } catch (regexError) {
        throw new Error(
          'Invalid regular expression for ' + where + ': ' + String(pattern) +
          ' (' + regexError + '). nameMatches takes a JavaScript regular expression source string, matched case-insensitively.'
        );
      }
    }

    // ---------------------------------------------------------------------
    // Logical clause compilation. Each condition is compiled ONCE (keys
    // validated, date bounds parsed, regex built) and then applied per task.
    // ---------------------------------------------------------------------
    function compileCondition(condition, where) {
      if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
        throw new Error('Condition ' + where + ' must be an object of predicates.');
      }

      // Object.getOwnPropertyNames, not Object.keys: injected clauses are plain
      // objects but the codebase rule is to never rely on Object.keys here.
      const keys = Object.getOwnPropertyNames(condition)
        .filter(key => condition[key] !== undefined && condition[key] !== null);

      const unsupported = keys.filter(key => CONDITION_KEYS.indexOf(key) === -1);
      if (unsupported.length > 0) {
        throw new Error(
          'Unsupported condition key(s) in ' + where + ': ' + unsupported.join(', ') +
          '. filter_tasks clause conditions support only: ' + CONDITION_KEYS.join(', ') + '.'
        );
      }

      // tagMatchMode is a modifier, not a predicate — a condition holding only
      // that key would match every task, which is never what the caller meant.
      const predicateKeys = keys.filter(key => key !== 'tagMatchMode');
      if (predicateKeys.length === 0) {
        throw new Error('Condition ' + where + ' is empty: specify at least one predicate.');
      }

      const bounds = {};
      CONDITION_DATE_KEYS.forEach(key => {
        if (condition[key] === undefined || condition[key] === null || condition[key] === '') return;
        const parsed = toDate(condition[key]);
        if (!parsed) {
          throw new Error('Unparseable date for ' + key + ' in ' + where + ': ' + condition[key]);
        }
        bounds[key] = parsed;
      });
      const boundKeys = CONDITION_DATE_KEYS.filter(key => bounds[key]);

      const nameRegex = condition.nameMatches ? compileRegex(condition.nameMatches, where + '.nameMatches') : null;
      const nameNeedle = condition.nameContains !== undefined && condition.nameContains !== null
        ? String(condition.nameContains).toLowerCase() : null;
      const searchNeedle = condition.searchText !== undefined && condition.searchText !== null
        ? String(condition.searchText).toLowerCase() : null;
      const projectNeedle = condition.projectFilter !== undefined && condition.projectFilter !== null
        ? String(condition.projectFilter).toLowerCase() : null;
      const statusList = Array.isArray(condition.taskStatus) ? condition.taskStatus : null;
      const conditionTags = toArray(condition.tagFilter)
        .map(tag => String(tag).trim().toLowerCase())
        .filter(tag => tag.length > 0);
      const conditionTagMode = condition.tagMatchMode === 'all' ? 'all' : 'any';

      return function (task) {
        // Clause date bounds require the date to EXIST — "completed before X"
        // inside a clause never matches a task that was never completed.
        for (let i = 0; i < boundKeys.length; i++) {
          const key = boundKeys[i];
          const value = taskDate(task, CONDITION_DATE_PROPERTY[key]);
          if (!value) return false;
          if (key.indexOf('Before') !== -1) {
            if (!(value < bounds[key])) return false;
          } else if (!(value > bounds[key])) {
            return false;
          }
        }

        if (statusList && statusList.indexOf(getTaskStatus(task.taskStatus)) === -1) return false;
        if (condition.flagged !== undefined && condition.flagged !== null && task.flagged !== condition.flagged) return false;
        if (condition.hasNote !== undefined && condition.hasNote !== null && hasNoteValue(task) !== condition.hasNote) return false;
        if (condition.isRepeating !== undefined && condition.isRepeating !== null && isRepeatingValue(task) !== condition.isRepeating) return false;
        if (projectNeedle !== null && projectNameOf(task).toLowerCase().indexOf(projectNeedle) === -1) return false;
        if (nameNeedle !== null && (task.name || '').toLowerCase().indexOf(nameNeedle) === -1) return false;
        if (nameRegex && !nameRegex.test(task.name || '')) return false;
        if (searchNeedle !== null) {
          const lowerName = (task.name || '').toLowerCase();
          const lowerNote = noteTextOf(task).toLowerCase();
          if (lowerName.indexOf(searchNeedle) === -1 && lowerNote.indexOf(searchNeedle) === -1) return false;
        }
        if (conditionTags.length > 0 && !matchesTagList(task, conditionTags, conditionTagMode, false)) return false;

        return true;
      };
    }

    const rawAnd = toArray(args.and);
    const rawOr = toArray(args.or);
    const rawNot = (args.not === undefined || args.not === null) ? null : args.not;

    let andConditions = [];
    let orConditions = [];
    let notCondition = null;
    let topNameRegex = null;
    try {
      andConditions = rawAnd.map((condition, index) => compileCondition(condition, 'and[' + index + ']'));
      orConditions = rawOr.map((condition, index) => compileCondition(condition, 'or[' + index + ']'));
      if (rawNot) notCondition = compileCondition(rawNot, 'not');
      if (filters.nameMatches) topNameRegex = compileRegex(filters.nameMatches, 'nameMatches');
    } catch (clauseError) {
      return JSON.stringify({
        success: false,
        error: clauseError && clauseError.message ? clauseError.message : String(clauseError)
      });
    }

    if (rawOr.length === 0 && Object.prototype.hasOwnProperty.call(args, 'or') && args.or !== undefined && args.or !== null) {
      return JSON.stringify({
        success: false,
        error: 'The "or" clause was supplied with no conditions. An empty OR matches nothing; remove the key or add at least one condition.'
      });
    }

    // ---------------------------------------------------------------------
    // Folder scope. Resolution mirrors the id-wins / prefer-active / ambiguity
    // semantics of the shared __resolveByIdOrName helper. That helper is a
    // TypeScript string constant only INLINE runOmniJs scripts can prepend, and
    // this is a packaged script file executed by path, so the semantics are
    // restated here rather than imported.
    // ---------------------------------------------------------------------
    function folderStatusLabel(folder) {
      try {
        const raw = String(folder.status);
        const marker = raw.indexOf(': ');
        if (marker >= 0 && raw.charAt(raw.length - 1) === ']') return raw.slice(marker + 2, -1);
        return '';
      } catch (error) {
        return '';
      }
    }

    function resolveScopeFolder() {
      if (filters.folderId) {
        const byId = (typeof Folder !== 'undefined' && Folder.byIdentifier)
          ? Folder.byIdentifier(filters.folderId)
          : null;
        if (!byId) {
          return {
            error: 'Folder not found with ID: ' + filters.folderId +
              (filters.folderName ? ' (folderName was NOT tried; drop folderId to look up by name)' : '')
          };
        }
        return { folder: byId };
      }

      if (!filters.folderName) return { folder: null };

      const wanted = String(filters.folderName).toLowerCase();
      let matches = flattenedFolders.filter(folder => (folder.name || '').toLowerCase() === wanted);
      if (matches.length === 0) {
        matches = flattenedFolders.filter(folder => (folder.name || '').toLowerCase().indexOf(wanted) !== -1);
      }
      if (matches.length === 0) {
        return { error: 'Folder not found: ' + filters.folderName };
      }
      if (matches.length > 1) {
        const active = matches.filter(folder => folderStatusLabel(folder) !== 'Dropped');
        if (active.length === 1) matches = active;
      }
      if (matches.length > 1) {
        const listed = matches.slice(0, 5)
          .map(folder => '"' + folder.name + '" (id: ' + folder.id.primaryKey + ')')
          .join(', ');
        return {
          error: 'Ambiguous folder name "' + filters.folderName + '": ' + matches.length +
            ' matches — ' + listed + '. Use folderId instead.'
        };
      }
      return { folder: matches[0] };
    }

    const scope = resolveScopeFolder();
    if (scope.error) {
      return JSON.stringify({ success: false, error: scope.error });
    }
    const scopeFolderKey = scope.folder ? scope.folder.id.primaryKey : null;

    // One walk per PROJECT, not per task.
    const folderScopeCache = {};
    function taskInFolderScope(task) {
      let project = null;
      try {
        project = task.containingProject;
      } catch (error) {
        project = null;
      }
      // Inbox tasks (and anything with no containing project) never match a
      // folder filter — a folder can only ever contain projects.
      if (!project) return false;

      let projectKey = null;
      try {
        projectKey = project.id.primaryKey;
      } catch (error) {
        projectKey = null;
      }
      if (projectKey !== null && Object.prototype.hasOwnProperty.call(folderScopeCache, projectKey)) {
        return folderScopeCache[projectKey];
      }

      let found = false;
      try {
        // Project.parentFolder, then up the Folder.parent chain (the inverse
        // properties do not exist).
        let folder = project.parentFolder;
        while (folder) {
          if (folder.id.primaryKey === scopeFolderKey) {
            found = true;
            break;
          }
          folder = folder.parent;
        }
      } catch (error) {
        found = false;
      }

      if (projectKey !== null) folderScopeCache[projectKey] = found;
      return found;
    }

    // Estimated-minutes predicate. Every supplied comparator must hold, and a
    // task with no estimate never satisfies one.
    const estimateFilter = (args.estimatedMinutes && typeof args.estimatedMinutes === 'object' && !Array.isArray(args.estimatedMinutes))
      ? args.estimatedMinutes
      : null;

    function matchesEstimate(task) {
      let value = null;
      try {
        value = task.estimatedMinutes;
      } catch (error) {
        value = null;
      }
      if (value === null || value === undefined || isNaN(value)) return false;
      if (estimateFilter.lessThan !== undefined && estimateFilter.lessThan !== null && !(value < estimateFilter.lessThan)) return false;
      if (estimateFilter.greaterThan !== undefined && estimateFilter.greaterThan !== null && !(value > estimateFilter.greaterThan)) return false;
      if (estimateFilter.equals !== undefined && estimateFilter.equals !== null && value !== estimateFilter.equals) return false;
      if (Array.isArray(estimateFilter.between) && estimateFilter.between.length === 2) {
        const low = Math.min(estimateFilter.between[0], estimateFilter.between[1]);
        const high = Math.max(estimateFilter.between[0], estimateFilter.between[1]);
        if (!(value >= low && value <= high)) return false;
      }
      return true;
    }

    const nameContainsNeedle = filters.nameContains ? String(filters.nameContains).toLowerCase() : null;

    // Filters the TypeScript layer used to apply after truncation. Reported back
    // so it can skip them instead of double-filtering.
    const PUSHED_DOWN_FILTER_KEYS = [
      "tagFilter",
      "dueToday", "dueThisWeek", "dueThisMonth", "overdue", "dueBefore", "dueAfter",
      "deferToday", "deferThisWeek", "deferAvailable", "deferBefore", "deferAfter",
      "plannedToday", "plannedThisWeek", "plannedThisMonth", "plannedBefore", "plannedAfter",
      "addedBefore", "addedAfter", "modifiedBefore", "modifiedAfter",
      "droppedBefore", "droppedAfter",
      "isRepeating", "hasNote", "nameContains", "nameMatches",
      "folderName", "folderId"
    ];

    // false is a meaningful value for these, so presence (not truthiness) marks
    // them applied.
    const TRISTATE_FILTER_KEYS = ["isRepeating", "hasNote"];

    const appliedFilters = PUSHED_DOWN_FILTER_KEYS.filter(key => {
      // An unparseable bound is skipped, so it must not be reported as applied.
      if (Object.prototype.hasOwnProperty.call(argDates, key)) return argDates[key] !== null;
      if (TRISTATE_FILTER_KEYS.indexOf(key) !== -1) return filters[key] !== null;
      const value = filters[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
    if (estimateFilter) appliedFilters.push("estimatedMinutes");
    if (andConditions.length > 0) appliedFilters.push("and");
    if (orConditions.length > 0) appliedFilters.push("or");
    if (notCondition) appliedFilters.push("not");

    // Get all tasks
    const allTasks = __queryTasks(args.includeProjectRoots);

    // Determine whether completed tasks are needed
    const wantsCompletedTasks = filters.completedToday || filters.completedYesterday ||
                               filters.completedThisWeek || filters.completedThisMonth ||
                               filters.completedBefore || filters.completedAfter;
    const includeCompletedByStatus = filters.taskStatus &&
      (filters.taskStatus.includes("Completed") || filters.taskStatus.includes("Dropped"));

    // Clause bodies can ask about completion/drop dates or statuses too; the
    // candidate set has to be widened or those clauses would always be false.
    //
    // `not` is deliberately EXCLUDED: negation only ever removes tasks, so a
    // clause like not:{taskStatus:['Dropped']} must not switch off the default
    // completed/dropped exclusion — doing so returned every completed task in
    // the database.
    function clauseWidensCandidateSet() {
      const all = rawAnd.concat(rawOr);
      for (let i = 0; i < all.length; i++) {
        const condition = all[i];
        if (!condition || typeof condition !== 'object') continue;
        if (condition.completedBefore || condition.completedAfter) return true;
        if (condition.droppedBefore || condition.droppedAfter) return true;
        if (Array.isArray(condition.taskStatus) &&
            (condition.taskStatus.indexOf("Completed") !== -1 || condition.taskStatus.indexOf("Dropped") !== -1)) {
          return true;
        }
      }
      return false;
    }

    const wantsDroppedTasks = Boolean(argDates.droppedBefore || argDates.droppedAfter);
    // True when completed/dropped tasks must survive the pre-filter. With no
    // 0.5.0 params this is exactly the old includeCompletedByStatus.
    const keepCompletedAndDropped = Boolean(includeCompletedByStatus) || wantsDroppedTasks || clauseWidensCandidateSet();

    // Select the task set
    let availableTasks;
    if (wantsCompletedTasks || keepCompletedAndDropped) {
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
        } else if (!keepCompletedAndDropped && (taskStatus === "Completed" || taskStatus === "Dropped")) {
          // Exclude completed tasks (unless a status/date filter asked for them)
          return false;
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

        // Folder scope (project's folder or any descendant of it)
        if (scopeFolderKey && !taskInFolderScope(task)) {
          return false;
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

        // Name filters
        if (nameContainsNeedle !== null && (task.name || '').toLowerCase().indexOf(nameContainsNeedle) === -1) {
          return false;
        }
        if (topNameRegex && !topNameRegex.test(task.name || '')) {
          return false;
        }

        // Note / repetition predicates
        if (filters.hasNote !== null && hasNoteValue(task) !== filters.hasNote) {
          return false;
        }
        if (filters.isRepeating !== null && isRepeatingValue(task) !== filters.isRepeating) {
          return false;
        }

        // Estimated duration
        if (estimateFilter && !matchesEstimate(task)) {
          return false;
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

        // Metadata date filters — task.added / task.modified are real Date
        // objects; task.dropDate is set only on dropped tasks.
        if (argDates.addedBefore || argDates.addedAfter) {
          const addedDate = taskDate(task, 'added');
          if (argDates.addedBefore && !(addedDate && addedDate < argDates.addedBefore)) {
            return false;
          }
          if (argDates.addedAfter && !(addedDate && addedDate > argDates.addedAfter)) {
            return false;
          }
        }
        if (argDates.modifiedBefore || argDates.modifiedAfter) {
          const modifiedDate = taskDate(task, 'modified');
          if (argDates.modifiedBefore && !(modifiedDate && modifiedDate < argDates.modifiedBefore)) {
            return false;
          }
          if (argDates.modifiedAfter && !(modifiedDate && modifiedDate > argDates.modifiedAfter)) {
            return false;
          }
        }
        if (argDates.droppedBefore || argDates.droppedAfter) {
          const droppedDate = taskDate(task, 'dropDate');
          if (argDates.droppedBefore && !(droppedDate && droppedDate < argDates.droppedBefore)) {
            return false;
          }
          if (argDates.droppedAfter && !(droppedDate && droppedDate > argDates.droppedAfter)) {
            return false;
          }
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
          if (filters.completedThisWeek && !(completionDate && completionDate >= completedWeekStart && completionDate < weekEnd)) {
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

        // Logical clauses. Top-level flat filters above implicitly AND with
        // these results.
        for (let i = 0; i < andConditions.length; i++) {
          if (!andConditions[i](task)) return false;
        }
        if (orConditions.length > 0) {
          let anyMatched = false;
          for (let i = 0; i < orConditions.length; i++) {
            if (orConditions[i](task)) {
              anyMatched = true;
              break;
            }
          }
          if (!anyMatched) return false;
        }
        if (notCondition && notCondition(task)) {
          return false;
        }

        return true;
      } catch (error) {
        return false;
      }
    });

    // Everything above has already been filtered, so the count below is the true
    // number of matches — the page slice applies to the sorted match set only.
    const matchedCount = filteredTasks.length;

    // countOnly short-circuit: no sort, no page slice, and above all no
    // per-task field reads (id / name / dates / tags), which is where the cost
    // of this tool actually lives.
    if (filters.countOnly) {
      return JSON.stringify({
        dateMode: dateMode, weekStartsOn: weekStartsOn, includeProjectRoots: args.includeProjectRoots === true,
        countOnly: true,
        count: matchedCount,
        totalCount: baseTasks.length,
        appliedFilters: appliedFilters
      });
    }

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

    // Page the result — offset then limit, both AFTER the deterministic sort so
    // paging through a result set never repeats or skips a task.
    const limitApplied = filters.limit;
    const pageStart = filters.offset;
    const pageEnd = limitApplied ? pageStart + limitApplied : matchedCount;
    const truncated = matchedCount > pageEnd;
    filteredTasks = filteredTasks.slice(pageStart, pageEnd);

    // Build return data
    const exportData = {
      exportDate: new Date().toISOString(),
      dateMode: dateMode, weekStartsOn: weekStartsOn, includeProjectRoots: args.includeProjectRoots === true,
      tasks: [],
      totalCount: baseTasks.length,
      matchedCount: matchedCount,
      filteredCount: filteredTasks.length,
      limitApplied: limitApplied,
      offsetApplied: pageStart,
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
