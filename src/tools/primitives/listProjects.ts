import { runOmniJs } from '../../utils/scriptExecution.js';

export interface ListProjectsParams {
  folder?: string;
  status?: 'active' | 'on_hold' | 'completed' | 'dropped';
  completedBefore?: string;
  completedAfter?: string;
  stalledOnly?: boolean;
  sortBy?: 'name' | 'dueDate' | 'completionDate' | 'remainingTaskCount';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

export async function listProjects(params: ListProjectsParams = {}): Promise<any> {
  const script = `
    const statusMap = {
      'active': Project.Status.Active,
      'on_hold': Project.Status.OnHold,
      'completed': Project.Status.Done,
      'dropped': Project.Status.Dropped
    };
    const statusNameMap = {};
    statusNameMap[Project.Status.Active] = 'active';
    statusNameMap[Project.Status.OnHold] = 'on_hold';
    statusNameMap[Project.Status.Done] = 'completed';
    statusNameMap[Project.Status.Dropped] = 'dropped';

    let projects = Array.from(document.flattenedProjects);

    // Filter by folder
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

    // Filter by status
    if (args.status) {
      const targetStatus = statusMap[args.status];
      if (targetStatus) {
        projects = projects.filter(p => p.status === targetStatus);
      }
    }

    // Filter by completion dates
    if (args.completedBefore) {
      const before = new Date(args.completedBefore);
      projects = projects.filter(p => p.completionDate && p.completionDate < before);
    }
    if (args.completedAfter) {
      const after = new Date(args.completedAfter);
      projects = projects.filter(p => p.completionDate && p.completionDate > after);
    }

    // Filter stalled only
    if (args.stalledOnly) {
      projects = projects.filter(p =>
        p.status === Project.Status.Active &&
        p.flattenedTasks.some(t => t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped) &&
        p.nextTask === null
      );
    }

    // Sort
    const sortBy = args.sortBy || 'name';
    const sortOrder = args.sortOrder || 'asc';
    projects.sort((a, b) => {
      let valA, valB;
      if (sortBy === 'name') { valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); }
      else if (sortBy === 'dueDate') { valA = a.dueDate ? a.dueDate.getTime() : Infinity; valB = b.dueDate ? b.dueDate.getTime() : Infinity; }
      else if (sortBy === 'completionDate') { valA = a.completionDate ? a.completionDate.getTime() : Infinity; valB = b.completionDate ? b.completionDate.getTime() : Infinity; }
      else if (sortBy === 'remainingTaskCount') {
        valA = a.flattenedTasks.filter(t => t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped).length;
        valB = b.flattenedTasks.filter(t => t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped).length;
      }
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // Limit
    const limit = args.limit || 100;
    projects = projects.slice(0, limit);

    // Map to output
    const result = projects.map(p => {
      const allTasks = Array.from(p.flattenedTasks);
      const remaining = allTasks.filter(t => t.taskStatus !== Task.Status.Completed && t.taskStatus !== Task.Status.Dropped).length;
      const isStalled = p.status === Project.Status.Active && remaining > 0 && p.nextTask === null;
      return {
        id: p.id.primaryKey,
        name: p.name,
        status: statusNameMap[p.status] || 'unknown',
        folderName: p.parentFolder ? p.parentFolder.name : null,
        taskCount: allTasks.length,
        remainingTaskCount: remaining,
        dueDate: p.dueDate ? p.dueDate.toISOString() : null,
        completionDate: p.completionDate ? p.completionDate.toISOString() : null,
        sequential: p.sequential,
        isStalled: isStalled,
        nextTaskName: p.nextTask ? p.nextTask.name : null
      };
    });

    return JSON.stringify({ success: true, projects: result, count: result.length });
  `;
  return await runOmniJs(script, params);
}
