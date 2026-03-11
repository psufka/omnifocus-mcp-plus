import { runOmniJs } from '../../utils/scriptExecution.js';

// Interface for task creation parameters
export interface AddOmniFocusTaskParams {
  name: string;
  note?: string;
  dueDate?: string; // ISO date string
  deferDate?: string; // ISO date string
  plannedDate?: string; // ISO date string
  flagged?: boolean;
  estimatedMinutes?: number;
  tags?: string[]; // Tag names
  projectName?: string; // Project name to add task to
  parentTaskId?: string; // Parent task ID for subtask creation
  parentTaskName?: string; // Parent task name for subtask creation (alternative to ID)
}

/**
 * Validate parent task parameters to prevent conflicts
 */
async function validateParentTaskParams(params: AddOmniFocusTaskParams): Promise<{ valid: boolean, error?: string }> {
  if (params.parentTaskId && params.parentTaskName) {
    return {
      valid: false,
      error: "Cannot specify both parentTaskId and parentTaskName. Please use only one."
    };
  }

  if ((params.parentTaskId || params.parentTaskName) && params.projectName) {
    return {
      valid: false,
      error: "Cannot specify both parent task and project. Subtasks inherit project from their parent."
    };
  }

  return { valid: true };
}

/**
 * Add a task to OmniFocus
 */
export async function addOmniFocusTask(params: AddOmniFocusTaskParams): Promise<{ success: boolean, taskId?: string, error?: string }> {
  try {
    // Validate parent task parameters
    const validation = await validateParentTaskParams(params);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const script = `
      // Determine location
      let location;
      if (args.parentTaskId) {
        const parent = flattenedTasks.filter(t => t.id.primaryKey === args.parentTaskId)[0];
        if (!parent) {
          return JSON.stringify({ success: false, error: 'Parent task not found with ID: ' + args.parentTaskId });
        }
        location = parent.ending;
      } else if (args.parentTaskName) {
        const matches = flattenedTasks.filter(t => t.name === args.parentTaskName);
        if (matches.length === 0) {
          return JSON.stringify({ success: false, error: 'Parent task not found with name: ' + args.parentTaskName });
        }
        if (matches.length > 1) {
          return JSON.stringify({ success: false, error: 'Ambiguous parent task name: ' + args.parentTaskName + '. Multiple matches found; please use parentTaskId.' });
        }
        location = matches[0].ending;
      } else if (args.projectName) {
        const matches = flattenedProjects.filter(p => p.name === args.projectName);
        if (matches.length === 0) {
          return JSON.stringify({ success: false, error: 'Project not found: ' + args.projectName });
        }
        if (matches.length > 1) {
          return JSON.stringify({ success: false, error: 'Ambiguous project name: ' + args.projectName + '. Multiple matches found.' });
        }
        location = matches[0].ending;
      } else {
        location = inbox.ending;
      }

      const task = new Task(args.name, location);

      // Set properties
      if (args.note) task.note = args.note;
      if (args.dueDate) task.dueDate = new Date(args.dueDate);
      if (args.deferDate) task.deferDate = new Date(args.deferDate);
      try { if (args.plannedDate) task.plannedDate = new Date(args.plannedDate); } catch(e) {}
      if (args.flagged) task.flagged = true;
      if (args.estimatedMinutes) task.estimatedMinutes = args.estimatedMinutes;

      // Add tags
      if (args.tags && args.tags.length > 0) {
        for (const tagName of args.tags) {
          let tag = flattenedTags.filter(t => t.name === tagName)[0];
          if (!tag) {
            tag = new Tag(tagName);
          }
          task.addTag(tag);
        }
      }

      return JSON.stringify({
        success: true,
        taskId: task.id.primaryKey,
        name: task.name
      });
    `;

    const result = await runOmniJs(script, params);
    return {
      success: result.success,
      taskId: result.taskId,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Unknown error in addOmniFocusTask"
    };
  }
}
