import { runOmniJs } from '../../utils/scriptExecution.js';

export interface GetProjectCountsParams {
  folder?: string;
}

export async function getProjectCounts(params: GetProjectCountsParams = {}): Promise<any> {
  const script = `
    let projects = Array.from(document.flattenedProjects);

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
        const remaining = p.flattenedTasks.some(t => t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped);
        if (remaining && p.nextTask === null) stalled++;
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
  return await runOmniJs(script, params);
}
