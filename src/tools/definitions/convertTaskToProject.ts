import { recordToolData } from '../../utils/toolResult.js';
import { z } from 'zod';
import {
  convertTaskToProject,
  validateConvertTaskToProjectParams,
  ConvertTaskToProjectParams
} from '../primitives/convertTaskToProject.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  taskId: z.string().optional().describe(
    "ID of the task to promote into a project. A stale ID is an error — it never falls back to the name."
  ),
  taskName: z.string().optional().describe(
    "Name of the task to promote (alternative to taskId). Ambiguous names are rejected with the list of matches."
  ),
  folderName: z.string().optional().describe(
    "Optional destination folder name. Omit to place the new project at the top level of the library."
  ),
  folderId: z.string().optional().describe(
    "Optional destination folder ID (alternative to folderName)."
  ),
  keepTags: z.boolean().optional().describe(
    "Tags always carry over to the new project (they live on its root task). Pass false to strip them after conversion. Default true."
  )
}).strict().superRefine((value, ctx) => {
  const validation = validateConvertTaskToProjectParams(value as ConvertTaskToProjectParams);
  if (!validation.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: validation.error ?? 'Invalid convert_task_to_project input'
    });
  }
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await convertTaskToProject(args as ConvertTaskToProjectParams);
    recordToolData(result);

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true
      };
    }

    const location = result.folder ? `folder "${result.folder}"` : 'the top level of the library';
    const subtasks = result.subtaskCount === 1 ? '1 subtask' : `${result.subtaskCount ?? 0} subtasks`;

    let text = `${result.verified ? '✅' : '⚠️'} Converted task into project **${result.name}** in ${location}\n`;
    text += `• ID: ${result.id}\n`;
    text += `• Subtasks preserved: ${subtasks}`;
    if (result.subtaskCountBefore !== undefined && result.subtaskCountBefore !== result.subtaskCount) {
      text += ` (was ${result.subtaskCountBefore} before conversion)`;
    }
    text += '\n';
    if (result.tags && result.tags.length > 0) {
      text += `• Tags: ${result.tags.join(', ')}\n`;
    } else if (result.tagsCleared) {
      text += `• Tags: cleared (keepTags: false)\n`;
    }
    if (!result.verified) {
      text += `• ⚠️ Read-back verification did not fully confirm the conversion — check the project in OmniFocus.\n`;
    }
    for (const warning of result.warnings ?? []) {
      text += `• ⚠️ ${warning}\n`;
    }

    return {
      content: [{ type: "text" as const, text }],
      ...(result.verified ? {} : { isError: true })
    };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: [{ type: "text" as const, text: `Error converting task to project: ${error.message}` }],
      isError: true
    };
  }
}
