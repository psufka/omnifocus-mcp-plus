import { runOmniJs } from '../../utils/scriptExecution.js';

// Status options for tasks and projects
type TaskStatus = 'incomplete' | 'completed' | 'dropped';
type ProjectStatus = 'active' | 'completed' | 'dropped' | 'onHold';

// Interface for item edit parameters
export interface EditItemParams {
  id?: string;                  // ID of the task or project to edit
  name?: string;                // Name of the task or project to edit (as fallback if ID not provided)
  itemType: 'task' | 'project'; // Type of item to edit

  // Common editable fields
  newName?: string;             // New name for the item
  newNote?: string;             // New note for the item
  newDueDate?: string;          // New due date in ISO format (empty string to clear)
  newDeferDate?: string;        // New defer date in ISO format (empty string to clear)
  newPlannedDate?: string;      // New planned date in ISO format (empty string to clear)
  newFlagged?: boolean;         // New flagged status (false to remove flag, true to add flag)
  newEstimatedMinutes?: number; // New estimated minutes

  // Task-specific fields
  newStatus?: TaskStatus;       // New status for tasks (incomplete, completed, dropped)
  addTags?: string[];           // Tags to add to the task
  removeTags?: string[];        // Tags to remove from the task
  replaceTags?: string[];       // Tags to replace all existing tags with
  newProjectId?: string;        // Move task to a new project by ID
  newProjectName?: string;      // Move task to a new project by name
  newParentTaskId?: string;     // Move task under a new parent task by ID
  newParentTaskName?: string;   // Move task under a new parent task by name
  moveToInbox?: boolean;        // Move task to inbox

  // Project-specific fields
  newSequential?: boolean;      // Whether the project should be sequential
  newFolderName?: string;       // New folder to move the project to
  newProjectStatus?: ProjectStatus; // New status for projects
}

function hasTaskMoveTarget(params: EditItemParams): boolean {
  return Boolean(
    params.newProjectId ||
    params.newProjectName ||
    params.newParentTaskId ||
    params.newParentTaskName ||
    params.moveToInbox === true
  );
}

/**
 * Validate edit parameters before script generation.
 */
export function validateEditItemParams(params: EditItemParams): { valid: boolean; error?: string } {
  if (!params.id && !params.name) {
    return {
      valid: false,
      error: 'Either id or name must be provided'
    };
  }

  const hasMoveTarget = hasTaskMoveTarget(params);

  if (params.itemType !== 'task' && hasMoveTarget) {
    return {
      valid: false,
      error: 'Task move parameters are only supported when itemType is "task".'
    };
  }

  if (params.itemType === 'task') {
    if (params.newProjectId && params.newProjectName) {
      return {
        valid: false,
        error: 'Cannot specify both newProjectId and newProjectName. Please use only one.'
      };
    }

    if (params.newParentTaskId && params.newParentTaskName) {
      return {
        valid: false,
        error: 'Cannot specify both newParentTaskId and newParentTaskName. Please use only one.'
      };
    }

    const destinationTypeCount = [
      params.newProjectId || params.newProjectName ? 1 : 0,
      params.newParentTaskId || params.newParentTaskName ? 1 : 0,
      params.moveToInbox === true ? 1 : 0
    ].reduce((sum, val) => sum + val, 0);

    if (destinationTypeCount > 1) {
      return {
        valid: false,
        error: 'Invalid destination selection: specify exactly one destination type (project, parent task, or inbox).'
      };
    }
  }

  return { valid: true };
}

/**
 * Edit a task or project in OmniFocus
 */
export async function editItem(params: EditItemParams): Promise<{
  success: boolean,
  id?: string,
  name?: string,
  changedProperties?: string,
  error?: string
}> {
  try {
    const validation = validateEditItemParams(params);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const script = `
      const collection = args.itemType === 'task' ? flattenedTasks : flattenedProjects;
      const changedProperties = [];

      // Find the item
      let item;
      if (args.id) {
        item = collection.filter(o => o.id.primaryKey === args.id)[0];
      }
      if (!item && args.name) {
        const matches = collection.filter(o => o.name === args.name);
        if (matches.length > 1) {
          return JSON.stringify({
            success: false,
            error: 'Ambiguous ' + args.itemType + ' name: ' + args.name + '. Multiple matches found; please use id.'
          });
        }
        item = matches[0];
      }
      if (!item) {
        return JSON.stringify({ success: false, error: 'Item not found' });
      }

      const itemId = item.id.primaryKey;
      const itemName = item.name;

      // --- Task move (do first, before property edits) ---
      if (args.itemType === 'task') {
        if (args.moveToInbox === true) {
          moveTasks([item], inbox.ending);
          changedProperties.push('moved (inbox)');
        } else if (args.newProjectId || args.newProjectName) {
          let destProject;
          if (args.newProjectId) {
            destProject = flattenedProjects.filter(p => p.id.primaryKey === args.newProjectId)[0];
            if (!destProject) {
              return JSON.stringify({ success: false, error: 'Destination project not found with ID: ' + args.newProjectId });
            }
          } else {
            const matches = flattenedProjects.filter(p => p.name === args.newProjectName);
            if (matches.length === 0) {
              return JSON.stringify({ success: false, error: 'Destination project not found with name: ' + args.newProjectName });
            }
            if (matches.length > 1) {
              return JSON.stringify({ success: false, error: 'Ambiguous destination project name: ' + args.newProjectName + '. Multiple matches found; please use project id.' });
            }
            destProject = matches[0];
          }
          moveTasks([item], destProject.ending);
          changedProperties.push('moved (project)');
        } else if (args.newParentTaskId || args.newParentTaskName) {
          let destParent;
          if (args.newParentTaskId) {
            destParent = flattenedTasks.filter(t => t.id.primaryKey === args.newParentTaskId)[0];
            if (!destParent) {
              return JSON.stringify({ success: false, error: 'Destination parent task not found with ID: ' + args.newParentTaskId });
            }
          } else {
            const matches = flattenedTasks.filter(t => t.name === args.newParentTaskName);
            if (matches.length === 0) {
              return JSON.stringify({ success: false, error: 'Destination parent task not found with name: ' + args.newParentTaskName });
            }
            if (matches.length > 1) {
              return JSON.stringify({ success: false, error: 'Ambiguous destination parent task name: ' + args.newParentTaskName + '. Multiple matches found; please use parent task id.' });
            }
            destParent = matches[0];
          }

          // Cycle prevention: walk up from destParent, ensure we don't find item
          let cursor = destParent;
          while (cursor) {
            if (cursor.id.primaryKey === itemId) {
              return JSON.stringify({ success: false, error: 'Invalid move target: cannot move a task into itself or its descendants.' });
            }
            const parent = cursor.parent;
            cursor = (parent && parent.constructor === Task) ? parent : null;
          }

          moveTasks([item], destParent.ending);
          changedProperties.push('moved (parent task)');
        }
      }

      // --- Common property updates ---
      if (args.newName !== undefined) {
        item.name = args.newName;
        changedProperties.push('name');
      }

      if (args.newNote !== undefined) {
        item.note = args.newNote;
        changedProperties.push('note');
      }

      if (args.newDueDate !== undefined) {
        if (args.newDueDate === '') {
          item.dueDate = null;
        } else {
          item.dueDate = new Date(args.newDueDate);
        }
        changedProperties.push('due date');
      }

      if (args.newDeferDate !== undefined) {
        if (args.newDeferDate === '') {
          item.deferDate = null;
        } else {
          item.deferDate = new Date(args.newDeferDate);
        }
        changedProperties.push('defer date');
      }

      if (args.newPlannedDate !== undefined) {
        try {
          if (args.newPlannedDate === '') {
            item.plannedDate = null;
          } else {
            item.plannedDate = new Date(args.newPlannedDate);
          }
          changedProperties.push('planned date');
        } catch(e) {}
      }

      if (args.newFlagged !== undefined) {
        item.flagged = args.newFlagged;
        changedProperties.push('flagged');
      }

      if (args.newEstimatedMinutes !== undefined) {
        item.estimatedMinutes = args.newEstimatedMinutes;
        changedProperties.push('estimated minutes');
      }

      // --- Task-specific updates ---
      if (args.itemType === 'task') {
        if (args.newStatus !== undefined) {
          if (args.newStatus === 'completed') {
            item.markComplete();
            changedProperties.push('status (completed)');
          } else if (args.newStatus === 'dropped') {
            item.drop(true);
            changedProperties.push('status (dropped)');
          } else if (args.newStatus === 'incomplete') {
            item.markIncomplete();
            changedProperties.push('status (incomplete)');
          }
        }

        // Tag operations
        if (args.replaceTags && args.replaceTags.length > 0) {
          // Clear all existing tags
          item.clearTags();
          // Add new tags
          for (const tagName of args.replaceTags) {
            let tag = flattenedTags.filter(t => t.name === tagName)[0];
            if (!tag) tag = new Tag(tagName);
            item.addTag(tag);
          }
          changedProperties.push('tags (replaced)');
        } else {
          if (args.addTags && args.addTags.length > 0) {
            for (const tagName of args.addTags) {
              let tag = flattenedTags.filter(t => t.name === tagName)[0];
              if (!tag) tag = new Tag(tagName);
              item.addTag(tag);
            }
            changedProperties.push('tags (added)');
          }

          if (args.removeTags && args.removeTags.length > 0) {
            for (const tagName of args.removeTags) {
              const tag = flattenedTags.filter(t => t.name === tagName)[0];
              if (tag) {
                item.removeTag(tag);
              }
            }
            changedProperties.push('tags (removed)');
          }
        }
      }

      // --- Project-specific updates ---
      if (args.itemType === 'project') {
        if (args.newSequential !== undefined) {
          item.sequential = args.newSequential;
          changedProperties.push('sequential');
        }

        if (args.newProjectStatus !== undefined) {
          const statusMap = {
            'active': Project.Status.Active,
            'completed': Project.Status.Done,
            'dropped': Project.Status.Dropped,
            'onHold': Project.Status.OnHold
          };
          const newStatus = statusMap[args.newProjectStatus];
          if (newStatus !== undefined) {
            if (args.newProjectStatus === 'completed') {
              item.markComplete();
            } else if (args.newProjectStatus === 'dropped') {
              item.drop(true);
            } else {
              item.status = newStatus;
            }
            changedProperties.push('status');
          }
        }

        if (args.newFolderName !== undefined) {
          let destFolder = flattenedFolders.filter(f => f.name === args.newFolderName)[0];
          if (!destFolder) {
            destFolder = new Folder(args.newFolderName);
          }
          moveProjects([item], destFolder);
          changedProperties.push('folder');
        }
      }

      return JSON.stringify({
        success: true,
        id: itemId,
        name: item.name,
        changedProperties: changedProperties.join(', ')
      });
    `;

    const result = await runOmniJs(script, params);
    return {
      success: result.success,
      id: result.id,
      name: result.name,
      changedProperties: result.changedProperties,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Unknown error in editItem'
    };
  }
}
