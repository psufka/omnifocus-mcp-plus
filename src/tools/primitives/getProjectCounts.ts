import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_PROJECT_ACTIONS } from '../../utils/projectActions.js';

export interface GetProjectCountsParams {
  folder?: string;
}

export const GET_PROJECT_COUNTS_SCRIPT = `
    ${OMNIJS_PROJECT_ACTIONS}
    const now = new Date();
    let projects = flattenedProjects.filter(() => true);

    if (args.folder) {
      const folderName = args.folder.toLowerCase();
      projects = projects.filter(p => {
        let f = p.parentFolder;
        while (f) {
          if (f.name.toLowerCase() === folderName) return true;
          f = f.parent;
        }
        return false;
      });
    }

    let active = 0, onHold = 0, completed = 0, dropped = 0, stalled = 0;
    projects.forEach(p => {
      if (p.status === Project.Status.Active) {
        active++;
        if (p.task.taskStatus !== Task.Status.Dropped && __projectActions(p, now).noNextAction) stalled++;
      }
      else if (p.status === Project.Status.OnHold) onHold++;
      else if (p.status === Project.Status.Done) completed++;
      else if (p.status === Project.Status.Dropped) dropped++;
    });

    return JSON.stringify({
      success: true,
      total: projects.length,
      active: active,
      onHold: onHold,
      completed: completed,
      dropped: dropped,
      stalled: stalled
    });
  `;
export async function getProjectCounts(params: GetProjectCountsParams = {}): Promise<any> {
  return await runOmniJs(GET_PROJECT_COUNTS_SCRIPT, params, { readOnly: true });
}
