import { runOmniJs } from '../../utils/scriptExecution.js';

export interface DuplicateTaskParams {
  taskId?: string;
  taskName?: string;
  newName?: string;
  newProjectId?: string;
  newProjectName?: string;
  includeTags?: boolean;
  includeNote?: boolean;
}

export async function duplicateTask(params: DuplicateTaskParams): Promise<any> {
  if (!params.taskId && !params.taskName) {
    return { success: false, error: "Either taskId or taskName must be provided" };
  }

  const script = `
    // Find source task
    let source;
    if (args.taskId) {
      source = flattenedTasks.filter(t => t.id.primaryKey === args.taskId)[0];
    } else {
      const matches = flattenedTasks.filter(t => t.name === args.taskName);
      if (matches.length > 1) {
        return JSON.stringify({ success: false, error: 'Ambiguous task name: multiple matches found. Please use taskId.' });
      }
      source = matches[0];
    }
    if (!source) return JSON.stringify({ success: false, error: 'Source task not found' });

    // Determine destination
    let location;
    if (args.newProjectId) {
      const proj = flattenedProjects.filter(p => p.id.primaryKey === args.newProjectId)[0];
      if (!proj) return JSON.stringify({ success: false, error: 'Destination project not found by ID' });
      location = proj.ending;
    } else if (args.newProjectName) {
      const matches = flattenedProjects.filter(p => p.name === args.newProjectName);
      if (matches.length === 0) return JSON.stringify({ success: false, error: 'Destination project not found by name' });
      if (matches.length > 1) return JSON.stringify({ success: false, error: 'Ambiguous destination project name. Please use newProjectId.' });
      location = matches[0].ending;
    } else if (source.containingProject) {
      location = source.containingProject.ending;
    } else {
      location = inbox.ending;
    }

    // Create the duplicate
    const newTask = new Task(args.newName || source.name, location);

    // Copy note
    if (args.includeNote !== false && source.note) {
      newTask.note = source.note;
    }

    // Copy dates
    if (source.dueDate) newTask.dueDate = source.dueDate;
    if (source.deferDate) newTask.deferDate = source.deferDate;
    try { if (source.plannedDate) newTask.plannedDate = source.plannedDate; } catch(e) {}

    // Copy properties
    newTask.flagged = source.flagged;
    if (source.estimatedMinutes) newTask.estimatedMinutes = source.estimatedMinutes;

    // Copy tags
    if (args.includeTags !== false) {
      const sourceTags = source.tags.filter(() => true);
      for (const tag of sourceTags) {
        newTask.addTag(tag);
      }
    }

    return JSON.stringify({
      success: true,
      id: newTask.id.primaryKey,
      name: newTask.name,
      sourceId: source.id.primaryKey,
      sourceName: source.name
    });
  `;

  return await runOmniJs(script, params);
}
