import { moveTask, MoveTaskParams } from './moveTask.js';

export interface BatchMoveTasksParams {
  tasks: Array<{ id?: string; name?: string }>;
  targetProjectId?: string;
  targetProjectName?: string;
  targetParentTaskId?: string;
  targetParentTaskName?: string;
  targetInbox?: boolean;
}

type MoveResult = {
  success: boolean;
  id?: string;
  name?: string;
  error?: string;
};

type BatchMoveResult = {
  success: boolean;
  results: MoveResult[];
  error?: string;
};

export async function batchMoveTasks(params: BatchMoveTasksParams): Promise<BatchMoveResult> {
  try {
    // Validate exactly one destination
    const destCount = [
      params.targetProjectId || params.targetProjectName ? 1 : 0,
      params.targetParentTaskId || params.targetParentTaskName ? 1 : 0,
      params.targetInbox === true ? 1 : 0
    ].reduce((sum, val) => sum + val, 0);

    if (destCount !== 1) {
      return {
        success: false,
        results: [],
        error: 'Exactly one destination must be provided: project, parent task, or inbox.'
      };
    }

    if (!params.tasks || params.tasks.length === 0) {
      return {
        success: false,
        results: [],
        error: 'At least one task must be provided.'
      };
    }

    const results: MoveResult[] = [];

    for (const task of params.tasks) {
      try {
        const moveParams: MoveTaskParams = {
          id: task.id,
          name: task.name,
          targetProjectId: params.targetProjectId,
          targetProjectName: params.targetProjectName,
          targetParentTaskId: params.targetParentTaskId,
          targetParentTaskName: params.targetParentTaskName,
          targetInbox: params.targetInbox
        };

        const result = await moveTask(moveParams);
        results.push({
          success: result.success,
          id: result.id,
          name: result.name,
          error: result.error
        });
      } catch (itemError: any) {
        results.push({
          success: false,
          error: itemError.message || "Unknown error moving task"
        });
      }
    }

    const overallSuccess = results.some(r => r.success);

    return {
      success: overallSuccess,
      results
    };
  } catch (error: any) {
    return {
      success: false,
      results: [],
      error: error.message || "Unknown error in batchMoveTasks"
    };
  }
}
