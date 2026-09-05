import { OMNIJS_TASK_QUERY_HELPERS } from '../../utils/taskQueryHelpers.js';
import { runOmniJs } from '../../utils/scriptExecution.js';

export type SearchItemType = 'task' | 'project' | 'folder' | 'tag';
export type SearchScope = 'names' | 'notes' | 'both';

export interface SearchItemsParams {
  includeProjectRoots?: boolean;
  query: string;
  types?: SearchItemType[];
  searchIn?: SearchScope;
  includeCompleted?: boolean;
  limitPerType?: number;
}

export const ALL_SEARCH_TYPES: SearchItemType[] = ['task', 'project', 'folder', 'tag'];

export const DEFAULT_LIMIT_PER_TYPE = 20;

/**
 * One OmniJS pass over every requested entity collection.
 *
 * Written without backticks, dollar signs or backslashes so the runOmniJs
 * JXA-template escaping layer has nothing to transform, and every user value
 * (query, types, limits) is read from the injected `args` object — never
 * interpolated into the source.
 */
export const SEARCH_ITEMS_SCRIPT = `
  ${OMNIJS_TASK_QUERY_HELPERS}
  var query = String(args.query === undefined || args.query === null ? '' : args.query).toLowerCase();
  var requested = (args.types && args.types.length > 0) ? args.types : ['task', 'project', 'folder', 'tag'];
  var searchIn = args.searchIn === 'notes' || args.searchIn === 'both' ? args.searchIn : 'names';
  var includeCompleted = args.includeCompleted === true;
  var limitPerType = Math.max(1, Math.floor(Number(args.limitPerType) || 20));

  var wantsName = searchIn === 'names' || searchIn === 'both';
  var wantsNote = searchIn === 'notes' || searchIn === 'both';

  var wanted = function (type) { return requested.indexOf(type) !== -1; };

  // Returns 'name', 'note', or null. hasNotes is false for folders and tags,
  // which carry no note field at all.
  var matchedIn = function (name, note, hasNotes) {
    if (wantsName) {
      var lowerName = String(name === undefined || name === null ? '' : name).toLowerCase();
      if (lowerName.indexOf(query) !== -1) { return 'name'; }
    }
    if (wantsNote && hasNotes) {
      var lowerNote = String(note === undefined || note === null ? '' : note).toLowerCase();
      if (lowerNote.indexOf(query) !== -1) { return 'note'; }
    }
    return null;
  };

  var taskStatusName = {};
  taskStatusName[Task.Status.Available] = 'Available';
  taskStatusName[Task.Status.Blocked] = 'Blocked';
  taskStatusName[Task.Status.Completed] = 'Completed';
  taskStatusName[Task.Status.Dropped] = 'Dropped';
  taskStatusName[Task.Status.DueSoon] = 'DueSoon';
  taskStatusName[Task.Status.Next] = 'Next';
  taskStatusName[Task.Status.Overdue] = 'Overdue';

  var projectStatusName = {};
  projectStatusName[Project.Status.Active] = 'active';
  projectStatusName[Project.Status.OnHold] = 'on_hold';
  projectStatusName[Project.Status.Done] = 'completed';
  projectStatusName[Project.Status.Dropped] = 'dropped';

  var folderStatusName = {};
  folderStatusName[Folder.Status.Active] = 'active';
  folderStatusName[Folder.Status.Dropped] = 'dropped';

  var tagStatusName = {};
  tagStatusName[Tag.Status.Active] = 'active';
  tagStatusName[Tag.Status.OnHold] = 'on_hold';
  tagStatusName[Tag.Status.Dropped] = 'dropped';

  // Collect ALL matches first so totalMatched is honest, then slice.
  var collect = function (collection, build) {
    var matches = [];
    for (var i = 0; i < collection.length; i++) {
      try {
        var row = build(collection[i]);
        if (row) { matches.push(row); }
      } catch (itemError) {
        // An item that cannot be read is skipped rather than failing the search.
      }
    }
    return {
      items: matches.slice(0, limitPerType),
      totalMatched: matches.length,
      truncated: matches.length > limitPerType
    };
  };

  var results = {};

  if (wanted('task')) {
    results.task = collect(__queryTasks(args.includeProjectRoots), function (task) {
      var status = taskStatusName[task.taskStatus] || 'Unknown';
      if (!includeCompleted && (status === 'Completed' || status === 'Dropped')) { return null; }
      var where = matchedIn(task.name, task.note, true);
      if (!where) { return null; }
      var projectName = null;
      if (task.containingProject) { projectName = task.containingProject.name; }
      else if (task.inInbox) { projectName = 'Inbox'; }
      return {
        id: task.id.primaryKey,
        name: task.name,
        status: status,
        projectName: projectName,
        matchedIn: where
      };
    });
  }

  if (wanted('project')) {
    results.project = collect(flattenedProjects, function (project) {
      var status = projectStatusName[project.status] || 'unknown';
      if (!includeCompleted && (status === 'completed' || status === 'dropped')) { return null; }
      var where = matchedIn(project.name, project.note, true);
      if (!where) { return null; }
      return {
        id: project.id.primaryKey,
        name: project.name,
        status: status,
        parentName: project.parentFolder ? project.parentFolder.name : null,
        matchedIn: where
      };
    });
  }

  if (wanted('folder')) {
    results.folder = collect(flattenedFolders, function (folder) {
      var where = matchedIn(folder.name, null, false);
      if (!where) { return null; }
      return {
        id: folder.id.primaryKey,
        name: folder.name,
        status: folderStatusName[folder.status] || 'unknown',
        parentName: folder.parent ? folder.parent.name : null,
        matchedIn: where
      };
    });
  }

  if (wanted('tag')) {
    results.tag = collect(flattenedTags, function (tag) {
      var where = matchedIn(tag.name, null, false);
      if (!where) { return null; }
      return {
        id: tag.id.primaryKey,
        name: tag.name,
        status: tagStatusName[tag.status] || 'unknown',
        parentName: tag.parent ? tag.parent.name : null,
        matchedIn: where
      };
    });
  }

  return JSON.stringify({
    success: true,
    query: args.query,
    searchIn: searchIn,
    includeCompleted: includeCompleted,
    limitPerType: limitPerType,
    typesSearched: requested,
    results: results
  });
`;

const TYPE_HEADINGS: Record<SearchItemType, string> = {
  task: '✔️ Tasks',
  project: '📊 Projects',
  folder: '📁 Folders',
  tag: '🏷 Tags'
};

const TASK_STATUS_EMOJI: Record<string, string> = {
  Available: '⚪',
  Next: '🔵',
  Blocked: '🔴',
  DueSoon: '🟡',
  Overdue: '🔴',
  Completed: '✅',
  Dropped: '⚫'
};

function statusGlyph(type: SearchItemType, status: string): string {
  if (type === 'task') return TASK_STATUS_EMOJI[status] || '⚪';
  if (status === 'completed') return '✅';
  if (status === 'dropped') return '⚫';
  if (status === 'on_hold') return '🟡';
  return '🟢';
}

/**
 * Render the script payload as markdown. Split out from searchItems() so the
 * exact production output is unit-testable without touching OmniFocus.
 */
export function renderSearchItemsResult(data: any, params: SearchItemsParams): string {
  if (data?.error) {
    throw new Error(data.error);
  }

  const searchIn: SearchScope = data?.searchIn ?? params.searchIn ?? 'names';
  const includeCompleted = data?.includeCompleted ?? params.includeCompleted ?? false;
  const limitPerType = typeof data?.limitPerType === 'number'
    ? data.limitPerType
    : (params.limitPerType ?? DEFAULT_LIMIT_PER_TYPE);
  const typesSearched: SearchItemType[] = Array.isArray(data?.typesSearched) && data.typesSearched.length > 0
    ? data.typesSearched
    : (params.types && params.types.length > 0 ? params.types : ALL_SEARCH_TYPES);

  const results = (data?.results ?? {}) as Record<string, any>;

  let totalShown = 0;
  let totalMatched = 0;
  typesSearched.forEach(type => {
    const bucket = results[type];
    if (!bucket) return;
    totalShown += Array.isArray(bucket.items) ? bucket.items.length : 0;
    totalMatched += typeof bucket.totalMatched === 'number' ? bucket.totalMatched : 0;
  });

  const scopeLabel = searchIn === 'names'
    ? 'names'
    : (searchIn === 'notes' ? 'notes' : 'names and notes');

  let output = `# 🔎 SEARCH RESULTS\n\n`;
  output += `**Query**: "${params.query}" | **Searched in**: ${scopeLabel} | `;
  output += `**Types**: ${typesSearched.join(', ')} | `;
  output += `**Completed/dropped**: ${includeCompleted ? 'included' : 'excluded'}\n\n`;

  if (totalMatched === 0) {
    output += '🎯 No items match that query.\n\n';
    output += '**Tips**:\n';
    output += '- Search is a plain case-insensitive substring match, not fuzzy\n';
    // Only suggest a knob that is not already turned on.
    if (searchIn === 'names') {
      output += '- Try `searchIn: "both"` to include notes\n';
    }
    if (!includeCompleted) {
      output += '- Try `includeCompleted: true` to include finished work\n';
    }
    if (typesSearched.length < ALL_SEARCH_TYPES.length) {
      output += '- Only some entity types were searched; drop `types` to search all four\n';
    }
    return output;
  }

  output += `Found ${totalMatched} match${totalMatched === 1 ? '' : 'es'}`;
  if (totalShown < totalMatched) {
    output += ` (showing ${totalShown})`;
  }
  output += ':\n\n';

  typesSearched.forEach(type => {
    const bucket = results[type];
    const heading = TYPE_HEADINGS[type] ?? type;
    if (!bucket) {
      output += `## ${heading} — not searched\n\n`;
      return;
    }

    const items: any[] = Array.isArray(bucket.items) ? bucket.items : [];
    const matched = typeof bucket.totalMatched === 'number' ? bucket.totalMatched : items.length;

    if (matched === 0) {
      // Folders and tags carry no note field, so a notes-only search can never
      // match one. Say that rather than implying the query simply missed.
      const noNotes = searchIn === 'notes' && (type === 'folder' || type === 'tag');
      output += noNotes
        ? `## ${heading} — not applicable (${type}s have no notes)\n\n`
        : `## ${heading} — no matches\n\n`;
      return;
    }

    output += `## ${heading} — showing ${items.length} of ${matched}\n`;
    items.forEach(item => {
      const glyph = statusGlyph(type, String(item.status ?? ''));
      const parent = item.projectName ?? item.parentName ?? null;
      const parentStr = parent ? ` (${parent})` : '';
      output += `${glyph} ${item.name} [${item.id}]${parentStr} — ${item.status}, matched in ${item.matchedIn}\n`;
    });

    if (bucket.truncated) {
      output += `⚠️ ${matched - items.length} more ${type} match${matched - items.length === 1 ? '' : 'es'} hidden — raise \`limitPerType\` (currently ${limitPerType}) or narrow the query.\n`;
    }
    output += '\n';
  });

  return output;
}

export async function searchItems(params: SearchItemsParams): Promise<string> {
  try {
    const query = params.query;
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('query must be a non-empty string');
    }

    // Pure read: the script never writes to the database.
    const result = await runOmniJs(SEARCH_ITEMS_SCRIPT, {
      query,
      includeProjectRoots: params.includeProjectRoots,
      types: params.types && params.types.length > 0 ? params.types : ALL_SEARCH_TYPES,
      searchIn: params.searchIn ?? 'names',
      includeCompleted: params.includeCompleted === true,
      limitPerType: params.limitPerType ?? DEFAULT_LIMIT_PER_TYPE
    }, { readOnly: true });

    if (result && typeof result === 'object') {
      return renderSearchItemsResult(result, params);
    }

    return 'Unexpected result format from OmniFocus';
  } catch (error) {
    console.error('Error in searchItems:', error);
    throw new Error(`Failed to search items: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
