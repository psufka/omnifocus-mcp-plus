import { recordToolData } from '../../utils/toolResult.js';
import { z } from 'zod';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  manageAttachments,
  INLINE_BASE64_LIMIT_BYTES,
  MAX_ATTACHMENT_BYTES,
  type AttachmentDescriptor,
  type ManageAttachmentsResult
} from '../primitives/manageAttachments.js';

const ITEM_FIELDS = ['taskId', 'taskName', 'projectId', 'projectName'] as const;

export const schema = z.object({
  operation: z.enum(['list', 'read', 'add', 'remove']).describe(
    "'list' shows every attachment with its index and size. " +
    "'read' returns one attachment (inline base64 when small, otherwise written to savePath). " +
    "'add' attaches a new file. " +
    "'remove' deletes an attachment by index."
  ),

  taskId: z.string().min(1).optional().describe("ID of the task that owns the attachments."),
  taskName: z.string().min(1).optional().describe("Name of the task (alternative to taskId)."),
  projectId: z.string().min(1).optional().describe("ID of the project that owns the attachments."),
  projectName: z.string().min(1).optional().describe("Name of the project (alternative to projectId)."),

  index: z.number().int().min(0).optional().describe(
    "read/remove only: zero-based attachment index from 'list'. Indices shift after a removal, so re-list before removing a second attachment."
  ),
  filename: z.string().min(1).optional().describe(
    "add only: the filename to store the attachment under (e.g. 'receipt.pdf'). Include the extension — OmniFocus uses it to pick an icon and a handler app."
  ),
  base64: z.string().optional().describe(
    `add only: file contents as base64. Use this for content you generated. Max ${MAX_ATTACHMENT_BYTES} bytes decoded. Mutually exclusive with filePath.`
  ),
  filePath: z.string().optional().describe(
    `add only: ABSOLUTE path to a file on disk to attach. Mutually exclusive with base64. Max ${MAX_ATTACHMENT_BYTES} bytes.`
  ),
  savePath: z.string().optional().describe(
    `read only: ABSOLUTE path to write the attachment to. Required for attachments of ${INLINE_BASE64_LIMIT_BYTES} bytes or more. An existing file is never overwritten.`
  )
}).strict()
  .refine(
    data => ITEM_FIELDS.filter(field => data[field] !== undefined).length === 1,
    {
      message: "Exactly one of taskId, taskName, projectId, projectName must be provided",
      path: ['taskId']
    }
  )
  .refine(
    data => (data.operation === 'read' || data.operation === 'remove') ? data.index !== undefined : data.index === undefined,
    {
      message: "index is required for 'read' and 'remove', and not allowed for other operations",
      path: ['index']
    }
  )
  .refine(
    data => data.operation === 'add' ? data.filename !== undefined : data.filename === undefined,
    {
      message: "filename is required for 'add' and not allowed for other operations",
      path: ['filename']
    }
  )
  .refine(
    data => data.operation === 'add'
      ? [data.base64, data.filePath].filter(v => v !== undefined).length === 1
      : data.base64 === undefined && data.filePath === undefined,
    {
      message: "'add' requires exactly one of base64 or filePath; neither is allowed for other operations",
      path: ['base64']
    }
  )
  .refine(
    data => data.savePath === undefined || data.operation === 'read',
    {
      message: "savePath is only valid for operation 'read'",
      path: ['savePath']
    }
  );

/** Byte counts as something a human reads at a glance. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return 'size unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAttachmentList(attachments: AttachmentDescriptor[] | undefined): string {
  if (!attachments || attachments.length === 0) return '_No attachments._';
  return attachments
    .map(a => `  [${a.index}] ${a.filename} — ${formatBytes(a.byteSize)}`)
    .join('\n');
}

function itemLabel(result: ManageAttachmentsResult): string {
  return `${result.itemKind ?? 'item'} "${result.itemName}"`;
}

function verificationNote(result: ManageAttachmentsResult): string {
  return result.verified === false
    ? '\n\n⚠️ **Unverified:** the attachment count read back after the write did not change as expected. Re-run with operation `list` to see the real state.'
    : '';
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = recordToolData(await manageAttachments(args));

    if (!result.success) {
      const listing = result.attachments && result.attachments.length > 0
        ? `\n\nCurrent attachments:\n${formatAttachmentList(result.attachments)}`
        : '';
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}${listing}` }],
        isError: true
      };
    }

    let output: string;
    switch (args.operation) {
      case 'list':
        output = result.count === 0
          ? `📎 **${itemLabel(result)} has no attachments.**`
          : `📎 **${result.count} attachment${result.count === 1 ? '' : 's'} on ${itemLabel(result)}** [${result.itemId}]\n\n${formatAttachmentList(result.attachments)}`;
        break;

      case 'read':
        if (result.savedPath) {
          output = `📎 **Wrote "${result.filename}" (${formatBytes(result.byteSize)}) to** \`${result.savedPath}\``;
        } else {
          output = `📎 **${result.filename}** (${formatBytes(result.byteSize)}) from ${itemLabel(result)}\n\n` +
            `Base64 contents:\n\n\`\`\`\n${result.base64}\n\`\`\``;
        }
        break;

      case 'add':
        output = `📎 **Attached "${args.filename}" to ${itemLabel(result)}** at index ${result.addedIndex} ` +
          `(${result.count} attachment${result.count === 1 ? '' : 's'} total)\n\n${formatAttachmentList(result.attachments)}` +
          verificationNote(result);
        break;

      case 'remove':
        output = `📎 **Removed "${result.removedFilename}" (index ${result.removedIndex}) from ${itemLabel(result)}** ` +
          `— ${result.count} remaining\n\n${formatAttachmentList(result.attachments)}` +
          (result.count && result.count > 0 ? '\n\n_Indices have shifted; re-read them before another removal._' : '') +
          verificationNote(result);
        break;

      default:
        output = JSON.stringify(result);
    }

    return { content: [{ type: "text" as const, text: output }] };
  } catch (err: unknown) {
    return {
      content: [{ type: "text" as const, text: `Error managing attachments: ${(err as Error).message}` }],
      isError: true
    };
  }
}
