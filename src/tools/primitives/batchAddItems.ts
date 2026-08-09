import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import {
  OMNIJS_CREATE_TASK_HELPER,
  normalizeItemDates,
  validateAddTaskParams
} from './addOmniFocusTask.js';
import { BatchItemResult, coerceBatchResults, summarizeBatchErrors } from '../../utils/batchResults.js';

// Define the parameters for the batch operation
export type BatchAddItemsParams = {
  type: 'task' | 'project';
  itemType?: 'task' | 'project'; // Canonical field; `type` is the legacy alias
  name: string;
  note?: string;
  dueDate?: string;
  deferDate?: string;
  plannedDate?: string;
  flagged?: boolean;
  estimatedMinutes?: number;
  tags?: string[];
  projectName?: string; // For tasks
  parentTaskId?: string; // For subtasks
  parentTaskName?: string; // For subtasks (alternative to ID)
  folderName?: string; // For projects
  sequential?: boolean; // For projects
};

// Define the result type for individual operations
export type ItemResult = BatchItemResult;

// Define the result type for the batch operation
type BatchResult = {
  success: boolean;
  results: ItemResult[];
  error?: string;
};

/**
 * OmniJS source for `__createProject(spec, warnings)`. Mirrors the addProject
 * primitive; kept here (rather than imported from it) because batch_add_items
 * must create projects inside the same single script as its tasks.
 */
const OMNIJS_CREATE_PROJECT_HELPER = `
  function __createProject(spec, warnings) {
    var location;
    if (spec.folderName) {
      var folderLookup = __resolveByNameOrId(flattenedFolders, spec.folderName, 'Folder');
      if (folderLookup.error) { return { error: folderLookup.error }; }
      location = folderLookup.item.ending;
    } else {
      location = library.ending;
    }

    var project = new Project(spec.name, location);

    if (spec.note !== undefined) { project.note = spec.note; }
    if (spec.dueDate) { project.dueDate = new Date(spec.dueDate); }
    if (spec.deferDate) { project.deferDate = new Date(spec.deferDate); }
    if (spec.plannedDate) { __setPlannedDate(project, spec.plannedDate, warnings); }
    if (spec.flagged !== undefined) { project.flagged = spec.flagged; }
    if (spec.estimatedMinutes !== undefined) { project.estimatedMinutes = spec.estimatedMinutes; }
    if (spec.sequential !== undefined) { project.sequential = spec.sequential; }
    if (spec.tags && spec.tags.length > 0) { __applyTagsTo(project, spec.tags); }

    return { project: project };
  }
`;

type PreparedItem = BatchAddItemsParams & { kind?: string; preflightError?: string };

/**
 * Resolve the item type (canonical `itemType`, legacy alias `type`) and run the
 * same validation the single-item tools run, so every failure mode is reported
 * per item instead of aborting the batch.
 */
export function prepareBatchItems(items: BatchAddItemsParams[]): PreparedItem[] {
  return items.map(item => {
    const kind = item.itemType ?? item.type;
    const prepared: PreparedItem = { ...normalizeItemDates(item), kind };

    if (kind !== 'task' && kind !== 'project') {
      prepared.preflightError = `Invalid item type: ${String(kind)}. Expected 'task' or 'project'.`;
      return prepared;
    }

    if (!item.name) {
      prepared.preflightError = kind === 'project' ? 'Project name is required.' : 'Task name is required.';
      return prepared;
    }

    if (kind === 'task') {
      const validation = validateAddTaskParams(item);
      if (!validation.valid) prepared.preflightError = validation.error;
    }

    return prepared;
  });
}

// One static script for the whole batch — every user value arrives through the
// injected `args.items` array, and each item is created inside its own
// try/catch so one failure never aborts the rest.
export const BATCH_ADD_ITEMS_SCRIPT = `
    ${OMNIJS_LOOKUP_HELPERS}
    ${OMNIJS_CREATE_TASK_HELPER}
    ${OMNIJS_CREATE_PROJECT_HELPER}

    const results = [];

    for (let i = 0; i < args.items.length; i++) {
      const item = args.items[i];
      const warnings = [];
      try {
        if (item.preflightError) {
          results.push({ index: i, success: false, name: item.name, error: item.preflightError });
          continue;
        }

        if (item.kind === 'task') {
          const created = __createTask(item, warnings);
          if (created.error) {
            results.push({ index: i, success: false, name: item.name, error: created.error });
            continue;
          }
          results.push({
            index: i,
            success: true,
            id: created.task.id.primaryKey,
            name: created.task.name,
            warnings: warnings
          });
        } else {
          const created = __createProject(item, warnings);
          if (created.error) {
            results.push({ index: i, success: false, name: item.name, error: created.error });
            continue;
          }
          results.push({
            index: i,
            success: true,
            id: created.project.id.primaryKey,
            name: created.project.name,
            warnings: warnings
          });
        }
      } catch (e) {
        results.push({
          index: i,
          success: false,
          name: item.name,
          error: (e && e.message) ? e.message : 'Unknown error creating item'
        });
      }
    }

    return JSON.stringify({ success: true, results: results });
`;

/**
 * Add multiple items (tasks or projects) to OmniFocus.
 *
 * Runs as ONE OmniJS script: a 50-item batch used to mean 50 sequential
 * osascript round-trips into OmniFocus. The per-item results come back in
 * input order.
 */
export async function batchAddItems(items: BatchAddItemsParams[]): Promise<BatchResult> {
  if (!items || items.length === 0) {
    return { success: false, results: [], error: 'At least one item must be provided.' };
  }

  const prepared = prepareBatchItems(items);

  try {
    const raw = await runOmniJs(BATCH_ADD_ITEMS_SCRIPT, { items: prepared });
    const results = coerceBatchResults(raw, items.length, 'batch_add_items script returned no results');
    const success = results.some(r => r.success);
    return {
      success,
      results,
      error: success ? undefined : summarizeBatchErrors(results, 'added')
    };
  } catch (error: any) {
    const message = error?.message || 'Unknown error in batchAddItems';
    const results = coerceBatchResults(null, items.length, message);
    return { success: false, results, error: summarizeBatchErrors(results, 'added') };
  }
}
