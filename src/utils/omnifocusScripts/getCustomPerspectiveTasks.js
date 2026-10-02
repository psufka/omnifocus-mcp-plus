// Get tasks from a custom perspective by name (supports hierarchical relationships)
// Based on and improved from user-provided code

(() => {
  /* @task-query-helpers */
  // Get injected arguments. Read once here so the catch block below does not
  // depend on the injected top-level bindings. Named distinctly so it can never
  // collide with an injected `perspectiveName` declaration in this scope.
  const requestedPerspectiveName = (typeof injectedArgs !== 'undefined' && injectedArgs && injectedArgs.perspectiveName)
    ? injectedArgs.perspectiveName
    : null;

  try {
    if (!requestedPerspectiveName) {
      throw new Error("Perspective name cannot be empty");
    }

    // Look up the custom perspective by name
    let perspective = Perspective.Custom.byName(requestedPerspectiveName);
    if (!perspective) {
      throw new Error(`No custom perspective found with name "${requestedPerspectiveName}"`);
    }

    // The native wrapper reads a separate window and supplies its outline.
    // Never fall back to the user's window: search and sidebar selections can
    // silently narrow it, even after assigning a different perspective.
    if (typeof perspectiveNodes === 'undefined' || !Array.isArray(perspectiveNodes)) {
      throw new Error("The isolated perspective outline was not provided");
    }

    // Map to store all tasks keyed by task ID (supports hierarchical relationships)
    let taskMap = {};

    function collectTasks(node, parentId) {
      const task = node.id ? Task.byIdentifier(node.id) : null;
      if (task && __isRealTask(task)) {
        let t = task;
        let id = t.id.primaryKey;

        // Record task info (including hierarchical relationships)
        taskMap[id] = {
          id: id,
          name: t.name,
          note: t.note || "",
          project: t.containingProject ? t.containingProject.name : (t.project ? t.project.name : null),
          tags: t.tags ? t.tags.map(tag => tag.name) : [],
          dueDate: t.dueDate ? t.dueDate.toISOString() : null,
          deferDate: t.deferDate ? t.deferDate.toISOString() : null,
          plannedDate: t.plannedDate ? t.plannedDate.toISOString() : null,
          completed: t.completed,
          flagged: t.flagged,
          estimatedMinutes: t.estimatedMinutes || null,
          repetitionRule: t.repetitionRule ? t.repetitionRule.toString() : null,
          creationDate: t.added ? t.added.toISOString() : null,
          completionDate: t.completedDate ? t.completedDate.toISOString() : null,
          parent: parentId,     // Parent task ID
          children: [],         // Child task IDs, populated below
        };

        if (parentId) taskMap[parentId].children.push(id);
        node.children.forEach(childNode => collectTasks(childNode, id));
      } else {
        // Not a task node — recurse into children
        node.children.forEach(childNode => collectTasks(childNode, parentId));
      }
    }

    perspectiveNodes.forEach(node => collectTasks(node, null));

    // Count total tasks
    const taskCount = Object.keys(taskMap).length;

    // Return result (including hierarchical structure)
    const result = {
      success: true,
      perspectiveName: requestedPerspectiveName,
      perspectiveId: perspective.identifier,
      count: taskCount,
      taskMap: taskMap
    };

    return JSON.stringify(result);

  } catch (error) {
    // Error handling
    const errorResult = {
      success: false,
      error: error.message || String(error),
      perspectiveName: requestedPerspectiveName,
      perspectiveId: null,
      count: 0,
      taskMap: {}
    };

    return JSON.stringify(errorResult);
  }
})();
