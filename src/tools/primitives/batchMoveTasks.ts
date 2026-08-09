import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';
import { BatchItemResult, coerceBatchResults, summarizeBatchErrors } from '../../utils/batchResults.js';

export interface BatchMoveTasksParams {
  tasks: Array<{ id?: string; name?: string }>;
  targetProjectId?: string;
  targetProjectName?: string;
  targetParentTaskId?: string;
  targetParentTaskName?: string;
  targetInbox?: boolean;
}

type MoveResult = BatchItemResult;

type BatchMoveResult = {
  success: boolean;
  results: MoveResult[];
  error?: string;
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
// injected `args` object.
export const BATCH_MOVE_TASKS_SCRIPT = `
    ${OMNIJS_LOOKUP_HELPERS}

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

    const results = [];

    for (let i = 0; i < args.tasks.length; i++) {
      const spec = args.tasks[i];
      try {
        if (!spec.id && !spec.name) {
          results.push({ index: i, success: false, error: 'Either id or name must be provided to move a task.' });
          continue;
        }

        const lookup = __resolveByIdOrName(flattenedTasks, spec.id, spec.name, 'task');
        if (lookup.error) {
          results.push({ index: i, success: false, id: spec.id, name: spec.name, error: lookup.error });
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
            results.push({ index: i, success: false, id: taskId, name: taskName, error: 'Invalid move target: cannot move a task into itself or its descendants.' });
            continue;
          }
        }

        const location = destInbox ? inbox.ending : (destParent ? destParent.ending : destProject.ending);
        moveTasks([task], location);

        results.push({ index: i, success: true, id: taskId, name: taskName });
      } catch (e) {
        results.push({
          index: i,
          success: false,
          id: spec.id,
          name: spec.name,
          error: (e && e.message) ? e.message : 'Unknown error moving task'
        });
      }
    }

    return JSON.stringify({ success: true, results: results });
`;

/**
 * Move multiple tasks to one destination.
 *
 * Runs as ONE OmniJS script: the destination is resolved once, then each task
 * is moved inside its own try/catch so one failure never aborts the rest.
 * Cycle prevention (moving a task into itself or a descendant) is preserved
 * from the single-task move path.
 */
export async function batchMoveTasks(params: BatchMoveTasksParams): Promise<BatchMoveResult> {
  const validation = validateBatchMoveParams(params);
  if (!validation.valid) {
    return { success: false, results: [], error: validation.error };
  }

  try {
    const raw = await runOmniJs(BATCH_MOVE_TASKS_SCRIPT, params);

    // An unresolvable destination aborts before any task is touched: report it
    // as the batch error with no per-item results, so the handler prints it once
    // rather than repeating it per task.
    if (raw && raw.destinationError === true) {
      return { success: false, results: [], error: raw.error || 'Destination could not be resolved.' };
    }

    const results = coerceBatchResults(raw, params.tasks.length, 'batch_move_tasks script returned no results');
    const success = results.some(r => r.success);
    return {
      success,
      results,
      error: success ? undefined : summarizeBatchErrors(results, 'moved')
    };
  } catch (error: any) {
    const message = error?.message || 'Unknown error in batchMoveTasks';
    const results = coerceBatchResults(null, params.tasks.length, message);
    return { success: false, results, error: summarizeBatchErrors(results, 'moved') };
  }
}
