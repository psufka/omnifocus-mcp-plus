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

    // A window is required: reading a perspective's contents goes through the
    // window's content tree.
    if (!document.windows || document.windows.length === 0) {
      throw new Error("OmniFocus has no open window; open one and retry");
    }

    const targetWindow = document.windows[0];

    // Remember the user's current perspective so the window can be restored —
    // this is a read-only tool and must not leave the front window switched.
    const previousPerspective = targetWindow.perspective;

    // Map to store all tasks keyed by task ID (supports hierarchical relationships)
    let taskMap = {};

    function collectTasks(node, parentId) {
      if (node.object && node.object instanceof Task && __isRealTask(node.object)) {
        let t = node.object;
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

        // Recursively collect child tasks
        node.children.forEach(childNode => {
          if (childNode.object && childNode.object instanceof Task) {
            let childId = childNode.object.id.primaryKey;
            taskMap[id].children.push(childId);
            collectTasks(childNode, id);
          } else {
            collectTasks(childNode, id);
          }
        });
      } else {
        // Not a task node — recurse into children
        node.children.forEach(childNode => collectTasks(childNode, parentId));
      }
    }

    // Switch to the requested perspective only long enough to read its content
    // tree, then always switch back — even if collection throws.
    targetWindow.perspective = perspective;
    try {
      // Traverse the content tree to collect task info (including hierarchy)
      const rootNode = targetWindow.content ? targetWindow.content.rootNode : null;

      // Start collecting tasks (root tasks have parent = null)
      if (rootNode && rootNode.children) {
        rootNode.children.forEach(node => collectTasks(node, null));
      }
    } finally {
      if (previousPerspective) {
        try {
          targetWindow.perspective = previousPerspective;
        } catch (restoreError) {
          // Restoring is best-effort; never mask the original result/error.
        }
      }
    }

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
