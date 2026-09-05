import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { withProcessLock } from './processLock.js';

const lockModule = new URL('./processLock.ts', import.meta.url).href;
function child(source: string, dir: string) {
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    env: { ...process.env, OMNIFOCUS_MCP_STATE_DIR: dir }, stdio: ['ignore','pipe','pipe']
  });
}
test('separate client processes share two slots, and dead holders can be reclaimed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ofmcp-coordinator-'));
  const log = join(dir, 'events');
  const source = `import { withMacWideSlot } from ${JSON.stringify(lockModule)};
    import { appendFileSync } from 'node:fs';
    await withMacWideSlot(async () => { appendFileSync(${JSON.stringify(log)}, 'S\\n');
      await new Promise(r=>setTimeout(r,350)); appendFileSync(${JSON.stringify(log)}, 'E\\n'); });`;
  try {
    await Promise.all(Array.from({ length: 5 }, async () => {
      const proc = child(source, dir); let errors = '';
      proc.stderr.on('data', chunk => { errors += chunk; });
      const [code] = await once(proc, 'exit'); assert.equal(code, 0, errors);
    }));
    let active = 0, peak = 0;
    for (const event of readFileSync(log, 'utf8').trim().split('\n')) { active += event === 'S' ? 1 : -1; peak = Math.max(peak, active); }
    assert.equal(peak, 2); assert.equal(active, 0);
    const proc = child(`import { withProcessLock } from ${JSON.stringify(lockModule)};
      setInterval(()=>{},1000); await withProcessLock(['dead-holder'], async()=>{process.stdout.write('ready'); await new Promise(()=>{});}); setInterval(()=>{},1000);`, dir);
    // Keep the holder alive inside the pending callback; a promise alone does not
    // hold Node's event loop open.
    await once(proc.stdout, 'data');
    const exit = once(proc, 'exit'); proc.kill('SIGKILL'); await exit;
    const old = process.env.OMNIFOCUS_MCP_STATE_DIR; process.env.OMNIFOCUS_MCP_STATE_DIR = dir;
    try { assert.equal(await withProcessLock(['dead-holder'], async () => 'recovered', 1000), 'recovered'); }
    finally { if (old === undefined) delete process.env.OMNIFOCUS_MCP_STATE_DIR; else process.env.OMNIFOCUS_MCP_STATE_DIR = old; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
