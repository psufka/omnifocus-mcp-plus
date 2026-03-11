import { runOmniJs } from '../../utils/scriptExecution.js';

export async function listTags(params: { status?: string; sortBy?: string; limit?: number } = {}): Promise<any> {
  const script = `
    const statusMap = {
      'active': Tag.Status.Active,
      'on_hold': Tag.Status.OnHold,
      'dropped': Tag.Status.Dropped
    };
    const statusNameMap = {};
    statusNameMap[Tag.Status.Active] = 'active';
    statusNameMap[Tag.Status.OnHold] = 'on_hold';
    statusNameMap[Tag.Status.Dropped] = 'dropped';

    let tags = Array.from(document.flattenedTags);

    if (args.status && statusMap[args.status]) {
      const targetStatus = statusMap[args.status];
      tags = tags.filter(t => t.status === targetStatus);
    }

    const sortBy = args.sortBy || 'name';
    tags.sort((a, b) => {
      if (sortBy === 'taskCount') {
        return b.availableTaskCount - a.availableTaskCount;
      }
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    const limit = args.limit || 100;
    tags = tags.slice(0, limit);

    const result = tags.map(t => ({
      id: t.id.primaryKey,
      name: t.name,
      parentName: t.parent && t.parent.constructor !== Database ? t.parent.name : null,
      availableTaskCount: t.availableTaskCount,
      status: statusNameMap[t.status] || 'active'
    }));

    return JSON.stringify({ success: true, tags: result, count: result.length });
  `;
  return await runOmniJs(script, params);
}

export async function searchTags(params: { query: string; limit?: number }): Promise<any> {
  const script = `
    const query = args.query.toLowerCase();
    const limit = args.limit || 50;

    const statusNameMap = {};
    statusNameMap[Tag.Status.Active] = 'active';
    statusNameMap[Tag.Status.OnHold] = 'on_hold';
    statusNameMap[Tag.Status.Dropped] = 'dropped';

    let tags = Array.from(document.flattenedTags).filter(t =>
      t.name.toLowerCase().includes(query)
    );
    tags = tags.slice(0, limit);

    const result = tags.map(t => ({
      id: t.id.primaryKey,
      name: t.name,
      parentName: t.parent && t.parent.constructor !== Database ? t.parent.name : null,
      availableTaskCount: t.availableTaskCount,
      status: statusNameMap[t.status] || 'active'
    }));

    return JSON.stringify({ success: true, tags: result, count: result.length });
  `;
  return await runOmniJs(script, params);
}

export async function createTag(params: { name: string; parent?: string }): Promise<any> {
  const script = `
    let location = document.ending;

    if (args.parent) {
      const tags = Array.from(document.flattenedTags);
      const lower = args.parent.toLowerCase();
      const parentTag = tags.find(t => t.id.primaryKey === args.parent) ||
                        tags.find(t => t.name.toLowerCase() === lower);
      if (!parentTag) return JSON.stringify({ success: false, error: 'Parent tag not found: ' + args.parent });
      location = parentTag.ending;
    }

    const tag = new Tag(args.name, location);
    return JSON.stringify({
      success: true,
      id: tag.id.primaryKey,
      name: tag.name
    });
  `;
  return await runOmniJs(script, params);
}

export async function updateTag(params: { name_or_id: string; name?: string; status?: string }): Promise<any> {
  const script = `
    const statusMap = {
      'active': Tag.Status.Active,
      'on_hold': Tag.Status.OnHold,
      'dropped': Tag.Status.Dropped
    };
    const statusNameMap = {};
    statusNameMap[Tag.Status.Active] = 'active';
    statusNameMap[Tag.Status.OnHold] = 'on_hold';
    statusNameMap[Tag.Status.Dropped] = 'dropped';

    const tags = Array.from(document.flattenedTags);
    let tag = tags.find(t => t.id.primaryKey === args.name_or_id);
    if (!tag) {
      const lower = args.name_or_id.toLowerCase();
      tag = tags.find(t => t.name.toLowerCase() === lower);
    }
    if (!tag) return JSON.stringify({ success: false, error: 'Tag not found: ' + args.name_or_id });

    if (args.name) tag.name = args.name;
    if (args.status && statusMap[args.status]) {
      tag.status = statusMap[args.status];
    }

    return JSON.stringify({
      success: true,
      id: tag.id.primaryKey,
      name: tag.name,
      status: statusNameMap[tag.status] || 'active'
    });
  `;
  return await runOmniJs(script, params);
}

export async function deleteTag(params: { name_or_id: string }): Promise<any> {
  const script = `
    const tags = Array.from(document.flattenedTags);
    let tag = tags.find(t => t.id.primaryKey === args.name_or_id);
    if (!tag) {
      const lower = args.name_or_id.toLowerCase();
      tag = tags.find(t => t.name.toLowerCase() === lower);
    }
    if (!tag) return JSON.stringify({ success: false, error: 'Tag not found: ' + args.name_or_id });

    const id = tag.id.primaryKey;
    const name = tag.name;
    deleteObject(tag);
    return JSON.stringify({ success: true, id: id, name: name, deleted: true });
  `;
  return await runOmniJs(script, params);
}
