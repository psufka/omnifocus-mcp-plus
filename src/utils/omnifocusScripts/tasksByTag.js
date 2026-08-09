// OmniJS script to get tasks by tag from OmniFocus
(() => {
  try {
    // Parameters will be injected by the script execution system
    const args = typeof injectedArgs !== 'undefined' && injectedArgs ? injectedArgs : {};
    const tagName = args.tagName !== undefined ? args.tagName : null;
    // `args.x ? :` would treat an omitted key as false — check for undefined
    const hideCompleted = args.hideCompleted !== undefined ? args.hideCompleted : true;
    const exactMatch = args.exactMatch !== undefined ? args.exactMatch : false;

    if (!tagName) {
      return JSON.stringify({
        success: false,
        error: "Tag name is required"
      });
    }
    
    // Helper function to format dates consistently
    function formatDate(date) {
      if (!date) return null;
      return date.toISOString();
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
      exportDate: new Date().toISOString(),
      searchTag: tagName,
      exactMatch: exactMatch,
      matchedTags: [],
      tasks: [],
      availableTags: []
    };
    
    // Get all active tags for reference
    const allTags = flattenedTags.filter(tag => tag.active);
    exportData.availableTags = allTags.map(tag => tag.name).sort();
    
    console.log(`Searching for tags matching "${tagName}" (exact: ${exactMatch})`);
    
    // Find matching tags
    let matchingTags = [];
    if (exactMatch) {
      matchingTags = allTags.filter(tag => 
        tag.name.toLowerCase() === tagName.toLowerCase()
      );
    } else {
      matchingTags = allTags.filter(tag => 
        tag.name.toLowerCase().includes(tagName.toLowerCase())
      );
    }
    
    exportData.matchedTags = matchingTags.map(tag => tag.name);
    console.log(`Found ${matchingTags.length} matching tags: ${exportData.matchedTags.join(', ')}`);
    
    if (matchingTags.length === 0) {
      console.log("No matching tags found");
      return JSON.stringify(exportData);
    }
    
    // Get all tasks that have any of the matching tags
    let matchingTasks = [];
    // Set of ids seen so far — a per-task linear scan of matchingTasks made
    // this O(n²) on large tag sets
    const seenTaskIds = new Set();

    matchingTags.forEach(tag => {
      const tasksWithTag = tag.tasks;
      console.log(`Tag "${tag.name}" has ${tasksWithTag.length} tasks`);

      tasksWithTag.forEach(task => {
        // Avoid duplicates (a task might have multiple matching tags)
        const taskId = task.id.primaryKey;
        if (!seenTaskIds.has(taskId)) {
          seenTaskIds.add(taskId);
          matchingTasks.push(task);
        }
      });
    });
    
    console.log(`Found ${matchingTasks.length} unique tasks with matching tags`);
    
    // Filter by completion status if needed
    if (hideCompleted) {
      matchingTasks = matchingTasks.filter(task => 
        task.taskStatus !== Task.Status.Completed && 
        task.taskStatus !== Task.Status.Dropped
      );
    }
    
    console.log(`Processing ${matchingTasks.length} tasks after filtering completed`);
    
    // Process each matching task
    matchingTasks.forEach(task => {
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
        console.log(`Error processing task with tag: ${taskError}`);
      }
    });
    
    console.log(`Successfully processed ${exportData.tasks.length} tasks with matching tags`);
    return JSON.stringify(exportData);
    
  } catch (error) {
    console.error(`Error in tasksByTag script: ${error}`);
    return JSON.stringify({
      success: false,
      error: `Error getting tasks by tag: ${error}`
    });
  }
})();