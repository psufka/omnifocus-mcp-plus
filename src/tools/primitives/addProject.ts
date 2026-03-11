import { runOmniJs } from '../../utils/scriptExecution.js';

// Interface for project creation parameters
export interface AddProjectParams {
  name: string;
  note?: string;
  dueDate?: string; // ISO date string
  deferDate?: string; // ISO date string
  plannedDate?: string; // ISO date string
  flagged?: boolean;
  estimatedMinutes?: number;
  tags?: string[]; // Tag names
  folderName?: string; // Folder name to add project to
  sequential?: boolean; // Whether tasks should be sequential or parallel
}

/**
 * Add a project to OmniFocus
 */
export async function addProject(params: AddProjectParams): Promise<{ success: boolean, projectId?: string, error?: string }> {
  const script = `
    // Determine location
    let location;
    if (args.folderName) {
      const folder = flattenedFolders.filter(f => f.name === args.folderName)[0];
      if (!folder) {
        return JSON.stringify({ success: false, error: 'Folder not found: ' + args.folderName });
      }
      location = folder.ending;
    } else {
      location = library.ending;
    }

    const project = new Project(args.name, location);

    // Set properties
    if (args.note) project.note = args.note;
    if (args.dueDate) project.dueDate = new Date(args.dueDate);
    if (args.deferDate) project.deferDate = new Date(args.deferDate);
    try { if (args.plannedDate) project.plannedDate = new Date(args.plannedDate); } catch(e) {}
    if (args.flagged) project.flagged = true;
    if (args.estimatedMinutes) project.estimatedMinutes = args.estimatedMinutes;
    if (args.sequential !== undefined) project.sequential = args.sequential;

    // Add tags
    if (args.tags && args.tags.length > 0) {
      for (const tagName of args.tags) {
        let tag = flattenedTags.filter(t => t.name === tagName)[0];
        if (!tag) {
          tag = new Tag(tagName);
        }
        project.addTag(tag);
      }
    }

    return JSON.stringify({
      success: true,
      projectId: project.id.primaryKey,
      name: project.name
    });
  `;

  try {
    const result = await runOmniJs(script, params);
    return {
      success: result.success,
      projectId: result.projectId,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Unknown error in addProject"
    };
  }
}
