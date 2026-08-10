import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  escapeForJxaTemplate,
  parseScriptOutput,
  injectScriptParameters,
  runOmniJs,
  executeOmniFocusScript,
} from './scriptExecution.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// The escaped script is embedded in a JXA template literal, so evaluating it as
// one is the real round-trip check: whatever comes back out must be byte-for-byte
// what went in. No osascript involved.
function evaluateAsTemplateLiteral(escaped: string): string {
  return new Function(`return \`${escaped}\`;`)() as string;
}

test('escapeForJxaTemplate: backslashes, backticks and dollars survive the round-trip', () => {
  const cases = [
    'plain script text',
    'const re = /\\d+/;',
    'const path = "C:\\\\Users\\\\test";',
    'const s = `already a template`;',
    'const s = `${injectedArgs.tagName}`;',
    'const cost = "$100 and $$ and ${notAnInterpolation}";',
    'mixed \\ ` $ \\` \\$ ${} all at once',
    'trailing backslash \\',
  ];

  for (const input of cases) {
    assert.equal(evaluateAsTemplateLiteral(escapeForJxaTemplate(input)), input, `round-trip failed for: ${input}`);
  }
});

test('escapeForJxaTemplate: produces the expected literal escapes', () => {
  assert.equal(escapeForJxaTemplate('a\\b'), 'a\\\\b');
  assert.equal(escapeForJxaTemplate('a`b'), 'a\\`b');
  assert.equal(escapeForJxaTemplate('a$b'), 'a\\$b');
  assert.equal(escapeForJxaTemplate('${x}'), '\\${x}');
});

test('escapeForJxaTemplate: leaves script with no special characters untouched', () => {
  const clean = 'return JSON.stringify({success:true});';
  assert.equal(escapeForJxaTemplate(clean), clean);
});

test('injectScriptParameters: replacement is literal, not a substitution pattern', () => {
  // `$'`, `$&`, `` $` `` and `$$` are String.replace substitution patterns. If the
  // replacement were a string, these would splice surrounding script content in.
  const scriptContent = `// header
(() => {
  return JSON.stringify({success:true});
})();`;
  const args = { tagName: "spooky $' and $& and $\` and $$ value" };

  const result = injectScriptParameters(scriptContent, args);

  assert.ok(result.includes(JSON.stringify(args)), 'injected JSON was mangled by substitution patterns');
  assert.ok(result.includes("spooky $' and $& and $` and $$ value"), 'user string did not survive verbatim');
  assert.ok(result.includes('const injectedArgs = '), 'parameter block missing');
  assert.ok(result.includes('return JSON.stringify({success:true});'), 'original script body lost');
  assert.ok(!result.includes('// header// header'), 'replacement spliced content back into itself');
});

test('injectScriptParameters: injects after the IIFE opener and keeps the block', () => {
  const scriptContent = '(() => {\n  return 1;\n})();';
  const result = injectScriptParameters(scriptContent, { limit: 5 });

  assert.match(result, /^\(\(\) => \{/);
  assert.ok(result.includes('const injectedArgs = {"limit":5};'));
  assert.ok(result.includes('const limit = injectedArgs.limit || 100;'));
  assert.ok(result.indexOf('const injectedArgs') < result.indexOf('return 1;'));
});

test('injectScriptParameters: no args leaves the script untouched', () => {
  const scriptContent = '(() => { return 1; })();';
  assert.equal(injectScriptParameters(scriptContent, undefined), scriptContent);
  assert.equal(injectScriptParameters(scriptContent, {}), scriptContent);
});

test('parseScriptOutput: valid JSON parses through unchanged', () => {
  assert.deepEqual(parseScriptOutput('{"success":true,"tasks":[]}'), { success: true, tasks: [] });
  assert.deepEqual(parseScriptOutput('  {"success":false,"error":"nope"}\n'), { success: false, error: 'nope' });
});

test('parseScriptOutput: unparseable output becomes a structured error', () => {
  const result = parseScriptOutput('OmniFocus got an error: Application isn\'t running.\n');

  assert.equal(result.success, false);
  // The raw head is folded into the message so every caller rendering .error
  // surfaces the diagnostic automatically.
  assert.match(result.error, /^OmniFocus returned unparseable output: OmniFocus got an error/);
  assert.equal(result.raw, "OmniFocus got an error: Application isn't running.");
});

test('parseScriptOutput: empty output still yields the structured error shape', () => {
  const result = parseScriptOutput('');

  assert.equal(result.success, false);
  assert.equal(result.error, 'OmniFocus returned empty output');
  assert.equal(result.raw, '');
});

test('parseScriptOutput: raw output is capped', () => {
  const result = parseScriptOutput('x'.repeat(10000));

  assert.equal(result.success, false);
  assert.ok(result.raw.length < 2100, `raw was ${result.raw.length} chars`);
  assert.ok(result.raw.startsWith('x'.repeat(2000)));
  assert.ok(result.raw.endsWith('[truncated]'));
});

// ---------------------------------------------------------------------------
// Source-level guards
// ---------------------------------------------------------------------------

function readSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'scriptExecution.ts'), 'utf8');
}

test('legacy hardcoded-perspective regex patches are gone from the source', () => {
  const src = readSource();

  // No live script in omnifocusScripts/ declares these, so the eight rewrite
  // patches were dead weight rewriting script bodies at runtime.
  assert.doesNotMatch(src, /let perspectiveName = /, 'legacy perspectiveName patch still present');
  assert.doesNotMatch(src, /let hideCompleted = true;/, 'legacy hideCompleted patch still present');
  assert.doesNotMatch(src, /let limit = 100;/, 'legacy limit patch still present');
  assert.doesNotMatch(src, /let includeBuiltIn = false;/, 'legacy includeBuiltIn patch still present');
  assert.doesNotMatch(src, /let includeSidebar = true;/, 'legacy includeSidebar patch still present');
  assert.doesNotMatch(src, /今日工作安排/, 'legacy hardcoded test perspective still present');
  // ...but the parameter block itself must stay.
  assert.match(src, /const injectedArgs = /, 'parameterInjection block was removed');
});

test('osascript runs from exactly one spawn call site, with no temp-file machinery', () => {
  const src = readSource();

  assert.equal((src.match(/execAsync\(/g) || []).length, 0, 'exec-based execution should be gone');
  assert.equal((src.match(/\bspawn\(/g) || []).length, 1, 'osascript should be launched through a single wrapper');
  assert.match(src, /'-l', 'JavaScript'/, 'osascript must still run in JavaScript mode');
  assert.match(src, /child\.stdin\.end\(jxaScript\)/, 'the script must be piped through stdin');

  assert.doesNotMatch(src, /writeFileSync/, 'temp-file writing still present');
  assert.doesNotMatch(src, /unlinkSync/, 'temp-file cleanup still present');
  assert.doesNotMatch(src, /createTempScriptPath/, 'temp script path helper still present');

  // The limits the exec options used to carry must survive as explicit defaults.
  assert.match(src, /const DEFAULT_OSASCRIPT_TIMEOUT_MS = 120_000;/, '120s default timeout lost');
  assert.match(src, /const OSASCRIPT_MAX_BUFFER = 50 \* 1024 \* 1024;/, '50MB default output cap lost');
  assert.match(src, /const DEFAULT_MAX_CONCURRENT = 2;/, 'default concurrency lost');

  assert.doesNotMatch(src, /export async function executeAppleScript/, 'dead executeAppleScript still exported');
  assert.doesNotMatch(src, /export async function executeJXA/, 'dead executeJXA still exported');
});

// ---------------------------------------------------------------------------
// Real-spawn tests against a fake osascript
// ---------------------------------------------------------------------------

/** A fresh scratch dir per case; nothing is shared or reset between tests. */
function makeFakeDir(): string {
  return mkdtempSync(join(tmpdir(), 'ofmcp-scriptexec-'));
}

/**
 * Write an executable stand-in for osascript. The seam that makes this usable
 * is OMNIFOCUS_OSASCRIPT_BIN — always set it, so no test can ever reach the
 * real osascript (and therefore the real OmniFocus).
 */
function writeFakeOsascript(dir: string, body: string): string {
  const path = join(dir, 'osascript');
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('spawn path: the JXA wrapper reaches osascript over stdin and stdout round-trips', async () => {
  const dir = makeFakeDir();
  const capture = join(dir, 'stdin.txt');
  const bin = writeFakeOsascript(dir, `#!/bin/sh
payload=$(cat)
printf '%s' "$payload" > "$FAKE_CAPTURE"
case "$payload" in
  *MARKER_ROUNDTRIP*) printf '{"success":true,"sawMarker":true}' ;;
  *) printf '{"success":false,"sawMarker":false}' ;;
esac
`);

  await withEnv({ OMNIFOCUS_OSASCRIPT_BIN: bin, FAKE_CAPTURE: capture }, async () => {
    const result = await runOmniJs('return JSON.stringify({ok:true});', { marker: 'MARKER_ROUNDTRIP' });

    assert.deepEqual(result, { success: true, sawMarker: true });

    const piped = readFileSync(capture, 'utf8');
    assert.match(piped, /function run\(\)/, 'JXA wrapper did not reach the child');
    assert.match(piped, /evaluateJavascript/, 'OmniJS evaluation call missing from the piped script');
    assert.match(piped, /MARKER_ROUNDTRIP/, 'injected args missing from the piped script');
  });
});

test('spawn path: a hung osascript is killed and reported with the friendly timeout message', async () => {
  const dir = makeFakeDir();
  const bin = writeFakeOsascript(dir, `#!/bin/sh
cat > /dev/null
exec sleep 5
`);

  await withEnv({ OMNIFOCUS_OSASCRIPT_BIN: bin, OMNIFOCUS_SCRIPT_TIMEOUT_MS: '300' }, async () => {
    await assert.rejects(
      runOmniJs('return 1;'),
      (error: Error) => {
        assert.match(error.message, /^OmniFocus did not respond within 0\.3s\./);
        assert.match(error.message, /modal dialog or an automation permission prompt/);
        assert.match(error.message, /Switch to OmniFocus/);
        return true;
      }
    );
  });
});

test('spawn path: output past the cap kills the child and reports the friendly size message', async () => {
  const dir = makeFakeDir();
  const bin = writeFakeOsascript(dir, `#!/bin/sh
cat > /dev/null
yes xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx | head -c 4000000
printf '{"success":true}'
`);

  await withEnv(
    { OMNIFOCUS_OSASCRIPT_BIN: bin, OMNIFOCUS_SCRIPT_MAX_OUTPUT_BYTES: String(1024 * 1024) },
    async () => {
      await assert.rejects(
        runOmniJs('return 1;'),
        (error: Error) => {
          assert.match(error.message, /^OmniFocus returned more than 1MB of output\./);
          assert.match(error.message, /Narrow the request with a limit or filter/);
          return true;
        }
      );
    }
  );
});

/**
 * Records `S <id>` when it starts and `E <id>` when it finishes, so the parent
 * can reconstruct how many osascript processes were alive at once and in what
 * order the semaphore handed out slots. `>>` appends are atomic for writes this
 * small, so the file order is real time order.
 */
const CONCURRENCY_PROBE_FAKE = `#!/bin/sh
payload=$(cat)
id=$(printf '%s' "$payload" | grep -o 'CID_[0-9]*' | head -1 | cut -d_ -f2)
printf 'S %s\\n' "$id" >> "$FAKE_LOG"
sleep "$FAKE_SLEEP"
printf 'E %s\\n' "$id" >> "$FAKE_LOG"
printf '{"success":true,"id":%s}' "$id"
`;

/**
 * The very first exec of a freshly written binary is serialized by macOS
 * (Gatekeeper scans it), which collapses hundreds of ms of launch stagger into
 * a single instant and makes the timeline unreadable. Burn one run first.
 */
async function warmUpFake(bin: string, dir: string): Promise<void> {
  await withEnv(
    { OMNIFOCUS_OSASCRIPT_BIN: bin, FAKE_LOG: join(dir, 'warmup.log'), FAKE_SLEEP: '0' },
    async () => { await runOmniJs('return 1;', { marker: 'CID_9' }); }
  );
}

function readConcurrencyLog(log: string): { peak: number; started: string[]; ended: string[] } {
  const events = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);

  let inFlight = 0;
  let peak = 0;
  const started: string[] = [];
  const ended: string[] = [];
  for (const event of events) {
    const [kind, id] = event.split(' ');
    if (kind === 'S') {
      inFlight++;
      peak = Math.max(peak, inFlight);
      started.push(id);
    } else {
      inFlight--;
      ended.push(id);
    }
  }
  return { peak, started, ended };
}

test('semaphore: at most two osascript processes run at once, released FIFO', async () => {
  const dir = makeFakeDir();
  const log = join(dir, 'concurrency.log');
  const bin = writeFakeOsascript(dir, CONCURRENCY_PROBE_FAKE);
  await warmUpFake(bin, dir);

  await withEnv(
    { OMNIFOCUS_OSASCRIPT_BIN: bin, FAKE_LOG: log, FAKE_SLEEP: '0.6', OMNIFOCUS_MCP_MAX_CONCURRENT: undefined },
    async () => {
      // Staggered launches so the queue order is unambiguous; every call is
      // still in flight (each fake run takes ~600ms) when the next one starts.
      // The stagger stays comfortably above process-spawn jitter.
      const pending: Promise<any>[] = [];
      for (let i = 0; i < 4; i++) {
        pending.push(runOmniJs('return 1;', { marker: `CID_${i}` }));
        await sleep(150);
      }
      const results = await Promise.all(pending);
      assert.deepEqual(results.map(r => r.id), [0, 1, 2, 3]);

      const { peak, started, ended } = readConcurrencyLog(log);
      assert.equal(started.length, 4, `expected 4 starts, got: ${started}`);
      assert.equal(ended.length, 4, `expected 4 ends, got: ${ended}`);
      assert.equal(peak, 2, `peak concurrency was ${peak}, expected the default cap of 2`);

      // Calls 0 and 1 hold the two slots from the start; which of the two racing
      // children logs first is process-spawn noise, so only the set is asserted.
      assert.deepEqual([...started.slice(0, 2)].sort(), ['0', '1'], `first pair did not run immediately: ${started}`);
      assert.deepEqual([...ended.slice(0, 2)].sort(), ['0', '1'], `first pair did not finish first: ${ended}`);

      // Calls 2 and 3 waited on the semaphore — that queue is strictly FIFO, so
      // 2 must be handed the first freed slot and 3 the second.
      assert.equal(started[2], '2', `queue released out of order: ${started}`);
      assert.equal(started[3], '3', `queue released out of order: ${started}`);
      assert.equal(ended[2], '2', `queued calls completed out of order: ${ended}`);
      assert.equal(ended[3], '3', `queued calls completed out of order: ${ended}`);
    }
  );
});

test('semaphore: OMNIFOCUS_MCP_MAX_CONCURRENT is honoured and clamped up to 1', async () => {
  const dir = makeFakeDir();
  const log = join(dir, 'concurrency.log');
  const bin = writeFakeOsascript(dir, CONCURRENCY_PROBE_FAKE);
  await warmUpFake(bin, dir);

  // 0 is below the floor: it must mean "one at a time", never "no slots" (a
  // deadlock) and never a silent fall back to the default of 2.
  await withEnv(
    { OMNIFOCUS_OSASCRIPT_BIN: bin, FAKE_LOG: log, FAKE_SLEEP: '0.4', OMNIFOCUS_MCP_MAX_CONCURRENT: '0' },
    async () => {
      const results = await Promise.all([
        runOmniJs('return 1;', { marker: 'CID_0' }),
        runOmniJs('return 1;', { marker: 'CID_1' }),
      ]);
      assert.deepEqual(results.map(r => r.id), [0, 1]);

      const { peak, started, ended } = readConcurrencyLog(log);
      assert.equal(peak, 1, `peak concurrency was ${peak}, expected the clamped cap of 1`);
      assert.deepEqual(started, ['0', '1'], `runs did not start in arrival order: ${started}`);
      assert.deepEqual(ended, ['0', '1'], `runs did not complete in arrival order: ${ended}`);
    }
  );
});

/** Fails the first invocation with an Apple Event timeout, then succeeds. */
const FAIL_ONCE_WITH_1712 = `#!/bin/sh
cat > /dev/null
printf 'x' >> "$FAKE_COUNT"
if [ -f "$FAKE_STATE" ]; then
  printf '{"success":true,"attempt":"second"}'
else
  : > "$FAKE_STATE"
  printf 'osascript: execution error: OmniFocus got an error: AppleEvent timed out. (-1712)\\n' >&2
  exit 1
fi
`;

test('readOnly retry: an Apple Event timeout (-1712) is retried once and succeeds', async () => {
  const dir = makeFakeDir();
  const bin = writeFakeOsascript(dir, FAIL_ONCE_WITH_1712);

  await withEnv(
    { OMNIFOCUS_OSASCRIPT_BIN: bin, FAKE_STATE: join(dir, 'state'), FAKE_COUNT: join(dir, 'count') },
    async () => {
      const result = await runOmniJs('return 1;', undefined, { readOnly: true });

      assert.deepEqual(result, { success: true, attempt: 'second' });
      assert.equal(readFileSync(join(dir, 'count'), 'utf8').length, 2, 'expected exactly one retry');
    }
  );
});

test('readOnly retry: a mutating script is never retried after -1712', async () => {
  const dir = makeFakeDir();
  const bin = writeFakeOsascript(dir, FAIL_ONCE_WITH_1712);

  await withEnv(
    { OMNIFOCUS_OSASCRIPT_BIN: bin, FAKE_STATE: join(dir, 'state'), FAKE_COUNT: join(dir, 'count') },
    async () => {
      await assert.rejects(runOmniJs('return 1;'), /-1712/);
      assert.equal(readFileSync(join(dir, 'count'), 'utf8').length, 1, 'a write must never be re-run');
    }
  );

  // Same guarantee when the caller explicitly says the script mutates.
  const dir2 = makeFakeDir();
  const bin2 = writeFakeOsascript(dir2, FAIL_ONCE_WITH_1712);
  await withEnv(
    { OMNIFOCUS_OSASCRIPT_BIN: bin2, FAKE_STATE: join(dir2, 'state'), FAKE_COUNT: join(dir2, 'count') },
    async () => {
      await assert.rejects(runOmniJs('return 1;', undefined, { readOnly: false }), /-1712/);
      assert.equal(readFileSync(join(dir2, 'count'), 'utf8').length, 1, 'a write must never be re-run');
    }
  );
});

test('readOnly retry works through executeOmniFocusScript too (options are passed through)', async () => {
  const dir = makeFakeDir();
  const bin = writeFakeOsascript(dir, FAIL_ONCE_WITH_1712);
  const scriptPath = join(dir, 'packaged.js');
  writeFileSync(scriptPath, '(() => {\n  return JSON.stringify({success:true});\n})();\n');

  await withEnv(
    { OMNIFOCUS_OSASCRIPT_BIN: bin, FAKE_STATE: join(dir, 'state'), FAKE_COUNT: join(dir, 'count') },
    async () => {
      const result = await executeOmniFocusScript(scriptPath, { limit: 3 }, { readOnly: true });

      assert.deepEqual(result, { success: true, attempt: 'second' });
      assert.equal(readFileSync(join(dir, 'count'), 'utf8').length, 2, 'expected exactly one retry');
    }
  );
});

test('TCC: a -1743 denial explains the Automation permission fix', async () => {
  const dir = makeFakeDir();
  const bin = writeFakeOsascript(dir, `#!/bin/sh
cat > /dev/null
printf 'osascript: execution error: Not authorized to send Apple events to OmniFocus. (-1743)\\n' >&2
exit 1
`);

  await withEnv({ OMNIFOCUS_OSASCRIPT_BIN: bin }, async () => {
    await assert.rejects(
      runOmniJs('return 1;'),
      (error: Error) => {
        assert.match(error.message, /macOS blocked automation of OmniFocus/);
        assert.match(error.message, /-1743/);
        assert.match(error.message, /System Settings → Privacy & Security → Automation/);
        assert.match(error.message, /OmniFocus switch/);
        return true;
      }
    );
  });
});

test('TCC: a bare "not allowed" denial also maps to the Automation message', async () => {
  const dir = makeFakeDir();
  const bin = writeFakeOsascript(dir, `#!/bin/sh
cat > /dev/null
printf 'osascript: execution error: Application is not allowed to send Apple events.\\n' >&2
exit 1
`);

  await withEnv({ OMNIFOCUS_OSASCRIPT_BIN: bin }, async () => {
    await assert.rejects(runOmniJs('return 1;'), /System Settings → Privacy & Security → Automation/);
  });
});

test('TCC: a -600 failure says OmniFocus is not running', async () => {
  const dir = makeFakeDir();
  const bin = writeFakeOsascript(dir, `#!/bin/sh
cat > /dev/null
printf "osascript: execution error: OmniFocus got an error: Application isn't running. (-600)\\n" >&2
exit 1
`);

  await withEnv({ OMNIFOCUS_OSASCRIPT_BIN: bin }, async () => {
    await assert.rejects(
      runOmniJs('return 1;'),
      (error: Error) => {
        assert.equal(error.message, 'OmniFocus is not running. Open OmniFocus and retry.');
        return true;
      }
    );
  });
});
