import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import {
  OMNIJS_CREATE_TASK_HELPER,
  OMNIJS_CREATE_PROJECT_HELPER,
  OMNIJS_PLACEMENT_HELPERS,
  normalizeItemDates,
  validateAddTaskParams
} from './addOmniFocusTask.js';
import {
  BatchItemResult,
  allVerified,
  coerceBatchResults,
  summarizeBatchErrors
} from '../../utils/batchResults.js';

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
  tagIds?: string[];
  projectName?: string; // For tasks
  parentTaskId?: string; // For subtasks
  parentTaskName?: string; // For subtasks (alternative to ID)
  folderName?: string; // For projects
  sequential?: boolean; // For projects
  tempId?: string; // Handle for this item, referenced by a later item's parentTempId
  parentTempId?: string; // Create under an item created EARLIER in this same batch
};

/** Batch-wide options. All default to false (v0.4.0 behaviour). */
export type BatchAddItemsOptions = {
  /** Resolve everything, write nothing. */
  dryRun?: boolean;
  /** Stop at the first failure; remaining items come back as `skipped`. */
  stopOnError?: boolean;
  /** All-or-nothing: any failure deletes everything created so far, in the same script. */
  atomic?: boolean;
};

// Define the result type for individual operations
export type ItemResult = BatchItemResult;

// Define the result type for the batch operation
type BatchResult = {
  success: boolean;
  results: ItemResult[];
  error?: string;
  /** true when nothing was written (dryRun). */
  dryRun?: boolean;
  /** tempId -> real OmniFocus id, for items that declared a tempId. */
  mapping?: Record<string, string>;
  /** true when an atomic batch failed and every created object was deleted. */
  rolledBack?: boolean;
  rollbackStatus?: 'not_needed' | 'complete' | 'partial';
  survivingItems?: Array<{ id?: string; name: string; itemType: string; index: number }>;
  /** Every created object was read back and confirmed in the requested container. */
  verified?: boolean;
  /** Objects the rollback could not delete (already gone, or deletion threw). */
  rollbackErrors?: string[];
};

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

    if (kind === 'project' && item.parentTempId) {
      prepared.preflightError = 'parentTempId is only valid on task items; projects cannot be nested inside another batch item.';
      return prepared;
    }

    if (kind === 'task') {
      // A parentTempId supplies the parent, so the parent/project conflict rules
      // are checked against it too.
      if (item.parentTempId && (item.parentTaskId || item.parentTaskName || item.projectName)) {
        prepared.preflightError = 'Cannot combine parentTempId with parentTaskId, parentTaskName or projectName.';
        return prepared;
      }
      const validation = validateAddTaskParams(item);
      if (!validation.valid) prepared.preflightError = validation.error;
    }

    return prepared;
  });
}

// One static script for the whole batch — every user value arrives through the
// injected `args` object, and each item is handled inside its own try/catch so
// one failure never aborts the rest.
//
// Structure (single OmniJS evaluation, per the single-script rule — background
// sync mutates the database between calls, so resolve, write, verify and roll
// back all have to happen here):
//   1. resolve  — identical in dryRun and real runs
//   2. mutate   — ONE guarded block, skipped entirely when args.dryRun is set
//   3. verify   — read each created object back and compare its container
//   4. rollback — atomic batches delete every created object in reverse order
export const BATCH_ADD_ITEMS_SCRIPT = `
    ${OMNIJS_LOOKUP_HELPERS}
    ${OMNIJS_PLACEMENT_HELPERS}
    ${OMNIJS_CREATE_TASK_HELPER}
    ${OMNIJS_CREATE_PROJECT_HELPER}

    const dryRun = args.dryRun === true;
    const stopOnError = args.stopOnError === true;
    const atomic = args.atomic === true;

    const results = [];
    const created = [];        // creation order; rollback walks it in reverse
    const tempMap = Object.create(null);        // tempId -> { id, kind, name, obj }
    const plannedTempMap = Object.create(null); // dryRun equivalent: tempId -> { name, kind }
    const mapping = Object.create(null);        // tempId -> real id
    const rollbackErrors = [];
    let anyFailed = false;

    for (let i = 0; i < args.items.length; i++) {
      const item = args.items[i];
      const warnings = [];
      const creationStart = created.length;
      try {
        if (anyFailed && stopOnError) {
          results.push({
            index: i,
            success: false,
            status: 'skipped',
            name: item.name,
            tempId: item.tempId,
            error: 'Skipped: an earlier item failed and stopOnError was set.'
          });
          continue;
        }

        if (item.preflightError) {
          anyFailed = true;
          results.push({ index: i, success: false, status: 'failed', name: item.name, tempId: item.tempId, error: item.preflightError });
          continue;
        }

        // --- 1. RESOLVE (identical work in a dry run and a real run) ---
        let placement = null;
        let placementError = null;

        if (item.parentTempId) {
          if (dryRun) {
            const planned = plannedTempMap[item.parentTempId];
            if (!planned) {
              placementError = 'parentTempId "' + item.parentTempId + '" refers to an item that would not be created.';
            } else {
              placement = { kind: planned.kind === 'project' ? 'project' : 'parentTask', id: null, name: planned.name, tempId: item.parentTempId, pending: true };
            }
          } else {
            const ref = tempMap[item.parentTempId];
            if (!ref) {
              placementError = 'parentTempId "' + item.parentTempId + '" refers to an item that was not created.';
            } else {
              placement = { kind: ref.kind === 'project' ? 'project' : 'parentTask', id: ref.id, name: ref.name, location: ref.obj.ending };
            }
          }
        } else if (item.kind === 'task') {
          const resolvedTask = __resolveTaskPlacement(item);
          if (resolvedTask.error) { placementError = resolvedTask.error; } else { placement = resolvedTask.placement; }
        } else {
          const resolvedProject = __resolveProjectPlacement(item);
          if (resolvedProject.error) { placementError = resolvedProject.error; } else { placement = resolvedProject.placement; }
        }

        if (placementError) {
          anyFailed = true;
          results.push({ index: i, success: false, status: 'failed', name: item.name, tempId: item.tempId, error: placementError });
          continue;
        }

        if (dryRun) {
          // Tag resolution is a pure read here; the real path resolves the same
          // names inside __applyTagsTo, creating the missing ones.
          const tagPlan = __resolveTagsSpec(item.tags, item.tagIds);
          if (tagPlan.error) throw new Error(tagPlan.error);
          if (item.tempId) { plannedTempMap[item.tempId] = { name: item.name, kind: item.kind }; }
          results.push({
            index: i,
            success: true,
            status: 'planned',
            name: item.name,
            tempId: item.tempId,
            wouldCreate: {
              itemType: item.kind,
              name: item.name,
              tempId: item.tempId,
              destination: __publicPlacement(placement),
              tagsToCreate: tagPlan.missing
            }
          });
          continue;
        }

        // --- 2. MUTATE (the only block in this script that writes) ---
        const outcome = item.kind === 'task'
          ? __createTask(item, warnings, created, placement)
          : __createProject(item, warnings, created, placement);

        if (outcome.error) {
          anyFailed = true;
          results.push({ index: i, success: false, status: 'failed', name: item.name, tempId: item.tempId, error: outcome.error });
          continue;
        }

        const madeObject = item.kind === 'task' ? outcome.task : outcome.project;

        // --- 3. VERIFY (read-back in this same script) ---
        const check = item.kind === 'task'
          ? __verifyTaskPlacement(madeObject, placement)
          : __verifyProjectPlacement(madeObject, placement);

        if (!__verifyTagPlan(madeObject, outcome.tagPlan)) {
          check.verified = false;
          check.warning = 'Tag verification failed: requested tag IDs were not retained.';
        }

        if (!check.exists) {
          anyFailed = true;
          results.push({ index: i, success: false, status: 'failed', name: item.name, tempId: item.tempId, error: check.warning });
          continue;
        }

        // Under atomic, a misplaced item is a FAILED item. The object exists,
        // so without atomic it is kept and the mismatch is reported as a
        // warning — but "all or nothing" cannot mean "all, except the one
        // stranded in the wrong container". It is already in the created list,
        // so the rollback below deletes it with everything else.
        if (atomic && check.verified !== true) {
          anyFailed = true;
          results.push({
            index: i,
            success: false,
            status: 'failed',
            name: item.name,
            tempId: item.tempId,
            verified: false,
            error: check.warning || 'Placement could not be verified after the write.'
          });
          continue;
        }

        const newId = madeObject.id.primaryKey;
        if (item.tempId) {
          tempMap[item.tempId] = { id: newId, kind: item.kind, name: madeObject.name, obj: madeObject };
          mapping[item.tempId] = newId;
        }

        results.push({
          index: i,
          success: true,
          status: 'ok',
          id: newId,
          name: madeObject.name,
          tempId: item.tempId,
          warnings: warnings,
          verified: check.verified,
          warning: check.warning,
          placement: __publicPlacement(check.actual)
        });
      } catch (e) {
        anyFailed = true;
        results.push({
          index: i,
          success: false,
          status: 'failed',
          name: item.name,
          tempId: item.tempId,
          error: (e && e.message) ? e.message : 'Unknown error creating item'
        });
      } finally {
        for (var c = creationStart; c < created.length; c++) created[c].index = i;
      }
    }

    // --- 4. ROLLBACK (same script: a second round-trip would race sync) ---
    let rolledBack = false;
    let rollbackStatus = 'not_needed';
    const survivingItems = [];
    if (!dryRun && atomic && anyFailed && created.length > 0) {
      const attempts = [];
      for (let r = created.length - 1; r >= 0; r--) {
        const entry = created[r];
        let id = null, failure = null;
        try { id = entry.obj.id.primaryKey; } catch (e) {}
        try { deleteObject(entry.obj); } catch (e) { failure = e.message || String(e); }
        attempts.push({ entry: entry, id: id, failure: failure });
      }
      attempts.forEach(function (attempt) {
        const entry = attempt.entry;
        const collection = entry.kind === 'task' ? flattenedTasks : entry.kind === 'project' ? flattenedProjects : flattenedTags;
        const remains = !attempt.id || __findById(collection, attempt.id, entry.kind);
        if (remains) {
          survivingItems.push({ id: attempt.id, name: entry.name, itemType: entry.kind, index: entry.index });
          rollbackErrors.push(entry.kind + ' "' + entry.name + '" (' + (attempt.id || 'unknown id') + '): ' + (attempt.failure || 'still exists after deletion'));
        }
      });
      rolledBack = survivingItems.length === 0;
      rollbackStatus = rolledBack ? 'complete' : 'partial';
      for (let k = 0; k < results.length; k++) {
        const survivors = survivingItems.filter(function (entry) { return entry.index === k; });
        const wasCreated = created.some(function (entry) { return entry.index === k; });
        if (wasCreated && (survivors.length > 0 || results[k].success)) {
          results[k].success = false;
          results[k].status = survivors.length ? 'rollbackFailed' : 'rolledBack';
          results[k].verified = false;
          results[k].error = survivors.length
            ? 'Rollback incomplete; surviving IDs: ' + survivors.map(function (entry) { return entry.id || '(unknown)'; }).join(', ')
            : 'Rolled back: another item in this atomic batch failed.';
        }
      }
      Object.getOwnPropertyNames(mapping).forEach(function (key) {
        if (!survivingItems.some(function (entry) { return entry.id === mapping[key]; })) delete mapping[key];
      });
    }

    return JSON.stringify({
      success: true,
      dryRun: dryRun,
      rolledBack: rolledBack,
      rollbackStatus: rollbackStatus,
      survivingItems: survivingItems,
      mapping: mapping,
      rollbackErrors: rollbackErrors,
      results: results
    });
`;

/**
 * Add multiple items (tasks or projects) to OmniFocus.
 *
 * Runs as ONE OmniJS script: a 50-item batch used to mean 50 sequential
 * osascript round-trips into OmniFocus. The per-item results come back in
 * input order.
 *
 * Options:
 *   dryRun      resolve every lookup, write nothing, report wouldCreate per item
 *   stopOnError abandon the batch at the first failure (rest come back skipped)
 *   atomic      any failure deletes everything created so far, in the same script
 */
export async function batchAddItems(items: BatchAddItemsParams[], options?: BatchAddItemsOptions): Promise<BatchResult> {
  if (!items || items.length === 0) {
    return { success: false, results: [], error: 'At least one item must be provided.' };
  }

  const dryRun = options?.dryRun === true;
  const atomic = options?.atomic === true;
  // atomic implies stop-on-error: rolling back after continuing past a failure
  // would undo work the caller never learned had failed.
  const stopOnError = options?.stopOnError === true || atomic;

  const prepared = prepareBatchItems(items);

  try {
    const raw = await runOmniJs(
      BATCH_ADD_ITEMS_SCRIPT,
      { items: prepared, dryRun, stopOnError, atomic },
      dryRun ? { readOnly: true } : undefined
    );
    const results = coerceBatchResults(raw, items.length, 'batch_add_items script returned no results');
    const success = results.some(r => r.success);
    const rollbackErrors = raw && Array.isArray(raw.rollbackErrors) && raw.rollbackErrors.length > 0
      ? (raw.rollbackErrors as string[])
      : undefined;

    return {
      success,
      results,
      error: success ? undefined : summarizeBatchErrors(results, dryRun ? 'planned' : 'added'),
      dryRun,
      mapping: raw && raw.mapping && typeof raw.mapping === 'object' ? raw.mapping : {},
      rolledBack: raw && raw.rolledBack === true,
      rollbackStatus: raw?.rollbackStatus ?? 'not_needed',
      survivingItems: Array.isArray(raw?.survivingItems) ? raw.survivingItems : [],
      verified: dryRun ? undefined : allVerified(results),
      rollbackErrors
    };
  } catch (error: any) {
    const message = error?.message || 'Unknown error in batchAddItems';
    const results = coerceBatchResults(null, items.length, message);
    return { success: false, results, error: summarizeBatchErrors(results, 'added'), dryRun };
  }
}
