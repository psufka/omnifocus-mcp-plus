import { runOmniJs } from '../../utils/scriptExecution.js';

export async function listFolders(params: { limit?: number } = {}): Promise<any> {
  const script = `
    const limit = args.limit || 100;
    const folders = Array.from(document.flattenedFolders).slice(0, limit);
    const result = folders.map(f => ({
      id: f.id.primaryKey,
      name: f.name,
      parentName: f.parent && f.parent !== document ? f.parent.name : null,
      projectCount: Array.from(f.projects).length
    }));
    return JSON.stringify({ success: true, folders: result, count: result.length });
  `;
  return await runOmniJs(script, params);
}

export async function getFolder(params: { name_or_id: string }): Promise<any> {
  const script = `
    const folders = Array.from(document.flattenedFolders);
    let folder = folders.find(f => f.id.primaryKey === args.name_or_id);
    if (!folder) {
      const lower = args.name_or_id.toLowerCase();
      folder = folders.find(f => f.name.toLowerCase() === lower);
    }
    if (!folder) return JSON.stringify({ success: false, error: 'Folder not found: ' + args.name_or_id });

    const statusNameMap = {};
    statusNameMap[Folder.Status.Active] = 'active';
    statusNameMap[Folder.Status.Dropped] = 'dropped';

    const projects = Array.from(folder.projects).map(p => ({
      id: p.id.primaryKey,
      name: p.name,
      status: p.status === Project.Status.Active ? 'active' : p.status === Project.Status.OnHold ? 'on_hold' : p.status === Project.Status.Done ? 'completed' : 'dropped'
    }));
    const subfolders = Array.from(folder.folders).map(f => ({
      id: f.id.primaryKey,
      name: f.name
    }));

    return JSON.stringify({
      success: true,
      id: folder.id.primaryKey,
      name: folder.name,
      status: statusNameMap[folder.status] || 'active',
      parentName: folder.parent && folder.parent !== document ? folder.parent.name : null,
      projects: projects,
      subfolders: subfolders
    });
  `;
  return await runOmniJs(script, params);
}

export async function createFolder(params: { name: string; parent?: string }): Promise<any> {
  const script = `
    let location = document.ending;

    if (args.parent) {
      const folders = Array.from(document.flattenedFolders);
      const lower = args.parent.toLowerCase();
      const parentFolder = folders.find(f => f.id.primaryKey === args.parent) ||
                           folders.find(f => f.name.toLowerCase() === lower);
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
    const folders = Array.from(document.flattenedFolders);
    let folder = folders.find(f => f.id.primaryKey === args.name_or_id);
    if (!folder) {
      const lower = args.name_or_id.toLowerCase();
      folder = folders.find(f => f.name.toLowerCase() === lower);
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
    const folders = Array.from(document.flattenedFolders);
    let folder = folders.find(f => f.id.primaryKey === args.name_or_id);
    if (!folder) {
      const lower = args.name_or_id.toLowerCase();
      folder = folders.find(f => f.name.toLowerCase() === lower);
    }
    if (!folder) return JSON.stringify({ success: false, error: 'Folder not found: ' + args.name_or_id });

    const id = folder.id.primaryKey;
    const name = folder.name;
    deleteObject(folder);
    return JSON.stringify({ success: true, id: id, name: name, deleted: true });
  `;
  return await runOmniJs(script, params);
}
