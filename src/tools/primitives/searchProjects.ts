import { runOmniJs } from '../../utils/scriptExecution.js';

export interface SearchProjectsParams {
  query: string;
  limit?: number;
}

export async function searchProjects(params: SearchProjectsParams): Promise<any> {
  const script = `
    const statusNameMap = {};
    statusNameMap[Project.Status.Active] = 'active';
    statusNameMap[Project.Status.OnHold] = 'on_hold';
    statusNameMap[Project.Status.Done] = 'completed';
    statusNameMap[Project.Status.Dropped] = 'dropped';

    const query = args.query.toLowerCase();
    const limit = args.limit || 50;

    let projects = Array.from(document.flattenedProjects).filter(p =>
      p.name.toLowerCase().includes(query)
    );

    projects = projects.slice(0, limit);

    const result = projects.map(p => ({
      id: p.id.primaryKey,
      name: p.name,
      status: statusNameMap[p.status] || 'unknown',
      folderName: p.parentFolder ? p.parentFolder.name : null
    }));

    return JSON.stringify({ success: true, projects: result, count: result.length });
  `;
  return await runOmniJs(script, params);
}
