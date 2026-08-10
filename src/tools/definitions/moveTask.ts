import { z } from 'zod';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { moveTask, MoveTaskParams, MoveTaskDeps } from '../primitives/moveTask.js';
import { actualContainerFromMismatches, formatMismatchLines } from '../../utils/mismatchText.js';

export const schema = z.object({
  id: z.string().optional().describe('The ID of the task to move'),
  name: z.string().optional().describe('The name of the task to move (fallback if ID not provided)'),
  targetProjectId: z.string().optional().describe('Destination project ID'),
  targetProjectName: z.string().optional().describe('Destination project name (errors on duplicate names)'),
  targetParentTaskId: z.string().optional().describe('Destination parent task ID'),
  targetParentTaskName: z.string().optional().describe('Destination parent task name (errors on duplicate names)'),
  targetInbox: z.boolean().optional().describe('Move task to inbox')
}).strict();

function formatDestination(args: z.infer<typeof schema>): string {
  if (args.targetInbox) {
    return 'inbox';
  }

  if (args.targetProjectId || args.targetProjectName) {
    return `project "${args.targetProjectId || args.targetProjectName}"`;
  }

  if (args.targetParentTaskId || args.targetParentTaskName) {
    return `parent task "${args.targetParentTaskId || args.targetParentTaskName}"`;
  }

  return 'destination';
}

/** Test-only seam: production always uses the real primitive. */
export interface MoveTaskHandlerDeps {
  moveTask: (params: MoveTaskParams, deps?: MoveTaskDeps) => ReturnType<typeof moveTask>;
}

export async function handler(
  args: z.infer<typeof schema>,
  extra: RequestHandlerExtra<any, any>,
  deps: MoveTaskHandlerDeps = { moveTask }
) {
  try {
    const result = await deps.moveTask(args as MoveTaskParams);
    const taskLabel = result.name || args.id || args.name;

    if (result.success) {
      // Post-write read-back: the edit was applied, but the task is not in the
      // container that was asked for. Reporting the REQUESTED destination here
      // would tell the caller the move landed when it did not — so report the
      // actual container and fail.
      if (result.verified === false) {
        const mismatches = result.mismatches ?? [];
        const actual = actualContainerFromMismatches(mismatches);
        const whereItIs = actual
          ? ` It is in ${actual}.`
          : ' Its actual container could not be determined.';

        return {
          content: [{
            type: 'text' as const,
            text: `⚠️ Task "${taskLabel}" was NOT moved to ${formatDestination(args)}.${whereItIs}\n` +
              `Read-back verification failed:\n${formatMismatchLines(mismatches)}`
          }],
          isError: true
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Task "${taskLabel}" moved successfully to ${formatDestination(args)}.`
        }]
      };
    }

    return {
      content: [{
        type: 'text' as const,
        text: `Failed to move task: ${result.error}`
      }],
      isError: true
    };
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`Tool execution error: ${error.message}`);

    return {
      content: [{
        type: 'text' as const,
        text: `Error moving task: ${error.message}`
      }],
      isError: true
    };
  }
}
