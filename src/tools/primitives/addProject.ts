import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { toLocalDateTimeString } from '../../utils/localDate.js';

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
  folderName?: string; // Folder name or ID to add project to
  sequential?: boolean; // Whether tasks should be sequential or parallel
}

/**
 * Add a project to OmniFocus
 */
export async function addProject(params: AddProjectParams): Promise<{ success: boolean, projectId?: string, name?: string, warnings?: string[], error?: string }> {
  const script = `
    ${OMNIJS_LOOKUP_HELPERS}
    const warnings = [];

    // Determine location
    let location;
    if (args.folderName) {
      const allFolders = flattenedFolders.filter(() => true);
      const resolved = __resolveByNameOrId(allFolders, args.folderName, 'Folder');
      if (resolved.error) return JSON.stringify({ success: false, error: resolved.error });
      location = resolved.item.ending;
    } else {
      location = library.ending;
    }

    const project = new Project(args.name, location);

    // Set properties
    if (args.note) project.note = args.note;
    if (args.dueDate) project.dueDate = new Date(args.dueDate);
    if (args.deferDate) project.deferDate = new Date(args.deferDate);
    if (args.plannedDate) {
      // plannedDate is unsupported on older OmniFocus builds — record the
      // failure rather than swallowing it and reporting a clean success.
      try {
        project.plannedDate = new Date(args.plannedDate);
      } catch (e) {
        warnings.push('plannedDate was not set: ' + e.message);
      }
    }
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
      name: project.name,
      warnings: warnings
    });
  `;

  // Bare "YYYY-MM-DD" parses as UTC midnight, which lands on the previous day
  // west of UTC. Normalize to local midnight before the strings reach OmniJS.
  const normalized: AddProjectParams = {
    ...params,
    ...(params.dueDate ? { dueDate: toLocalDateTimeString(params.dueDate) } : {}),
    ...(params.deferDate ? { deferDate: toLocalDateTimeString(params.deferDate) } : {}),
    ...(params.plannedDate ? { plannedDate: toLocalDateTimeString(params.plannedDate) } : {})
  };

  try {
    const result = await runOmniJs(script, normalized);
    return {
      success: result.success,
      projectId: result.projectId,
      name: result.name,
      warnings: result.warnings,
      error: result.error
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Unknown error in addProject"
    };
  }
}
