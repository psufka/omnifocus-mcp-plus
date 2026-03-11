import { runOmniJs } from '../../utils/scriptExecution.js';

export async function listFolders(params: { limit?: number } = {}): Promise<any> {
  const script = `
    const limit = args.limit || 100;
    const folders = flattenedFolders.filter(() => true).slice(0, limit);
    const result = folders.map(f => ({
      id: f.id.primaryKey,
      name: f.name,
      parentName: f.parent && f.parent.name && f.parent !== library ? f.parent.name : null,
      projectCount: f.projects.filter(() => true).length
    }));
    return JSON.stringify({ success: true, folders: result, count: result.length });
  `;
  return await runOmniJs(script, params);
}

export async function getFolder(params: { name_or_id: string }): Promise<any> {
  const script = `
    const allFolders = flattenedFolders.filter(() => true);
    let folder = allFolders.filter(f => f.id.primaryKey === args.name_or_id)[0];
    if (!folder) {
      const lower = args.name_or_id.toLowerCase();
      folder = allFolders.filter(f => f.name.toLowerCase() === lower)[0];
    }
    if (!folder) return JSON.stringify({ success: false, error: 'Folder not found: ' + args.name_or_id });

    const statusNameMap = {};
    statusNameMap[Folder.Status.Active] = 'active';
    statusNameMap[Folder.Status.Dropped] = 'dropped';

    const projects = folder.projects.filter(() => true).map(p => ({
      id: p.id.primaryKey,
      name: p.name,
      status: p.status === Project.Status.Active ? 'active' : p.status === Project.Status.OnHold ? 'on_hold' : p.status === Project.Status.Done ? 'completed' : 'dropped'
    }));
    const subfolders = folder.folders.filter(() => true).map(f => ({
      id: f.id.primaryKey,
      name: f.name
    }));

    return JSON.stringify({
      success: true,
      id: folder.id.primaryKey,
      name: folder.name,
      status: statusNameMap[folder.status] || 'active',
      parentName: folder.parent && folder.parent.name && folder.parent !== library ? folder.parent.name : null,
      projects: projects,
      subfolders: subfolders
    });
  `;
  return await runOmniJs(script, params);
}

export async function createFolder(params: { name: string; parent?: string }): Promise<any> {
  const script = `
    let location = library.ending;

    if (args.parent) {
      const allFolders = flattenedFolders.filter(() => true);
      const lower = args.parent.toLowerCase();
      const parentFolder = allFolders.filter(f => f.id.primaryKey === args.parent)[0] ||
                           allFolders.filter(f => f.name.toLowerCase() === lower)[0];
      if (!parentFolder) return JSON.stringify({ success: false, error: 'Parent folder not found: ' + args.parent });
      location = parentFolder.ending;
    }

    const folder = new Folder(args.name, location);
    return JSON.stringify({
      success: true,
      id: folder.id.primaryKey,
      name: folder.name
    });
  `;
  return await runOmniJs(script, params);
}

export async function updateFolder(params: { name_or_id: string; name?: string; status?: 'active' | 'dropped' }): Promise<any> {
  const script = `
    const allFolders = flattenedFolders.filter(() => true);
    let folder = allFolders.filter(f => f.id.primaryKey === args.name_or_id)[0];
    if (!folder) {
      const lower = args.name_or_id.toLowerCase();
      folder = allFolders.filter(f => f.name.toLowerCase() === lower)[0];
    }
    if (!folder) return JSON.stringify({ success: false, error: 'Folder not found: ' + args.name_or_id });

    if (args.name) folder.name = args.name;
    if (args.status) {
      folder.status = args.status === 'dropped' ? Folder.Status.Dropped : Folder.Status.Active;
    }

    const statusNameMap = {};
    statusNameMap[Folder.Status.Active] = 'active';
    statusNameMap[Folder.Status.Dropped] = 'dropped';

    return JSON.stringify({
      success: true,
      id: folder.id.primaryKey,
      name: folder.name,
      status: statusNameMap[folder.status] || 'active'
    });
  `;
  return await runOmniJs(script, params);
}

export async function deleteFolder(params: { name_or_id: string }): Promise<any> {
  const script = `
    const allFolders = flattenedFolders.filter(() => true);
    let folder = allFolders.filter(f => f.id.primaryKey === args.name_or_id)[0];
    if (!folder) {
      const lower = args.name_or_id.toLowerCase();
      folder = allFolders.filter(f => f.name.toLowerCase() === lower)[0];
    }
    if (!folder) return JSON.stringify({ success: false, error: 'Folder not found: ' + args.name_or_id });

    const id = folder.id.primaryKey;
    const name = folder.name;
    deleteObject(folder);
    return JSON.stringify({ success: true, id: id, name: name, deleted: true });
  `;
  return await runOmniJs(script, params);
}
