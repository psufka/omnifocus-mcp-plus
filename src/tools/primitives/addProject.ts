import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { OMNIJS_CREATE_PROJECT_HELPER, OMNIJS_CREATE_TASK_HELPER, OMNIJS_PLACEMENT_HELPERS, normalizeItemDates } from './addOmniFocusTask.js';

export interface AddProjectParams {
  name: string;
  note?: string;
  dueDate?: string; // ISO date string
  deferDate?: string; // ISO date string
  plannedDate?: string; // ISO date string
  flagged?: boolean;
  estimatedMinutes?: number;
  tagIds?: string[];
  tags?: string[]; // Tag names
  folderName?: string; // Folder name or ID to add project to
  sequential?: boolean; // Whether tasks should be sequential or parallel
}


export const ADD_PROJECT_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${OMNIJS_PLACEMENT_HELPERS}
  ${OMNIJS_CREATE_TASK_HELPER}
  ${OMNIJS_CREATE_PROJECT_HELPER}
  const warnings = [];
  const created = __createProject(args, warnings);
  if (created.error) return JSON.stringify({ success: false, error: created.error });
  const check = __verifyProjectPlacement(created.project, created.placement);
  if (!__verifyTagPlan(created.project, created.tagPlan)) {
    check.verified = false;
    check.warning = 'Tag verification failed: requested tag IDs were not all retained. Check mutually exclusive tag groups.';
  }
  return JSON.stringify({
    success: check.exists, projectId: created.project.id.primaryKey, name: created.project.name,
    verified: check.verified, warning: check.warning, warnings: warnings,
    tagIds: __tagIds(created.project), requestedPlacement: __publicPlacement(created.placement),
    actualPlacement: __publicPlacement(check.actual)
  });
`;

export async function addProject(params: AddProjectParams) {
  try {
    return await runOmniJs(ADD_PROJECT_SCRIPT, normalizeItemDates(params));
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unknown error in addProject' };
  }
}
