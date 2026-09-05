import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDirectory, withProcessLock } from './processLock.js';

export const IDEMPOTENT_CREATE_TOOLS = new Set(['add_omnifocus_task', 'add_project', 'batch_add_items', 'create_folder', 'create_tag', 'duplicate_task', 'add_notification']);
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function durableWrite(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}
/** Keys do not expire automatically: expiry could recreate an earlier successful write.
 * A pending record means the outcome is uncertain; recovery must inspect OmniFocus. */
export async function withIdempotency(tool: string, key: string, args: any, run: () => Promise<any>): Promise<any> {
  if (args.dryRun === true) throw new Error('Omit idempotencyKey for a dry run; reserve it for the actual create.');
  const id = hash(`${tool}\0${key}`);
  const fingerprint = hash(JSON.stringify(canonical(args)));
  const dir = join(stateDirectory(), 'requests');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.json`);
  return withProcessLock([`request-${id}`], async () => {
    let record;
    try { record = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error: any) { if (error.code !== 'ENOENT') throw new Error(`Cannot read idempotency record ${id}; no write attempted.`); }
    if (record) {
      if (record.fingerprint !== fingerprint) throw new Error('This idempotencyKey was already used with different arguments.');
      if (record.status !== 'complete') throw new Error(`An earlier request with this idempotencyKey has an uncertain outcome (record ${id}). Inspect OmniFocus before taking any recovery action; the create was not repeated.`);
      return { ...record.result, structuredContent: { ...record.result.structuredContent, meta: { ...record.result.structuredContent?.meta, idempotency: { replayed: true, recordId: id } } } };
    }
    durableWrite(path, { status: 'pending', tool, fingerprint, startedAt: new Date().toISOString() });
    const result = await run();
    const completed = { ...result, structuredContent: { ...result.structuredContent, meta: { ...result.structuredContent?.meta, idempotency: { replayed: false, recordId: id } } } };
    durableWrite(path, { status: 'complete', tool, fingerprint, result: completed, completedAt: new Date().toISOString() });
    return completed;
  });
}
