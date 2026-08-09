  // OmniJS script to export tasks from the OmniFocus database - Optimized
  (() => {
      try {
        const startTime = new Date();

        // Optional arguments (injected by executeOmniFocusScript as `injectedArgs`).
        // NOTE: the injected parameter block already declares a `hideCompleted` const,
        // so the dump-specific flags below use distinct names to avoid redeclaration.
        const dumpArgs = typeof injectedArgs !== 'undefined' ? injectedArgs : {};
        const dumpHideCompleted = dumpArgs.hideCompleted !== undefined ? dumpArgs.hideCompleted : true;
        const includeCompleted = !dumpHideCompleted;

        // Cap on completed/dropped tasks kept per project (most recent first) so that a
        // full-history dump of a large database cannot blow up the payload.
        const COMPLETED_TASK_CAP = (typeof dumpArgs.completedTaskCap === 'number' && dumpArgs.completedTaskCap > 0)
          ? dumpArgs.completedTaskCap
          : 50;

        // Container key used for completed tasks that live in the inbox
        // (must match INBOX_CONTAINER_KEY in src/tools/definitions/dumpDatabase.ts)
        const INBOX_CONTAINER_KEY = "__inbox__";

        // Helper function to format dates consistently or return null
        function formatDate(date) {
          if (!date) return null;
          return date.toISOString();
        }

        // Timestamp a task was finished (completed or dropped), for cap ordering
        function finishedTimestamp(task) {
          try {
            const finished = task.completionDate || task.dropDate;
            return finished ? finished.getTime() : 0;
          } catch (timestampError) {
            return 0;
          }
        }

        // Textual repetition rule, used to collapse repeating completed instances
        function getRepetitionRuleString(task) {
          try {
            const rule = task.repetitionRule;
            if (!rule) return null;
            return typeof rule.ruleString === 'string' ? rule.ruleString : String(rule);
          } catch (repetitionError) {
            return null;
          }
        }

        // Helper function to safely get enum values - Simplified with direct mapping
        const taskStatusMap = {
          [Task.Status.Available]: "Available",
          [Task.Status.Blocked]: "Blocked",
          [Task.Status.Completed]: "Completed",
          [Task.Status.Dropped]: "Dropped",
          [Task.Status.DueSoon]: "DueSoon",
          [Task.Status.Next]: "Next",
          [Task.Status.Overdue]: "Overdue"
        };

        const projectStatusMap = {
          [Project.Status.Active]: "Active",
          [Project.Status.Done]: "Done",
          [Project.Status.Dropped]: "Dropped",
          [Project.Status.OnHold]: "OnHold"
        };

        const folderStatusMap = {
          [Folder.Status.Active]: "Active",
          [Folder.Status.Dropped]: "Dropped"
        };

        function getEnumValue(enumObj, mapObj) {
          if (enumObj === null || enumObj === undefined) return null;
          return mapObj[enumObj] || "Unknown";
        }

        // Create database export object using Maps for faster lookups
        const exportData = {
          exportDate: new Date().toISOString(),
          tasks: [],
          projects: {},
          folders: {},
          tags: {}
        };

        // Filter active projects first to avoid unnecessary processing
        // (done/dropped projects are only included when completed items were requested)
        const selectedProjects = flattenedProjects.filter(project =>
          includeCompleted || (
            project.status !== Project.Status.Done &&
            project.status !== Project.Status.Dropped
          )
        );

        // Pre-filter active tasks to avoid repeated filtering
        const activeTasks = flattenedTasks.filter(task =>
          task.taskStatus !== Task.Status.Completed &&
          task.taskStatus !== Task.Status.Dropped
        );

        // Pre-filter active folders (dropped folders would orphan their projects when
        // completed items are requested, so they are kept in that mode)
        const selectedFolders = flattenedFolders.filter(folder =>
          includeCompleted || folder.status !== Folder.Status.Dropped
        );

        // Pre-filter active tags (inactive tags are kept when completed items are
        // requested so historical tag names still resolve)
        const selectedTags = flattenedTags.filter(tag => includeCompleted || tag.active);

        // Select completed/dropped tasks, capped per project at the most recent
        // COMPLETED_TASK_CAP by completion (or drop) date.
        const completedSummary = {
          cap: COMPLETED_TASK_CAP,
          totalOmitted: 0,
          omittedByContainer: {}
        };
        let selectedCompletedTasks = [];

        if (includeCompleted) {
          const finishedTasks = flattenedTasks.filter(task =>
            task.taskStatus === Task.Status.Completed ||
            task.taskStatus === Task.Status.Dropped
          );

          const finishedIds = new Set(finishedTasks.map(task => task.id.primaryKey));

          // Group by container so the cap applies per project (inbox is one container)
          const finishedByContainer = new Map();
          finishedTasks.forEach(task => {
            try {
              const containerKey = task.containingProject
                ? task.containingProject.id.primaryKey
                : INBOX_CONTAINER_KEY;
              if (!finishedByContainer.has(containerKey)) {
                finishedByContainer.set(containerKey, []);
              }
              finishedByContainer.get(containerKey).push(task);
            } catch (groupingError) {
              // Silently handle grouping errors
            }
          });

          finishedByContainer.forEach((containerTasks, containerKey) => {
            containerTasks.sort((a, b) => finishedTimestamp(b) - finishedTimestamp(a));

            const kept = containerTasks.slice(0, COMPLETED_TASK_CAP);
            const omitted = containerTasks.length - kept.length;
            if (omitted > 0) {
              completedSummary.omittedByContainer[containerKey] = omitted;
              completedSummary.totalOmitted += omitted;
            }

            // Pull in completed ancestors of kept tasks (not counted against the cap)
            // so nested completed tasks still render under their parent.
            const keptIds = new Set(kept.map(task => task.id.primaryKey));
            const ancestors = [];
            kept.forEach(task => {
              try {
                let parent = task.parent;
                while (parent && finishedIds.has(parent.id.primaryKey) && !keptIds.has(parent.id.primaryKey)) {
                  keptIds.add(parent.id.primaryKey);
                  ancestors.push(parent);
                  parent = parent.parent;
                }
              } catch (ancestorError) {
                // Silently handle ancestor walk errors
              }
            });

            selectedCompletedTasks = selectedCompletedTasks.concat(kept, ancestors);
          });
        }

        // Active tasks first so default output ordering is unchanged
        const selectedTasks = activeTasks.concat(selectedCompletedTasks);

        // Process projects in a single pass and store in Map for O(1) lookups
        const projectsMap = new Map();
        selectedProjects.forEach(project => {
          try {
            const projectId = project.id.primaryKey;
            const projectData = {
              id: projectId,
              name: project.name,
              status: getEnumValue(project.status, projectStatusMap),
              folderID: project.parentFolder ? project.parentFolder.id.primaryKey : null,
              sequential: project.task.sequential || false,
              effectiveDueDate: formatDate(project.effectiveDueDate),
              effectiveDeferDate: formatDate(project.effectiveDeferDate),
              effectivePlannedDate: formatDate(project.effectivePlannedDate),
              dueDate: formatDate(project.dueDate),
              deferDate: formatDate(project.deferDate),
              plannedDate: formatDate(project.plannedDate),
              completedByChildren: project.completedByChildren,
              containsSingletonActions: project.containsSingletonActions,
              note: project.note || "",
              tasks: [] // Will be populated in the task loop
            };
            projectsMap.set(projectId, projectData);
            exportData.projects[projectId] = projectData;
          } catch (projectError) {
            // Silently handle project processing errors
          }
        });

        // Process folders in a single pass
        const foldersMap = new Map();
        selectedFolders.forEach(folder => {
          try {
            const folderId = folder.id.primaryKey;
            const folderData = {
              id: folderId,
              name: folder.name,
              parentFolderID: folder.parent ? folder.parent.id.primaryKey : null,
              status: getEnumValue(folder.status, folderStatusMap),
              projects: [],
              subfolders: []
            };
            foldersMap.set(folderId, folderData);
            exportData.folders[folderId] = folderData;
          } catch (folderError) {
            // Silently handle folder processing errors
          }
        });

        // Process tags in a single pass
        const tagsMap = new Map();
        selectedTags.forEach(tag => {
          try {
            const tagId = tag.id.primaryKey;
            const tagData = {
              id: tagId,
              name: tag.name,
              parentTagID: tag.parent ? tag.parent.id.primaryKey : null,
              active: tag.active,
              allowsNextAction: tag.allowsNextAction,
              tasks: []
            };
            tagsMap.set(tagId, tagData);
            exportData.tags[tagId] = tagData;
          } catch (tagError) {
            // Silently handle tag processing errors
          }
        });

        console.log("Building relationships and processing tasks simultaneously...");

        // Build folder relationships and project-folder relationships as we go
        foldersMap.forEach((folder, folderId) => {
          if (folder.parentFolderID && foldersMap.has(folder.parentFolderID)) {
            const parentFolder = foldersMap.get(folder.parentFolderID);
            if (!parentFolder.subfolders.includes(folder.id)) {
              parentFolder.subfolders.push(folder.id);
            }
          }
        });

        console.log(`Processing ${selectedTasks.length} tasks...`);

        // Process tasks with an optimized approach
        // Process in batches of 100 to prevent UI freezing
        const BATCH_SIZE = 100;

        for (let i = 0; i < selectedTasks.length; i += BATCH_SIZE) {
          const taskBatch = selectedTasks.slice(i, i + BATCH_SIZE);

          taskBatch.forEach(task => {
            try {
              // Get task data with minimal processing
              const taskTags = task.tags.map(tag => tag.id.primaryKey);
              const projectID = task.containingProject ? task.containingProject.id.primaryKey : null;

              const taskData = {
                id: task.id.primaryKey,
                name: task.name,
                note: task.note || "",
                taskStatus: getEnumValue(task.taskStatus, taskStatusMap),
                flagged: task.flagged,
                dueDate: formatDate(task.dueDate),
                deferDate: formatDate(task.deferDate),
                plannedDate: formatDate(task.plannedDate),
                effectiveDueDate: formatDate(task.effectiveDueDate),
                effectiveDeferDate: formatDate(task.effectiveDeferDate),
                effectivePlannedDate: formatDate(task.effectivePlannedDate),
                // Only read completion/repetition metadata when completed items were
                // requested, so the default dump costs exactly what it did before.
                completionDate: includeCompleted ? formatDate(task.completionDate) : null,
                dropDate: includeCompleted ? formatDate(task.dropDate) : null,
                repetitionRule: includeCompleted ? getRepetitionRuleString(task) : null,
                estimatedMinutes: task.estimatedMinutes,
                completedByChildren: task.completedByChildren,
                sequential: task.sequential || false,
                tags: taskTags,
                projectID: projectID,
                parentTaskID: task.parent ? task.parent.id.primaryKey : null,
                children: task.children.map(child => child.id.primaryKey),
                inInbox: task.inInbox
              };

              // Add task to export
              exportData.tasks.push(taskData);

              // Add task ID to associated project (if it exists)
              if (projectID && projectsMap.has(projectID)) {
                projectsMap.get(projectID).tasks.push(taskData.id);

                // Update folder-project relationship (only once per project)
                const project = projectsMap.get(projectID);
                if (project.folderID && foldersMap.has(project.folderID)) {
                  const folder = foldersMap.get(project.folderID);
                  if (!folder.projects.includes(project.id)) {
                    folder.projects.push(project.id);
                  }
                }
              }

              // Add task ID to associated tags
              taskTags.forEach(tagID => {
                if (tagsMap.has(tagID)) {
                  tagsMap.get(tagID).tasks.push(taskData.id);
                }
              });
            } catch (taskError) {
              // Silently handle task processing errors
            }
          });
        }

        // Only report the completed-task cap when completed items were requested, so the
        // default payload is unchanged.
        if (includeCompleted) {
          exportData.completedSummary = completedSummary;
        }

        // Return the complete database export
        const jsonData = JSON.stringify(exportData);
        return jsonData;

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `Error exporting database: ${error}`
        });
      }
    }
  )();
