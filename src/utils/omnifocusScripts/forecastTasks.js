// OmniJS script to get forecast tasks from OmniFocus
(() => {
  /* @task-query-helpers */
  try {
    const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};
    // `days` counts today as day 1: days = 7 covers today through today + 6.
    const dateMode = args.dateMode || 'effective';
    const days = Math.max(1, args.days || 7);
    const hideCompleted = args.hideCompleted !== undefined ? args.hideCompleted : true;
    const includeDeferredOnly = args.includeDeferredOnly !== undefined ? args.includeDeferredOnly : false;
    
    // Helper function to format dates consistently
    function formatDate(date) {
      if (!date) return null;
      return date.toISOString();
    }
    
    // Helper function to get date without time for grouping
    function getDateKey(date) {
      if (!date) return null;
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
    
    // Get task status enum mapping
    const taskStatusMap = {
      [Task.Status.Available]: "Available",
      [Task.Status.Blocked]: "Blocked", 
      [Task.Status.Completed]: "Completed",
      [Task.Status.Dropped]: "Dropped",
      [Task.Status.DueSoon]: "DueSoon",
      [Task.Status.Next]: "Next",
      [Task.Status.Overdue]: "Overdue"
    };
    
    function getTaskStatus(status) {
      return taskStatusMap[status] || "Unknown";
    }
    
    const exportData = {
      dateMode: dateMode, includeProjectRoots: args.includeProjectRoots === true,
      exportDate: new Date().toISOString(),
      tasksByDate: {}
    };
    
    // Calculate date range. The window is inclusive on both ends and counts
    // today as the first day, so `days` buckets are produced (days = 7 →
    // today through today + 6). setDate() is calendar arithmetic, so this is
    // DST-safe.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + (days - 1));

    console.log(`Looking for forecast tasks from ${today.toISOString()} to ${endDate.toISOString()}`);
    
    // Get all active tasks
    let allTasks = __queryTasks(args.includeProjectRoots);
    
    // Filter by completion status if needed
    if (hideCompleted) {
      allTasks = allTasks.filter(task => 
        task.taskStatus !== Task.Status.Completed && 
        task.taskStatus !== Task.Status.Dropped
      );
    }
    
    console.log(`Processing ${allTasks.length} active tasks for forecast`);
    
    // Process each task to see if it falls in forecast range
    allTasks.forEach(task => {
      try {
        let shouldInclude = false;
        let taskDate = null;
        let isDue = false;
        let usedEffectiveDate = false;

        // Fall back to the inherited (effective) date when the task has no date
        // of its own — same convention filter_tasks uses when rendering dates.
        const rawDueDate = __queryDate(task, 'dueDate', dateMode);
        const rawDeferDate = __queryDate(task, 'deferDate', dateMode);

        // Check if task has due date in range.
        // Skipped entirely when only deferred tasks were requested.
        if (!includeDeferredOnly && rawDueDate) {
          const dueDate = new Date(rawDueDate);
          dueDate.setHours(0, 0, 0, 0);

          if (dueDate >= today && dueDate <= endDate) {
            shouldInclude = true;
            taskDate = dueDate;
            isDue = true;
          }
          // Also include overdue tasks
          else if (dueDate < today) {
            shouldInclude = true;
            taskDate = dueDate;
            isDue = true;
          }

          if (shouldInclude) {
            usedEffectiveDate = dateMode === 'effective' && (!task.dueDate || task.dueDate.getTime() !== rawDueDate.getTime());
          }
        }

        // Check if task has defer date in range (becomes available)
        if (!shouldInclude && rawDeferDate) {
          const deferDate = new Date(rawDeferDate);
          deferDate.setHours(0, 0, 0, 0);

          if (deferDate >= today && deferDate <= endDate) {
            shouldInclude = true;
            taskDate = deferDate;
            isDue = false;
            usedEffectiveDate = dateMode === 'effective' && (!task.deferDate || task.deferDate.getTime() !== rawDeferDate.getTime());
          }
        }

        if (shouldInclude && taskDate) {
          const dateKey = getDateKey(taskDate);
          
          if (!exportData.tasksByDate[dateKey]) {
            exportData.tasksByDate[dateKey] = [];
          }
          
          const taskData = {
            id: task.id.primaryKey,
            name: task.name,
            note: task.note || "",
            taskStatus: getTaskStatus(task.taskStatus),
            flagged: task.flagged,
            dueDate: formatDate(task.dueDate),
            deferDate: formatDate(task.deferDate),
            plannedDate: formatDate(task.plannedDate),
            effectiveDueDate: formatDate(task.effectiveDueDate),
            effectiveDeferDate: formatDate(task.effectiveDeferDate),
            estimatedMinutes: task.estimatedMinutes,
            projectId: task.containingProject ? task.containingProject.id.primaryKey : null,
            projectName: task.containingProject ? task.containingProject.name : null,
            inInbox: task.inInbox,
            isDue: isDue, // Whether this is due or just becoming available
            usedEffectiveDate: usedEffectiveDate, // Bucketed by an inherited date
            tags: task.tags.map(tag => ({
              id: tag.id.primaryKey,
              name: tag.name
            }))
          };
          
          exportData.tasksByDate[dateKey].push(taskData);
        }
      } catch (taskError) {
        console.log(`Error processing forecast task: ${taskError}`);
      }
    });
    
    // Count total tasks
    const totalTasks = Object.values(exportData.tasksByDate).reduce((sum, tasks) => sum + tasks.length, 0);
    console.log(`Successfully processed ${totalTasks} forecast tasks across ${Object.keys(exportData.tasksByDate).length} dates`);
    
    return JSON.stringify(exportData);
    
  } catch (error) {
    console.error(`Error in forecastTasks script: ${error}`);
    return JSON.stringify({
      success: false,
      error: `Error getting forecast tasks: ${error}`
    });
  }
})();