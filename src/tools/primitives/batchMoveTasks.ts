import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { OMNIJS_PLACEMENT_HELPERS } from './addOmniFocusTask.js';
import { BatchItemResult, allVerified, coerceBatchResults, summarizeBatchErrors } from '../../utils/batchResults.js';

export interface BatchMoveTasksParams {
  tasks: Array<{ id?: string; name?: string }>;
  targetProjectId?: string;
  targetProjectName?: string;
  targetParentTaskId?: string;
  targetParentTaskName?: string;
  targetInbox?: boolean;
  /** Resolve every task and the destination, move nothing. */
  dryRun?: boolean;
}

type MoveResult = BatchItemResult;

type BatchMoveResult = {
  success: boolean;
  results: MoveResult[];
  error?: string;
  /** true when nothing was moved (dryRun). */
  dryRun?: boolean;
  /** Every moved task was read back and confirmed in the destination. */
  verified?: boolean;
};

/** Destination validation — shared by the primitive and its tests. */
export function validateBatchMoveParams(params: BatchMoveTasksParams): { valid: boolean; error?: string } {
  if (params.targetProjectId && params.targetProjectName) {
    return { valid: false, error: 'Cannot specify both targetProjectId and targetProjectName. Please use only one.' };
  }

  if (params.targetParentTaskId && params.targetParentTaskName) {
    return { valid: false, error: 'Cannot specify both targetParentTaskId and targetParentTaskName. Please use only one.' };
  }

  const destCount = [
    params.targetProjectId || params.targetProjectName ? 1 : 0,
    params.targetParentTaskId || params.targetParentTaskName ? 1 : 0,
    params.targetInbox === true ? 1 : 0
  ].reduce((sum, val) => sum + val, 0);

  if (destCount !== 1) {
    return { valid: false, error: 'Exactly one destination must be provided: project, parent task, or inbox.' };
  }

  if (!params.tasks || params.tasks.length === 0) {
    return { valid: false, error: 'At least one task must be provided.' };
  }

  return { valid: true };
}

// One static script for the whole batch — every user value arrives through the
// injected `args` object. The destination is resolved once; each task is then
// resolved, moved inside a single guarded block (skipped entirely on a dry run)
// and read back to confirm it actually landed in the destination.
export const BATCH_MOVE_TASKS_SCRIPT = `
    ${OMNIJS_LOOKUP_HELPERS}
    ${OMNIJS_PLACEMENT_HELPERS}

    const dryRun = args.dryRun === true;

    // --- Resolve the shared destination once ---
    let destParent = null;
    let destProject = null;
    const destInbox = args.targetInbox === true;

    if (args.targetProjectId || args.targetProjectName) {
      const projectLookup = __resolveByIdOrName(flattenedProjects, args.targetProjectId, args.targetProjectName, 'Destination project');
      if (projectLookup.error) {
        return JSON.stringify({ success: false, destinationError: true, error: projectLookup.error });
      }
      destProject = projectLookup.item;
    } else if (args.targetParentTaskId || args.targetParentTaskName) {
      const parentLookup = __resolveByIdOrName(flattenedTasks, args.targetParentTaskId, args.targetParentTaskName, 'Destination parent task');
      if (parentLookup.error) {
        return JSON.stringify({ success: false, destinationError: true, error: parentLookup.error });
      }
      destParent = parentLookup.item;
    }

    // The destination as a placement, so the same comparison used after an add
    // can verify a move.
    const destination = destInbox
      ? { kind: 'inbox', id: null, name: null }
      : (destParent
        ? { kind: 'parentTask', id: destParent.id.primaryKey, name: destParent.name }
        : { kind: 'project', id: destProject.id.primaryKey, name: destProject.name });

    const results = [];

    for (let i = 0; i < args.tasks.length; i++) {
      const spec = args.tasks[i];
      try {
        if (!spec.id && !spec.name) {
          results.push({ index: i, success: false, status: 'failed', error: 'Either id or name must be provided to move a task.' });
          continue;
        }

        const lookup = __resolveByIdOrName(flattenedTasks, spec.id, spec.name, 'task');
        if (lookup.error) {
          results.push({ index: i, success: false, status: 'failed', id: spec.id, name: spec.name, error: lookup.error });
          continue;
        }

        const task = lookup.item;
        const taskId = task.id.primaryKey;
        const taskName = task.name;

        if (destParent) {
          // Cycle prevention: walk up from the destination parent; finding this
          // task means the move would put it inside itself or a descendant.
          let cursor = destParent;
          let cycle = false;
          while (cursor) {
            if (cursor.id.primaryKey === taskId) { cycle = true; break; }
            const up = cursor.parent;
            cursor = (up && up.constructor === Task) ? up : null;
          }
          if (cycle) {
            results.push({ index: i, success: false, status: 'failed', id: taskId, name: taskName, error: 'Invalid move target: cannot move a task into itself or its descendants.' });
            continue;
          }
        }

        if (dryRun) {
          results.push({
            index: i,
            success: true,
            status: 'planned',
            id: taskId,
            name: taskName,
            wouldMove: {
              id: taskId,
              name: taskName,
              from: __publicPlacement(__actualTaskPlacement(task)),
              to: __publicPlacement(destination)
            }
          });
          continue;
        }

        const location = destInbox ? inbox.ending : (destParent ? destParent.ending : destProject.ending);
        moveTasks([task], location);

        // Verify in this same script: read the task back and confirm its
        // container is the destination, not wherever it happened to land.
        const check = __verifyTaskPlacement(task, destination);
        if (!check.exists) {
          results.push({ index: i, success: false, status: 'failed', id: taskId, name: taskName, verified: false, error: check.warning });
          continue;
        }

        results.push({
          index: i,
          success: true,
          status: 'ok',
          id: taskId,
          name: taskName,
          verified: check.verified,
          warning: check.warning,
          placement: __publicPlacement(check.actual)
        });
      } catch (e) {
        results.push({
          index: i,
          success: false,
          status: 'failed',
          id: spec.id,
          name: spec.name,
          error: (e && e.message) ? e.message : 'Unknown error moving task'
        });
      }
    }

    return JSON.stringify({ success: true, dryRun: dryRun, results: results });
`;

/**
 * Move multiple tasks to one destination.
 *
 * Runs as ONE OmniJS script: the destination is resolved once, then each task
 * is moved inside its own try/catch so one failure never aborts the rest.
 * Cycle prevention (moving a task into itself or a descendant) is preserved
 * from the single-task move path.
 *
 * With `dryRun`, the destination and every task are resolved exactly as for a
 * real move and reported as `wouldMove` (with the current container as `from`)
 * — nothing is moved.
 */
export async function batchMoveTasks(params: BatchMoveTasksParams): Promise<BatchMoveResult> {
  const validation = validateBatchMoveParams(params);
  if (!validation.valid) {
    return { success: false, results: [], error: validation.error };
  }

  const dryRun = params.dryRun === true;

  try {
    const raw = await runOmniJs(BATCH_MOVE_TASKS_SCRIPT, params, dryRun ? { readOnly: true } : undefined);

    // An unresolvable destination aborts before any task is touched: report it
    // as the batch error with no per-item results, so the handler prints it once
    // rather than repeating it per task.
    if (raw && raw.destinationError === true) {
      return { success: false, results: [], error: raw.error || 'Destination could not be resolved.', dryRun };
    }

    const results = coerceBatchResults(raw, params.tasks.length, 'batch_move_tasks script returned no results');
    const success = results.some(r => r.success);
    return {
      success,
      results,
      error: success ? undefined : summarizeBatchErrors(results, dryRun ? 'planned' : 'moved'),
      dryRun,
      verified: dryRun ? undefined : allVerified(results)
    };
  } catch (error: any) {
    const message = error?.message || 'Unknown error in batchMoveTasks';
    const results = coerceBatchResults(null, params.tasks.length, message);
    return { success: false, results, error: summarizeBatchErrors(results, 'moved'), dryRun };
  }
}
