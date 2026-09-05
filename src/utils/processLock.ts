import { mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export function stateDirectory(): string {
  const path = process.env.OMNIFOCUS_MCP_STATE_DIR || join(homedir(), '.omnifocus-mcp');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error.code !== 'ESRCH'; }
}

export interface Lease { release(): void; trackChild(pid: number): void }

/** Atomic rename of an already populated directory leaves no ownerless acquisition gap.
 * Recovery removes only the uniquely named dead owner's file. A racing reaper cannot
 * remove a replacement owner's file or its nonempty directory. Live PIDs never expire. */
export function tryLock(name: string): Lease | undefined {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid lock name');
  const base = join(stateDirectory(), 'locks');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const lock = join(base, name);
  const token = `${process.pid}-${randomUUID()}`;
  const candidate = join(base, `candidate-${token}`);
  mkdirSync(candidate, { mode: 0o700 });
  writeFileSync(join(candidate, token), '{}', { mode: 0o600 });
  const discard = () => { unlinkSync(join(candidate, token)); rmdirSync(candidate); };
  try {
    // A dead holder can be reclaimed without time-based theft of a slow live call.
    try {
      for (const owner of readdirSync(lock)) {
        if (!/^\d+-[a-f0-9-]+$/.test(owner)) continue;
        if (alive(Number(owner.split('-')[0]))) continue;
        let child: number | undefined;
        try { child = JSON.parse(readFileSync(join(lock, owner), 'utf8')).child; } catch { continue; }
        if (child && alive(child)) continue;
        try { unlinkSync(join(lock, owner)); rmdirSync(lock); } catch { /* raced with recovery */ }
      }
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    try { renameSync(candidate, lock); }
    catch (error: any) {
      if (['EEXIST', 'ENOTEMPTY', 'ENOENT'].includes(error.code)) { discard(); return undefined; }
      throw error;
    }
  } catch (error) { try { discard(); } catch {} throw error; }
  let released = false;
  return {
    trackChild(pid) { if (!released) writeFileSync(join(lock, token), JSON.stringify({ child: pid }), { mode: 0o600 }); },
    release() {
      if (released) return;
      released = true;
      try { unlinkSync(join(lock, token)); rmdirSync(lock); } catch (error: any) {
        if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
      }
    }
  };
}

export async function withProcessLock<T>(names: string[], run: (lease: Lease) => Promise<T>, timeoutMs = 120_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const name of names) {
      const lease = tryLock(name);
      if (lease) { try { return await run(lease); } finally { lease.release(); } }
    }
    if (Date.now() >= deadline) throw new Error('Timed out waiting for another OmniFocus client. No script was started; retry when the other call finishes.');
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
}

/** Two shared slots across all MCP/CLI processes for this macOS user. */
export function withMacWideSlot<T>(run: (lease: Lease) => Promise<T>): Promise<T> {
  return withProcessLock(['script-0', 'script-1'], run);
}
