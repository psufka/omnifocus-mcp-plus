import { executeOmniFocusScript } from '../../utils/scriptExecution.js';
import { parseLocalDate, toLocalDateTimeString } from '../../utils/localDate.js';

// One flat clause condition. Deliberately NOT recursive: `and` / `or` / `not`
// take these directly, one level deep, so the whole predicate set can be
// compiled once and evaluated inside the OmniJS script.
export interface FilterCondition {
  taskStatus?: string[];
  flagged?: boolean;
  hasNote?: boolean;
  isRepeating?: boolean;
  projectFilter?: string;
  tagFilter?: string | string[];
  tagMatchMode?: 'any' | 'all';
  nameContains?: string;
  nameMatches?: string;
  searchText?: string;
  dueBefore?: string;
  dueAfter?: string;
  deferBefore?: string;
  deferAfter?: string;
  plannedBefore?: string;
  plannedAfter?: string;
  completedBefore?: string;
  completedAfter?: string;
  addedBefore?: string;
  addedAfter?: string;
  modifiedBefore?: string;
  modifiedAfter?: string;
  droppedBefore?: string;
  droppedAfter?: string;
}

export interface EstimatedMinutesFilter {
  lessThan?: number;
  greaterThan?: number;
  equals?: number;
  between?: [number, number];
}

export type FilterTaskField = 'dates' | 'status' | 'estimate' | 'note' | 'tags' | 'project';

export interface FilterTasksOptions {
  // Task status filter
  taskStatus?: string[];

  // Perspective scope
  perspective?: 'inbox' | 'flagged' | 'all';

  // Project/tag/folder filter
  projectFilter?: string;
  folderName?: string;
  folderId?: string;
  tagFilter?: string | string[];
  exactTagMatch?: boolean;
  tagMatchMode?: 'any' | 'all';

  // Due date filter
  dueBefore?: string;
  dueAfter?: string;
  dueToday?: boolean;
  dueThisWeek?: boolean;
  dueThisMonth?: boolean;
  overdue?: boolean;

  // Defer date filter
  deferBefore?: string;
  deferAfter?: string;
  deferToday?: boolean;
  deferThisWeek?: boolean;
  deferAvailable?: boolean;

  // Planned date filter
  plannedBefore?: string;
  plannedAfter?: string;
  plannedToday?: boolean;
  plannedThisWeek?: boolean;
  plannedThisMonth?: boolean;

  // Completed date filter
  completedBefore?: string;
  completedAfter?: string;
  completedToday?: boolean;
  completedYesterday?: boolean;
  completedThisWeek?: boolean;
  completedThisMonth?: boolean;

  // Metadata date filters
  addedBefore?: string;
  addedAfter?: string;
  modifiedBefore?: string;
  modifiedAfter?: string;
  droppedBefore?: string;
  droppedAfter?: string;

  // Other dimensions
  flagged?: boolean;
  searchText?: string;
  nameContains?: string;
  nameMatches?: string;
  hasNote?: boolean;
  isRepeating?: boolean;
  estimatedMinutes?: EstimatedMinutesFilter;

  // Logical clauses (one level, no nesting)
  and?: FilterCondition[];
  or?: FilterCondition[];
  not?: FilterCondition;

  // Output control
  fields?: FilterTaskField[];
  countOnly?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Date strings that get forwarded to the OmniJS script. Normalizing them means
// a bare "YYYY-MM-DD" lands on local midnight on both sides of the boundary.
const DATE_STRING_OPTION_KEYS = [
  'dueBefore',
  'dueAfter',
  'deferBefore',
  'deferAfter',
  'plannedBefore',
  'plannedAfter',
  'completedBefore',
  'completedAfter',
  'addedBefore',
  'addedAfter',
  'modifiedBefore',
  'modifiedAfter',
  'droppedBefore',
  'droppedAfter'
] as const;

// The date keys a clause condition may carry. Same normalization applies.
const CONDITION_DATE_KEYS = [
  'dueBefore', 'dueAfter',
  'deferBefore', 'deferAfter',
  'plannedBefore', 'plannedAfter',
  'completedBefore', 'completedAfter',
  'addedBefore', 'addedAfter',
  'modifiedBefore', 'modifiedAfter',
  'droppedBefore', 'droppedAfter'
] as const;

/**
 * Every key an `and` / `or` / `not` condition may contain. This MUST stay in
 * lockstep with the CONDITION_KEYS list inside omnifocusScripts/filterTasks.js
 * — the script is what actually evaluates them, so a key that exists here but
 * not there would be silently dropped and return an unfiltered result set. A
 * unit test asserts the two lists are identical.
 */
export const CONDITION_KEYS: readonly string[] = [
  'taskStatus', 'flagged', 'hasNote', 'isRepeating', 'projectFilter',
  'tagFilter', 'tagMatchMode', 'nameContains', 'nameMatches', 'searchText',
  ...CONDITION_DATE_KEYS
];

const ALL_FIELDS: FilterTaskField[] = ['dates', 'status', 'estimate', 'note', 'tags', 'project'];

interface FieldFlags {
  dates: boolean;
  status: boolean;
  estimate: boolean;
  note: boolean;
  tags: boolean;
  project: boolean;
}

const EVERY_FIELD: FieldFlags = {
  dates: true, status: true, estimate: true, note: true, tags: true, project: true
};

function resolveFields(fields?: FilterTaskField[]): FieldFlags {
  // Omitted (or empty) means "render everything", which is the pre-0.5.0 shape.
  if (!fields || fields.length === 0) return EVERY_FIELD;
  return {
    dates: fields.includes('dates'),
    status: fields.includes('status'),
    estimate: fields.includes('estimate'),
    note: fields.includes('note'),
    tags: fields.includes('tags'),
    project: fields.includes('project')
  };
}

function parseDate(value?: string | null): Date | null {
  // parseLocalDate treats a bare "YYYY-MM-DD" as local midnight; `new Date()`
  // would read it as UTC midnight, i.e. the previous evening west of UTC.
  if (!value) return null;
  return parseLocalDate(value);
}

function normalizeDateOptions(options: FilterTasksOptions): Record<string, string> {
  const normalized: Record<string, string> = {};

  DATE_STRING_OPTION_KEYS.forEach(key => {
    const value = options[key];
    if (typeof value === 'string' && value.trim() !== '') {
      normalized[key] = toLocalDateTimeString(value);
    }
  });

  return normalized;
}

/**
 * Reject any clause key the OmniJS evaluator does not implement, and any empty
 * clause. Both would otherwise widen the result set silently — an unfiltered
 * answer that looks exactly like a filtered one is the worst failure mode this
 * tool has, so it fails loudly instead.
 */
function validateCondition(condition: FilterCondition, where: string): void {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    throw new Error(`Condition ${where} must be an object of predicates.`);
  }

  const present = Object.keys(condition).filter(
    key => (condition as Record<string, unknown>)[key] !== undefined
  );

  const unsupported = present.filter(key => !CONDITION_KEYS.includes(key));
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported condition key(s) in ${where}: ${unsupported.join(', ')}. ` +
      `filter_tasks clause conditions support only: ${CONDITION_KEYS.join(', ')}.`
    );
  }

  // tagMatchMode modifies tagFilter; on its own it constrains nothing.
  if (present.filter(key => key !== 'tagMatchMode').length === 0) {
    throw new Error(`Condition ${where} is empty: specify at least one predicate.`);
  }
}

export function validateClauses(options: FilterTasksOptions): void {
  (options.and ?? []).forEach((condition, index) => validateCondition(condition, `and[${index}]`));
  (options.or ?? []).forEach((condition, index) => validateCondition(condition, `or[${index}]`));
  if (options.or && options.or.length === 0) {
    throw new Error('The "or" clause was supplied with no conditions. An empty OR matches nothing; remove the key or add at least one condition.');
  }
  if (options.not !== undefined) validateCondition(options.not, 'not');
}

function normalizeCondition(condition: FilterCondition): FilterCondition {
  const normalized: Record<string, unknown> = { ...condition };
  CONDITION_DATE_KEYS.forEach(key => {
    const value = condition[key];
    if (typeof value === 'string' && value.trim() !== '') {
      normalized[key] = toLocalDateTimeString(value);
    }
  });
  return normalized as FilterCondition;
}

function normalizeClauseOptions(options: FilterTasksOptions): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  if (options.and) normalized.and = options.and.map(normalizeCondition);
  if (options.or) normalized.or = options.or.map(normalizeCondition);
  if (options.not !== undefined) normalized.not = normalizeCondition(options.not);
  return normalized;
}

function hasLogicalClauses(options: FilterTasksOptions): boolean {
  return Boolean(
    (options.and && options.and.length > 0) ||
    (options.or && options.or.length > 0) ||
    options.not
  );
}

// The script reports which filters it applied itself; drop those so the
// client-side pass does not run them a second time with slightly different
// clocks and silently shrink the result set.
function withoutScriptAppliedFilters(options: FilterTasksOptions, appliedFilters: unknown): FilterTasksOptions {
  if (!Array.isArray(appliedFilters) || appliedFilters.length === 0) {
    return options;
  }

  const pending: Record<string, any> = { ...options };
  appliedFilters.forEach(key => {
    if (typeof key === 'string' && key in pending) {
      delete pending[key];
    }
  });

  return pending as FilterTasksOptions;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function isDateInTodayRange(date: Date): boolean {
  const todayStart = startOfDay(new Date());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(todayStart.getDate() + 1);
  return date >= todayStart && date < tomorrowStart;
}

function isDateInCurrentWeek(date: Date): boolean {
  const today = new Date();
  const currentDay = today.getDay(); // Sunday = 0
  const weekStart = startOfDay(today);
  weekStart.setDate(today.getDate() - currentDay); // Sunday start

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  return date >= weekStart && date < weekEnd;
}

function isDateInCurrentMonth(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function normalizeTaskTagNames(task: any): string[] {
  if (!Array.isArray(task?.tags)) {
    return [];
  }

  return task.tags
    .map((tag: any) => {
      if (typeof tag === 'string') return tag;
      if (tag && typeof tag.name === 'string') return tag.name;
      return '';
    })
    .filter((name: string) => name.trim() !== '')
    .map((name: string) => name.toLowerCase());
}

function matchesTagFilter(task: any, tagFilters: string[], exactTagMatch: boolean, matchMode: 'any' | 'all' = 'any'): boolean {
  const taskTagNames = normalizeTaskTagNames(task);
  if (taskTagNames.length === 0) return false;

  const matchFn = (filterTag: string) => {
    return taskTagNames.some(taskTagName => {
      if (exactTagMatch) {
        return taskTagName === filterTag;
      }
      return taskTagName.includes(filterTag);
    });
  };

  return matchMode === 'all' ? tagFilters.every(matchFn) : tagFilters.some(matchFn);
}

// True when any filter is still pending after the script's own pass. With a
// current script this is always false — the script pushes all of these down —
// but it keeps the fallback honest if an older compiled script is in place.
function shouldApplyClientSideFilters(options: FilterTasksOptions): boolean {
  return Boolean(
    options.tagFilter ||
    options.dueToday ||
    options.dueThisWeek ||
    options.dueThisMonth ||
    options.overdue ||
    options.dueBefore ||
    options.dueAfter ||
    options.deferToday ||
    options.deferThisWeek ||
    options.deferAvailable ||
    options.deferBefore ||
    options.deferAfter ||
    options.plannedToday ||
    options.plannedThisWeek ||
    options.plannedThisMonth ||
    options.plannedBefore ||
    options.plannedAfter
  );
}

function sortTasks(tasks: any[], sortBy: string, sortOrder: 'asc' | 'desc'): any[] {
  const copy = [...tasks];
  const direction = sortOrder === 'desc' ? -1 : 1;

  const compareDate = (a: any, b: any, key: 'dueDate' | 'deferDate' | 'plannedDate' | 'completedDate') => {
    const dateA = parseDate(a?.[key]);
    const dateB = parseDate(b?.[key]);
    const valueA = dateA ? dateA.getTime() : Number.POSITIVE_INFINITY;
    const valueB = dateB ? dateB.getTime() : Number.POSITIVE_INFINITY;
    return (valueA - valueB) * direction;
  };

  copy.sort((a: any, b: any) => {
    switch (sortBy) {
      case 'dueDate':
        return compareDate(a, b, 'dueDate');
      case 'deferDate':
        return compareDate(a, b, 'deferDate');
      case 'plannedDate':
        return compareDate(a, b, 'plannedDate');
      case 'completedDate':
        return compareDate(a, b, 'completedDate');
      case 'flagged': {
        const flaggedA = a?.flagged ? 1 : 0;
        const flaggedB = b?.flagged ? 1 : 0;
        return (flaggedA - flaggedB) * direction;
      }
      case 'project': {
        const projectA = (a?.projectName || '').toLowerCase();
        const projectB = (b?.projectName || '').toLowerCase();
        return projectA.localeCompare(projectB) * direction;
      }
      case 'name':
      default: {
        const nameA = (a?.name || '').toLowerCase();
        const nameB = (b?.name || '').toLowerCase();
        return nameA.localeCompare(nameB) * direction;
      }
    }
  });

  return copy;
}

export function applyClientSideFilters(tasks: any[], options: FilterTasksOptions): any[] {
  let filteredTasks = tasks;

  // Due date filters
  if (options.dueToday) {
    filteredTasks = filteredTasks.filter(task => {
      const dueDate = parseDate(task?.dueDate);
      return dueDate ? isDateInTodayRange(dueDate) : false;
    });
  }

  if (options.dueThisWeek) {
    filteredTasks = filteredTasks.filter(task => {
      const dueDate = parseDate(task?.dueDate);
      return dueDate ? isDateInCurrentWeek(dueDate) : false;
    });
  }

  if (options.dueThisMonth) {
    filteredTasks = filteredTasks.filter(task => {
      const dueDate = parseDate(task?.dueDate);
      return dueDate ? isDateInCurrentMonth(dueDate) : false;
    });
  }

  if (options.overdue) {
    const now = new Date();
    filteredTasks = filteredTasks.filter(task => {
      const dueDate = parseDate(task?.dueDate);
      return dueDate ? dueDate < now : false;
    });
  }

  if (options.dueBefore) {
    const dueBefore = parseDate(options.dueBefore);
    if (dueBefore) {
      filteredTasks = filteredTasks.filter(task => {
        const dueDate = parseDate(task?.dueDate);
        return dueDate ? dueDate < dueBefore : false;
      });
    }
  }

  if (options.dueAfter) {
    const dueAfter = parseDate(options.dueAfter);
    if (dueAfter) {
      filteredTasks = filteredTasks.filter(task => {
        const dueDate = parseDate(task?.dueDate);
        return dueDate ? dueDate > dueAfter : false;
      });
    }
  }

  if (options.tagFilter) {
    const exactTagMatch = options.exactTagMatch ?? false;
    const matchMode = options.tagMatchMode ?? 'any';
    const rawFilters = Array.isArray(options.tagFilter) ? options.tagFilter : [options.tagFilter];
    const normalizedFilters = rawFilters
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0);

    if (normalizedFilters.length > 0) {
      filteredTasks = filteredTasks.filter(task =>
        matchesTagFilter(task, normalizedFilters, exactTagMatch, matchMode)
      );
    }
  }

  if (options.deferToday) {
    filteredTasks = filteredTasks.filter(task => {
      const deferDate = parseDate(task?.deferDate);
      return deferDate ? isDateInTodayRange(deferDate) : false;
    });
  }

  if (options.deferThisWeek) {
    filteredTasks = filteredTasks.filter(task => {
      const deferDate = parseDate(task?.deferDate);
      return deferDate ? isDateInCurrentWeek(deferDate) : false;
    });
  }

  if (options.deferBefore) {
    const deferBefore = parseDate(options.deferBefore);
    if (deferBefore) {
      filteredTasks = filteredTasks.filter(task => {
        const deferDate = parseDate(task?.deferDate);
        return deferDate ? deferDate < deferBefore : false;
      });
    }
  }

  if (options.deferAfter) {
    const deferAfter = parseDate(options.deferAfter);
    if (deferAfter) {
      filteredTasks = filteredTasks.filter(task => {
        const deferDate = parseDate(task?.deferDate);
        return deferDate ? deferDate > deferAfter : false;
      });
    }
  }

  if (options.deferAvailable) {
    const now = new Date();
    filteredTasks = filteredTasks.filter(task => {
      const deferDate = parseDate(task?.deferDate);
      return !deferDate || deferDate <= now;
    });
  }

  if (options.plannedToday) {
    filteredTasks = filteredTasks.filter(task => {
      const plannedDate = parseDate(task?.plannedDate);
      return plannedDate ? isDateInTodayRange(plannedDate) : false;
    });
  }

  if (options.plannedThisWeek) {
    filteredTasks = filteredTasks.filter(task => {
      const plannedDate = parseDate(task?.plannedDate);
      return plannedDate ? isDateInCurrentWeek(plannedDate) : false;
    });
  }

  if (options.plannedThisMonth) {
    filteredTasks = filteredTasks.filter(task => {
      const plannedDate = parseDate(task?.plannedDate);
      return plannedDate ? isDateInCurrentMonth(plannedDate) : false;
    });
  }

  if (options.plannedBefore) {
    const plannedBefore = parseDate(options.plannedBefore);
    if (plannedBefore) {
      filteredTasks = filteredTasks.filter(task => {
        const plannedDate = parseDate(task?.plannedDate);
        return plannedDate ? plannedDate < plannedBefore : false;
      });
    }
  }

  if (options.plannedAfter) {
    const plannedAfter = parseDate(options.plannedAfter);
    if (plannedAfter) {
      filteredTasks = filteredTasks.filter(task => {
        const plannedDate = parseDate(task?.plannedDate);
        return plannedDate ? plannedDate > plannedAfter : false;
      });
    }
  }

  return filteredTasks;
}

/**
 * Render the script payload as markdown. Split out from filterTasks() so the
 * exact production output can be golden-tested without touching OmniFocus.
 */
export function renderFilterTasksResult(data: any, options: FilterTasksOptions = {}): string {
  const {
    limit = 100,
    sortBy = 'name',
    sortOrder = 'asc'
  } = options;
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  if (data.error) {
    throw new Error(data.error);
  }

  // Format filter results
  let output = `# 🔍 FILTERED TASKS\n\n`;

  // Show filter summary
  const filterSummary = buildFilterSummary(options);
  if (filterSummary) {
    output += `**Filter**: ${filterSummary}\n\n`;
  }

  // countOnly never serializes tasks, so it renders its own one-liner.
  if (data.countOnly) {
    const count = typeof data.count === 'number' ? data.count : 0;
    output += `🔢 **${count} matching task${count === 1 ? '' : 's'}** (countOnly — no task details were read).\n`;
    return output;
  }

  if (data.tasks && Array.isArray(data.tasks)) {
    // With a page offset or a logical clause in play, the script's slice IS the
    // answer: re-filtering, re-sorting or re-slicing here would drop rows from
    // the middle of a paginated run and silently corrupt the page boundaries.
    const scriptAuthoritative = offset > 0 || hasLogicalClauses(options);

    let limitedTasks: any[];
    let totalCount: number;

    if (scriptAuthoritative) {
      limitedTasks = data.tasks;
      totalCount = typeof data.matchedCount === 'number' ? data.matchedCount : data.tasks.length;
    } else {
      const pendingOptions = withoutScriptAppliedFilters(options, data.appliedFilters);
      const postFilteredTasks = applyClientSideFilters(data.tasks, pendingOptions);
      const sortedTasks = sortTasks(postFilteredTasks, sortBy, sortOrder);
      limitedTasks = sortedTasks.slice(0, limit);

      // When nothing was left for the client-side pass the script's match
      // count is exact, so it can report how many tasks the cap hid.
      const scriptMatchedCount = typeof data.matchedCount === 'number' ? data.matchedCount : null;
      totalCount = (scriptMatchedCount !== null && !shouldApplyClientSideFilters(pendingOptions))
        ? scriptMatchedCount
        : sortedTasks.length;
    }

    const taskCount = limitedTasks.length;
    const fields = resolveFields(options.fields);

    if (taskCount === 0) {
      output += '🎯 No tasks match your filter criteria.\n';

      // Suggestions
      output += '\n**Tips**:\n';
      output += '- Try broadening your search criteria\n';
      output += '- Check if tasks exist in the specified project/tags\n';
      output += '- Use `get_inbox_tasks` or `get_flagged_tasks` for basic views\n';
    } else {
      output += `Found ${taskCount} task${taskCount === 1 ? '' : 's'}`;
      if (offset > 0) {
        output += ` (showing ${offset + 1}–${offset + taskCount} of ${totalCount})`;
      } else if (taskCount < totalCount) {
        output += ` (showing first ${taskCount} of ${totalCount})`;
      }
      output += ':\n\n';

      // Group tasks by project
      const tasksByProject = groupTasksByProject(limitedTasks);
      const showGroupHeaders = fields.project && tasksByProject.size > 1;

      tasksByProject.forEach((tasks, projectName) => {
        if (showGroupHeaders) {
          output += `## 📁 ${projectName}\n`;
        }

        tasks.forEach((task: any) => {
          output += formatTask(task, fields);
          output += '\n';
        });

        if (showGroupHeaders) {
          output += '\n';
        }
      });

      // Sort info
      output += `\n📊 **Sorted by**: ${sortBy} (${sortOrder})\n`;

      if (data.truncated) {
        const cap = typeof data.limitApplied === 'number' ? data.limitApplied : limit;
        output += `⚠️ **Results capped at ${cap}** — raise \`limit\` or narrow the filter to see the rest.\n`;
        if (offset > 0 || hasLogicalClauses(options)) {
          output += `➡️ Next page: \`offset: ${offset + taskCount}\`.\n`;
        }
      }
    }
  } else {
    output += 'No task data available\n';
  }

  return output;
}

export async function filterTasks(options: FilterTasksOptions = {}): Promise<string> {
  try {
    // Set defaults
    const {
      perspective = 'all',
      exactTagMatch = false,
      limit = 100,
      sortBy = 'name',
      sortOrder = 'asc'
    } = options;
    const offset = Math.max(0, Math.floor(options.offset ?? 0));

    // Reject unevaluable clause keys BEFORE touching OmniFocus. The script
    // validates them again — this side just fails faster and cheaper.
    validateClauses(options);

    // The script applies every filter and the final sort before it pages, so
    // asking for more than `limit` rows would only inflate the payload. (The
    // old over-fetch existed because truncation happened before the date/tag
    // filters ran here, which silently dropped late-alphabetical matches.)
    const sourceLimit = limit;

    // Execute filter script (pure read — no mutation anywhere in filterTasks.js)
    const result = await executeOmniFocusScript('@filterTasks.js', {
      ...options,
      ...normalizeDateOptions(options),
      ...normalizeClauseOptions(options),
      perspective,
      exactTagMatch,
      limit: sourceLimit,
      offset,
      sortBy,
      sortOrder
    }, { readOnly: true });

    // If result is an object, format it
    if (result && typeof result === 'object') {
      return renderFilterTasksResult(result, options);
    }

    return 'Unexpected result format from OmniFocus';
  } catch (error) {
    console.error('Error in filterTasks:', error);
    throw new Error(`Failed to filter tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Build filter summary
function buildFilterSummary(options: FilterTasksOptions): string {
  const conditions: string[] = [];

  if (options.taskStatus && options.taskStatus.length > 0) {
    conditions.push(`Status: ${options.taskStatus.join(', ')}`);
  }

  if (options.perspective && options.perspective !== 'all') {
    conditions.push(`Perspective: ${options.perspective}`);
  }

  if (options.projectFilter) {
    conditions.push(`Project: "${options.projectFilter}"`);
  }

  if (options.tagFilter) {
    const tags = Array.isArray(options.tagFilter) ? options.tagFilter.join(', ') : options.tagFilter;
    const tagLabel = options.tagMatchMode === 'all' ? 'Tags (AND)' : 'Tags';
    conditions.push(`${tagLabel}: ${tags}`);
  }

  if (options.flagged !== undefined) {
    conditions.push(`Flagged: ${options.flagged ? 'Yes' : 'No'}`);
  }

  if (options.dueToday) conditions.push('Due: Today');
  else if (options.dueThisWeek) conditions.push('Due: This Week');
  else if (options.dueThisMonth) conditions.push('Due: This Month');
  else if (options.overdue) conditions.push('Due: Overdue');

  if (options.completedToday) conditions.push('Completed: Today');
  else if (options.completedYesterday) conditions.push('Completed: Yesterday');
  else if (options.completedThisWeek) conditions.push('Completed: This Week');
  else if (options.completedThisMonth) conditions.push('Completed: This Month');

  if (options.deferAvailable) conditions.push('Defer: Available');
  else if (options.deferToday) conditions.push('Defer: Today');
  else if (options.deferThisWeek) conditions.push('Defer: This Week');

  if (options.plannedToday) conditions.push('Planned: Today');
  else if (options.plannedThisWeek) conditions.push('Planned: This Week');
  else if (options.plannedThisMonth) conditions.push('Planned: This Month');
  else if (options.plannedBefore) conditions.push(`Planned Before: ${options.plannedBefore}`);
  else if (options.plannedAfter) conditions.push(`Planned After: ${options.plannedAfter}`);

  if (options.searchText) {
    conditions.push(`Search: "${options.searchText}"`);
  }

  // --- 0.5.0 additions. Appended after the legacy block so the summary line
  // for a pre-0.5.0 call is byte-for-byte what it always was.
  if (options.folderName) conditions.push(`Folder: "${options.folderName}"`);
  else if (options.folderId) conditions.push(`Folder id: ${options.folderId}`);

  if (options.nameContains) conditions.push(`Name contains: "${options.nameContains}"`);
  if (options.nameMatches) conditions.push(`Name matches: /${options.nameMatches}/i`);
  if (options.hasNote !== undefined) conditions.push(`Has note: ${options.hasNote ? 'Yes' : 'No'}`);
  if (options.isRepeating !== undefined) conditions.push(`Repeating: ${options.isRepeating ? 'Yes' : 'No'}`);
  if (options.estimatedMinutes) conditions.push(`Estimate: ${describeEstimate(options.estimatedMinutes)}`);

  if (options.addedBefore) conditions.push(`Added before: ${options.addedBefore}`);
  if (options.addedAfter) conditions.push(`Added after: ${options.addedAfter}`);
  if (options.modifiedBefore) conditions.push(`Modified before: ${options.modifiedBefore}`);
  if (options.modifiedAfter) conditions.push(`Modified after: ${options.modifiedAfter}`);
  if (options.droppedBefore) conditions.push(`Dropped before: ${options.droppedBefore}`);
  if (options.droppedAfter) conditions.push(`Dropped after: ${options.droppedAfter}`);

  if (options.and && options.and.length > 0) conditions.push(`AND clauses: ${options.and.length}`);
  if (options.or && options.or.length > 0) conditions.push(`OR clauses: ${options.or.length}`);
  if (options.not) conditions.push('NOT clause: 1');

  return conditions.length > 0 ? conditions.join(' | ') : '';
}

function describeEstimate(estimate: EstimatedMinutesFilter): string {
  const parts: string[] = [];
  if (estimate.lessThan !== undefined) parts.push(`< ${estimate.lessThan}m`);
  if (estimate.greaterThan !== undefined) parts.push(`> ${estimate.greaterThan}m`);
  if (estimate.equals !== undefined) parts.push(`= ${estimate.equals}m`);
  if (estimate.between) parts.push(`${estimate.between[0]}–${estimate.between[1]}m`);
  return parts.length > 0 ? parts.join(', ') : 'any';
}

// Group tasks by project
function groupTasksByProject(tasks: any[]): Map<string, any[]> {
  const grouped = new Map<string, any[]>();

  tasks.forEach(task => {
    const projectName = task.projectName || (task.inInbox ? '📥 Inbox' : '📂 No Project');

    if (!grouped.has(projectName)) {
      grouped.set(projectName, []);
    }
    grouped.get(projectName)!.push(task);
  });

  return grouped;
}

// Format a single task. `fields` gates the OPTIONAL line components only — the
// status glyph, the name and the id always render.
function formatTask(task: any, fields: FieldFlags = EVERY_FIELD): string {
  let output = '';

  // Task basic info
  const flagSymbol = task.flagged ? '🚩 ' : '';
  const statusEmoji = getStatusEmoji(task.taskStatus);

  const idStr = task.id ? ` [${task.id}]` : '';
  output += `${statusEmoji} ${flagSymbol}${task.name}${idStr}`;

  // Date info
  const dateInfo: string[] = [];
  if (fields.dates) {
    if (task.dueDate) {
      const dueDateStr = new Date(task.dueDate).toLocaleDateString();
      const isOverdue = new Date(task.dueDate) < new Date();
      dateInfo.push(isOverdue ? `⚠️ DUE: ${dueDateStr}` : `📅 DUE: ${dueDateStr}`);
    } else if (task.effectiveDueDate) {
      const effDueDateStr = new Date(task.effectiveDueDate).toLocaleDateString();
      const isOverdue = new Date(task.effectiveDueDate) < new Date();
      dateInfo.push(isOverdue ? `⚠️ DUE (eff): ${effDueDateStr}` : `📅 DUE (eff): ${effDueDateStr}`);
    }

    if (task.deferDate) {
      const deferDateStr = new Date(task.deferDate).toLocaleDateString();
      dateInfo.push(`🚀 DEFER: ${deferDateStr}`);
    } else if (task.effectiveDeferDate) {
      const effDeferDateStr = new Date(task.effectiveDeferDate).toLocaleDateString();
      dateInfo.push(`🚀 DEFER (eff): ${effDeferDateStr}`);
    }

    if (task.plannedDate) {
      const plannedDateStr = new Date(task.plannedDate).toLocaleDateString();
      dateInfo.push(`🗓 PLAN: ${plannedDateStr}`);
    }

    if (task.completedDate) {
      const completedDateStr = new Date(task.completedDate).toLocaleDateString();
      dateInfo.push(`✅ DONE: ${completedDateStr}`);
    }
  }

  if (dateInfo.length > 0) {
    output += ` [${dateInfo.join(', ')}]`;
  }

  // Additional info
  const additionalInfo: string[] = [];

  if (fields.status && task.taskStatus && task.taskStatus !== 'Available') {
    additionalInfo.push(task.taskStatus);
  }

  if (fields.estimate && task.estimatedMinutes) {
    const hours = Math.floor(task.estimatedMinutes / 60);
    const minutes = task.estimatedMinutes % 60;
    if (hours > 0) {
      additionalInfo.push(`⏱ ${hours}h${minutes > 0 ? `${minutes}m` : ''}`);
    } else {
      additionalInfo.push(`⏱ ${minutes}m`);
    }
  }

  if (additionalInfo.length > 0) {
    output += ` (${additionalInfo.join(', ')})`;
  }

  output += '\n';

  // Task notes
  if (fields.note && task.note && task.note.trim()) {
    output += `  📝 ${task.note.trim()}\n`;
  }

  // Tags
  if (fields.tags && task.tags && task.tags.length > 0) {
    const tagNames = task.tags.map((tag: any) => tag.name).join(', ');
    output += `  🏷 ${tagNames}\n`;
  }

  return output;
}

// Get emoji for task status
function getStatusEmoji(status: string): string {
  const statusMap: { [key: string]: string } = {
    Available: '⚪',
    Next: '🔵',
    Blocked: '🔴',
    DueSoon: '🟡',
    Overdue: '🔴',
    Completed: '✅',
    Dropped: '⚫'
  };

  return statusMap[status] || '⚪';
}

export const FILTER_TASK_FIELDS = ALL_FIELDS;
