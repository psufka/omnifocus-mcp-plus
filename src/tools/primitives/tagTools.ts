import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

export const LIST_TAGS_SCRIPT = `
    const statusMap = {
      'active': Tag.Status.Active,
      'on_hold': Tag.Status.OnHold,
      'dropped': Tag.Status.Dropped
    };
    const statusNameMap = {};
    statusNameMap[Tag.Status.Active] = 'active';
    statusNameMap[Tag.Status.OnHold] = 'on_hold';
    statusNameMap[Tag.Status.Dropped] = 'dropped';

    let tags = flattenedTags.filter(() => true);

    if (args.status && statusMap[args.status]) {
      const targetStatus = statusMap[args.status];
      tags = tags.filter(t => t.status === targetStatus);
    }

    const sortBy = args.sortBy || 'name';
    tags.sort((a, b) => {
      if (sortBy === 'taskCount') {
        return b.availableTasks.length - a.availableTasks.length;
      }
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    const limit = args.limit || 100;
    tags = tags.slice(0, limit);

    const result = tags.map(t => ({
      id: t.id.primaryKey,
      name: t.name,
      parentName: (t.parent && t.parent.name && t.parent !== tags.library) ? t.parent.name : null,
      availableTaskCount: t.availableTasks.length,
      status: statusNameMap[t.status] || 'active'
    }));

    return JSON.stringify({ success: true, tags: result, count: result.length });
  `;

export async function listTags(params: { status?: string; sortBy?: string; limit?: number } = {}): Promise<any> {

  return await runOmniJs(LIST_TAGS_SCRIPT, params, { readOnly: true });
}

export const SEARCH_TAGS_SCRIPT = `
    const query = args.query.toLowerCase();
    const limit = args.limit || 50;

    const statusNameMap = {};
    statusNameMap[Tag.Status.Active] = 'active';
    statusNameMap[Tag.Status.OnHold] = 'on_hold';
    statusNameMap[Tag.Status.Dropped] = 'dropped';

    let tags = flattenedTags.filter(t =>
      t.name.toLowerCase().includes(query)
    );
    tags = tags.slice(0, limit);

    const result = tags.map(t => ({
      id: t.id.primaryKey,
      name: t.name,
      parentName: (t.parent && t.parent.name && t.parent !== tags.library) ? t.parent.name : null,
      availableTaskCount: t.availableTasks.length,
      status: statusNameMap[t.status] || 'active'
    }));

    return JSON.stringify({ success: true, tags: result, count: result.length });
  `;

export async function searchTags(params: { query: string; limit?: number }): Promise<any> {

  return await runOmniJs(SEARCH_TAGS_SCRIPT, params, { readOnly: true });
}

export async function createTag(params: { name: string; parent?: string }): Promise<any> {
  const script = `
    ${OMNIJS_LOOKUP_HELPERS}
    let location = tags.ending;

    if (args.parent) {
      const allTags = flattenedTags.filter(() => true);
      const resolved = __resolveByNameOrId(allTags, args.parent, 'Parent tag');
      if (resolved.error) return JSON.stringify({ success: false, error: resolved.error });
      location = resolved.item.ending;
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
    ${OMNIJS_LOOKUP_HELPERS}
    const statusMap = {
      'active': Tag.Status.Active,
      'on_hold': Tag.Status.OnHold,
      'dropped': Tag.Status.Dropped
    };
    const statusNameMap = {};
    statusNameMap[Tag.Status.Active] = 'active';
    statusNameMap[Tag.Status.OnHold] = 'on_hold';
    statusNameMap[Tag.Status.Dropped] = 'dropped';

    const allTags = flattenedTags.filter(() => true);
    const resolved = __resolveByNameOrId(allTags, args.name_or_id, 'Tag');
    if (resolved.error) return JSON.stringify({ success: false, error: resolved.error });
    const tag = resolved.item;

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
    ${OMNIJS_LOOKUP_HELPERS}
    const allTags = flattenedTags.filter(() => true);
    const resolved = __resolveByNameOrId(allTags, args.name_or_id, 'Tag');
    if (resolved.error) return JSON.stringify({ success: false, error: resolved.error });
    const tag = resolved.item;

    const id = tag.id.primaryKey;
    const name = tag.name;
    deleteObject(tag);
    return JSON.stringify({ success: true, id: id, name: name, deleted: true });
  `;
  return await runOmniJs(script, params);
}
