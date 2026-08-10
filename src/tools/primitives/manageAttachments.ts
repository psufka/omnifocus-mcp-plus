import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { isAbsolute, dirname } from 'node:path';
import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

/**
 * manage_attachments — list / read / add / remove file attachments on a task
 * or project.
 *
 * OmniJS surface (probed live on OmniFocus 4.8.13):
 *   - `task.attachments` / `project.attachments` is a real JS Array of
 *     FileWrapper objects.
 *   - `Task.prototype.addAttachment(fileWrapper)` and
 *     `removeAttachmentAtIndex(i)` exist on both Task and Project.
 *   - A FileWrapper instance owns { type, children, contents, destination,
 *     preferredFilename, filename }. A wrapper built in memory has
 *     `filename === null` and only `preferredFilename` set, so the display
 *     name must fall back from one to the other.
 *   - `contents` is a `Data`; `Data.prototype.toBase64()` and the static
 *     `Data.fromBase64(string)` round-trip cleanly, and `data.length` is the
 *     byte count.
 *
 * Every one of those accesses is still written defensively (typeof checks plus
 * an introspection error listing Object.getOwnPropertyNames) so a future
 * OmniFocus that moves the shape reports WHAT it found instead of throwing an
 * opaque TypeError.
 *
 * Size policy: 10MB hard cap enforced on both sides (script-side before
 * encoding, Node-side before sending). Payloads at or above 256KB are never
 * inlined as base64 in the text result — the caller must supply `savePath` and
 * the file is written to disk instead.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const INLINE_BASE64_LIMIT_BYTES = 256 * 1024;

export type ManageAttachmentsOperation = 'list' | 'read' | 'add' | 'remove';

export interface ManageAttachmentsParams {
  operation: ManageAttachmentsOperation;
  taskId?: string;
  taskName?: string;
  projectId?: string;
  projectName?: string;
  index?: number;
  filename?: string;
  base64?: string;
  filePath?: string;
  savePath?: string;
}

export interface AttachmentDescriptor {
  index: number;
  filename: string;
  byteSize: number | null;
}

export interface ManageAttachmentsResult {
  success: boolean;
  error?: string;
  operation?: ManageAttachmentsOperation;
  itemKind?: 'task' | 'project';
  itemId?: string;
  itemName?: string;
  count?: number;
  attachments?: AttachmentDescriptor[];
  /** read */
  filename?: string;
  byteSize?: number | null;
  base64?: string;
  dataOmitted?: boolean;
  savedPath?: string;
  /** add / remove */
  addedIndex?: number;
  removedIndex?: number;
  removedFilename?: string;
  verified?: boolean;
}

const ATTACHMENT_HELPERS = `
  var MAX_BYTES = args.maxBytes;
  var INLINE_LIMIT = args.inlineLimitBytes;

  function __introspect(o) {
    try { return Object.getOwnPropertyNames(o).join(', '); } catch (e) { return 'unavailable'; }
  }

  function __protoIntrospect(o) {
    try { return Object.getOwnPropertyNames(Object.getPrototypeOf(o)).join(', '); } catch (e) { return 'unavailable'; }
  }

  // A wrapper built in memory has filename === null and only
  // preferredFilename set; a stored one may have either.
  function __attachmentFilename(a, idx) {
    try { if (a.filename) { return a.filename; } } catch (e) {}
    try { if (a.preferredFilename) { return a.preferredFilename; } } catch (e) {}
    return 'attachment-' + idx;
  }

  function __attachmentContents(a) {
    try { return a.contents || null; } catch (e) { return null; }
  }

  function __dataSize(d) {
    if (!d) { return null; }
    try { if (typeof d.length === 'number') { return d.length; } } catch (e) {}
    try { if (typeof d.byteLength === 'number') { return d.byteLength; } } catch (e) {}
    try { if (typeof d.size === 'number') { return d.size; } } catch (e) {}
    return null;
  }

  // Task and Project both carry the attachment API directly. The project.task
  // fallback exists because a project delegates most task properties to its
  // root task, so that is where the array would move if it ever moved.
  function __attachHost(item) {
    try { if (item && item.attachments && typeof item.addAttachment === 'function') { return item; } } catch (e) {}
    try { if (item && item.task && item.task.attachments && typeof item.task.addAttachment === 'function') { return item.task; } } catch (e) {}
    return null;
  }

  function __describeAttachments(host) {
    var list = host.attachments;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      out.push({
        index: i,
        filename: __attachmentFilename(a, i),
        byteSize: __dataSize(__attachmentContents(a))
      });
    }
    return out;
  }
`;

export const MANAGE_ATTACHMENTS_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${ATTACHMENT_HELPERS}

  const op = args.operation;

  var itemKind = 'task';
  var lookup = null;
  if (args.taskId || args.taskName) {
    lookup = __resolveByIdOrName(flattenedTasks, args.taskId, args.taskName, 'Task');
  } else {
    itemKind = 'project';
    lookup = __resolveByIdOrName(flattenedProjects, args.projectId, args.projectName, 'Project');
  }
  if (lookup.error) { return JSON.stringify({ success: false, operation: op, error: lookup.error }); }

  const item = lookup.item;
  const host = __attachHost(item);
  if (!host) {
    return JSON.stringify({
      success: false,
      operation: op,
      error: 'This OmniFocus build does not expose an attachments array on the ' + itemKind + '. Own properties found: ' + __introspect(item)
    });
  }

  const itemId = item.id.primaryKey;
  const itemName = item.name;

  if (op === 'list') {
    const listed = __describeAttachments(host);
    return JSON.stringify({
      success: true, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
      count: listed.length, attachments: listed
    });
  }

  if (op === 'read' || op === 'remove') {
    const current = host.attachments;
    if (current.length === 0) {
      return JSON.stringify({
        success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
        error: 'The ' + itemKind + ' "' + itemName + '" has no attachments.'
      });
    }
    if (typeof args.index !== 'number' || args.index < 0 || args.index >= current.length) {
      return JSON.stringify({
        success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
        error: 'Attachment index ' + args.index + ' is out of range: "' + itemName + '" has ' + current.length + ' attachment(s), valid indices are 0-' + (current.length - 1) + '. Use operation list to see current indices.',
        attachments: __describeAttachments(host)
      });
    }

    if (op === 'read') {
      const target = current[args.index];
      const targetName = __attachmentFilename(target, args.index);
      const contents = __attachmentContents(target);
      if (!contents) {
        return JSON.stringify({
          success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
          error: 'Attachment ' + args.index + ' ("' + targetName + '") has no readable contents; it may be a link or alias rather than embedded data. Own properties found: ' + __introspect(target)
        });
      }

      const size = __dataSize(contents);
      if (size !== null && size > MAX_BYTES) {
        return JSON.stringify({
          success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
          error: 'Attachment "' + targetName + '" is ' + size + ' bytes, over the ' + MAX_BYTES + ' byte read limit. Open it in OmniFocus instead.'
        });
      }

      // Nothing to do with the bytes: no savePath was given and the payload is
      // too large to inline, so it is never encoded or transferred.
      if (!args.savePathProvided && size !== null && size >= INLINE_LIMIT) {
        return JSON.stringify({
          success: true, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
          filename: targetName, byteSize: size, dataOmitted: true
        });
      }

      if (typeof contents.toBase64 !== 'function') {
        return JSON.stringify({
          success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
          error: 'Attachment contents cannot be encoded: no toBase64 method. Own properties: ' + __introspect(contents) + ' | prototype: ' + __protoIntrospect(contents)
        });
      }

      var encoded = null;
      try { encoded = contents.toBase64(); } catch (e) {
        return JSON.stringify({
          success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
          error: 'Could not encode attachment "' + targetName + '": ' + e.message
        });
      }

      // Size was unknown before encoding: enforce the cap on the encoded form.
      var effectiveSize = size;
      if (effectiveSize === null) {
        effectiveSize = Math.floor(encoded.length * 3 / 4);
        if (effectiveSize > MAX_BYTES) {
          return JSON.stringify({
            success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
            error: 'Attachment "' + targetName + '" is about ' + effectiveSize + ' bytes, over the ' + MAX_BYTES + ' byte read limit.'
          });
        }
      }

      return JSON.stringify({
        success: true, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
        filename: targetName, byteSize: effectiveSize, base64: encoded
      });
    }

    const doomedName = __attachmentFilename(current[args.index], args.index);
    const countBefore = current.length;
    try {
      host.removeAttachmentAtIndex(args.index);
    } catch (e) {
      return JSON.stringify({
        success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
        error: 'OmniFocus rejected removeAttachmentAtIndex(' + args.index + '): ' + e.message
      });
    }
    const afterRemove = __describeAttachments(host);
    return JSON.stringify({
      success: true, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
      removedIndex: args.index, removedFilename: doomedName,
      count: afterRemove.length, attachments: afterRemove,
      verified: afterRemove.length === countBefore - 1
    });
  }

  if (op === 'add') {
    if (typeof Data === 'undefined' || typeof Data.fromBase64 !== 'function') {
      return JSON.stringify({
        success: false, operation: op,
        error: 'This OmniFocus build cannot build attachment data: Data.fromBase64 is missing. Data statics found: ' + (typeof Data === 'undefined' ? 'Data is undefined' : __introspect(Data))
      });
    }
    if (typeof FileWrapper === 'undefined' || typeof FileWrapper.withContents !== 'function') {
      return JSON.stringify({
        success: false, operation: op,
        error: 'This OmniFocus build cannot build attachments: FileWrapper.withContents is missing. FileWrapper statics found: ' + (typeof FileWrapper === 'undefined' ? 'FileWrapper is undefined' : __introspect(FileWrapper))
      });
    }

    var payload = null;
    try { payload = Data.fromBase64(args.base64); } catch (e) {
      return JSON.stringify({ success: false, operation: op, error: 'Could not decode the supplied data: ' + e.message });
    }
    if (!payload) {
      return JSON.stringify({ success: false, operation: op, error: 'Data.fromBase64 returned nothing for the supplied data.' });
    }

    var wrapper = null;
    try { wrapper = FileWrapper.withContents(args.filename, payload); } catch (e) {
      return JSON.stringify({ success: false, operation: op, error: 'Could not build a FileWrapper for "' + args.filename + '": ' + e.message });
    }
    if (!wrapper) {
      return JSON.stringify({ success: false, operation: op, error: 'FileWrapper.withContents returned nothing for "' + args.filename + '".' });
    }

    const countBeforeAdd = host.attachments.length;
    try {
      host.addAttachment(wrapper);
    } catch (e) {
      return JSON.stringify({
        success: false, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
        error: 'OmniFocus rejected addAttachment: ' + e.message
      });
    }

    const afterAdd = __describeAttachments(host);
    return JSON.stringify({
      success: true, operation: op, itemKind: itemKind, itemId: itemId, itemName: itemName,
      addedIndex: afterAdd.length - 1, count: afterAdd.length, attachments: afterAdd,
      verified: afterAdd.length === countBeforeAdd + 1
    });
  }

  return JSON.stringify({ success: false, error: 'Unknown operation: ' + op });
`;

const ITEM_FIELDS = ['taskId', 'taskName', 'projectId', 'projectName'] as const;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Node-side guards, mirroring the schema refinements so the primitive is safe
 * when called directly and never burns an osascript round-trip on input that
 * cannot succeed.
 */
export function validateManageAttachmentsParams(params: ManageAttachmentsParams): { valid: boolean; error?: string } {
  const selectors = ITEM_FIELDS.filter(field => typeof params[field] === 'string' && (params[field] as string).length > 0);
  if (selectors.length !== 1) {
    return {
      valid: false,
      error: `Exactly one of taskId, taskName, projectId, projectName must be provided (got ${selectors.length}).`
    };
  }

  const { operation } = params;

  if (operation === 'read' || operation === 'remove') {
    if (!Number.isInteger(params.index) || (params.index as number) < 0) {
      return { valid: false, error: `index (a non-negative integer) is required for operation '${operation}'. Use operation 'list' to see current indices.` };
    }
  } else if (params.index !== undefined) {
    return { valid: false, error: `index is only valid for operations 'read' and 'remove'.` };
  }

  if (operation === 'add') {
    if (!params.filename) {
      return { valid: false, error: "filename is required for operation 'add'." };
    }
    const sources = [params.base64, params.filePath].filter(v => v !== undefined && v !== '');
    if (sources.length !== 1) {
      return { valid: false, error: "operation 'add' requires exactly one of base64 or filePath." };
    }
  } else {
    if (params.filename !== undefined) return { valid: false, error: "filename is only valid for operation 'add'." };
    if (params.base64 !== undefined) return { valid: false, error: "base64 is only valid for operation 'add'." };
    if (params.filePath !== undefined) return { valid: false, error: "filePath is only valid for operation 'add'." };
  }

  if (params.savePath !== undefined) {
    if (operation !== 'read') {
      return { valid: false, error: "savePath is only valid for operation 'read'." };
    }
    if (!isAbsolute(params.savePath)) {
      return { valid: false, error: `savePath must be an absolute path (got "${params.savePath}").` };
    }
  }

  return { valid: true };
}

/** Decoded byte length of a base64 string, without allocating the buffer. */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/\s/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/**
 * Turn an `add` request into the base64 payload the script needs, reading from
 * disk when filePath was used. Returns an error string rather than throwing so
 * every failure path renders the same way.
 */
export function resolveAddPayload(params: ManageAttachmentsParams): { base64?: string; byteSize?: number; error?: string } {
  if (params.base64 !== undefined) {
    const clean = params.base64.replace(/\s/g, '');
    if (!BASE64_RE.test(clean)) {
      return { error: 'base64 is not valid base64 (expected only A-Z, a-z, 0-9, +, / and trailing =).' };
    }
    const byteSize = base64ByteLength(clean);
    if (byteSize > MAX_ATTACHMENT_BYTES) {
      return { error: `Attachment is ${byteSize} bytes, over the ${MAX_ATTACHMENT_BYTES} byte limit.` };
    }
    return { base64: clean, byteSize };
  }

  const filePath = params.filePath as string;
  if (!isAbsolute(filePath)) {
    return { error: `filePath must be an absolute path (got "${filePath}").` };
  }
  if (!existsSync(filePath)) {
    return { error: `No file at ${filePath}.` };
  }
  let stats;
  try {
    stats = statSync(filePath);
  } catch (err) {
    return { error: `Could not stat ${filePath}: ${(err as Error).message}` };
  }
  if (!stats.isFile()) {
    return { error: `${filePath} is not a regular file.` };
  }
  if (stats.size > MAX_ATTACHMENT_BYTES) {
    return { error: `${filePath} is ${stats.size} bytes, over the ${MAX_ATTACHMENT_BYTES} byte limit.` };
  }
  try {
    const buffer = readFileSync(filePath);
    return { base64: buffer.toString('base64'), byteSize: buffer.length };
  } catch (err) {
    return { error: `Could not read ${filePath}: ${(err as Error).message}` };
  }
}

/**
 * Write a decoded attachment to disk. Refuses to overwrite: silently replacing
 * a file the user already has is not recoverable through this tool.
 */
export function saveDecodedAttachment(savePath: string, base64: string): { path?: string; byteSize?: number; error?: string } {
  if (!isAbsolute(savePath)) {
    return { error: `savePath must be an absolute path (got "${savePath}").` };
  }
  const parent = dirname(savePath);
  if (!existsSync(parent)) {
    return { error: `Directory does not exist: ${parent}. Create it first or choose another savePath.` };
  }
  if (existsSync(savePath)) {
    return { error: `A file already exists at ${savePath}. Choose a different savePath (this tool never overwrites).` };
  }
  try {
    const buffer = Buffer.from(base64, 'base64');
    writeFileSync(savePath, buffer);
    return { path: savePath, byteSize: buffer.length };
  } catch (err) {
    return { error: `Could not write ${savePath}: ${(err as Error).message}` };
  }
}

type OmniJsRunner = typeof runOmniJs;

export async function manageAttachments(
  params: ManageAttachmentsParams,
  run: OmniJsRunner = runOmniJs
): Promise<ManageAttachmentsResult> {
  const validation = validateManageAttachmentsParams(params);
  if (!validation.valid) {
    return { success: false, operation: params.operation, error: validation.error };
  }

  const scriptArgs: Record<string, any> = {
    operation: params.operation,
    taskId: params.taskId,
    taskName: params.taskName,
    projectId: params.projectId,
    projectName: params.projectName,
    index: params.index,
    maxBytes: MAX_ATTACHMENT_BYTES,
    inlineLimitBytes: INLINE_BASE64_LIMIT_BYTES,
    savePathProvided: params.savePath !== undefined
  };

  if (params.operation === 'add') {
    const payload = resolveAddPayload(params);
    if (payload.error) {
      return { success: false, operation: params.operation, error: payload.error };
    }
    scriptArgs.filename = params.filename;
    scriptArgs.base64 = payload.base64;
  }

  const readOnly = params.operation === 'list' || params.operation === 'read';
  const result = await run(MANAGE_ATTACHMENTS_SCRIPT, scriptArgs, readOnly ? { readOnly: true } : undefined);

  if (!result || typeof result !== 'object') {
    return { success: false, operation: params.operation, error: 'OmniFocus returned no result.' };
  }
  if (result.success !== true) {
    return result as ManageAttachmentsResult;
  }

  if (params.operation === 'read') {
    const typed = result as ManageAttachmentsResult;

    if (params.savePath && typed.base64) {
      const saved = saveDecodedAttachment(params.savePath, typed.base64);
      if (saved.error) {
        return { ...typed, success: false, error: saved.error, base64: undefined };
      }
      return { ...typed, base64: undefined, savedPath: saved.path, byteSize: saved.byteSize ?? typed.byteSize };
    }

    if (typed.dataOmitted) {
      return {
        ...typed,
        success: false,
        error: `Attachment "${typed.filename}" is ${typed.byteSize} bytes — too large to return inline (limit ${INLINE_BASE64_LIMIT_BYTES} bytes). Call again with an absolute savePath to write it to disk.`
      };
    }
  }

  return result as ManageAttachmentsResult;
}
