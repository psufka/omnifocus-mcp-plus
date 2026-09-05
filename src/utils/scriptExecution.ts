import { withMacWideSlot, type Lease } from './processLock.js';
import { recordToolData } from './toolResult.js';
import { expandScriptHelpers } from './taskQueryHelpers.js';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_OSASCRIPT_TIMEOUT_MS = 120_000;
const OSASCRIPT_MAX_BUFFER = 50 * 1024 * 1024;
const RAW_OUTPUT_LIMIT = 2000;

/**
 * OmniFocus serializes every Apple Event on a single thread, so more than a
 * couple of simultaneous osascript processes just queue up inside the app and
 * push each other toward the Apple Event timeout. Two in flight keeps the pipe
 * busy without inviting contention.
 */
const DEFAULT_MAX_CONCURRENT = 2;
const MIN_MAX_CONCURRENT = 1;
const MAX_MAX_CONCURRENT = 8;

/** Apple Event contention clears fast; one short backoff is enough. */
const READ_ONLY_RETRY_DELAY_MS = 500;

/** Grace period between SIGTERM and SIGKILL for a child that ignores SIGTERM. */
const KILL_ESCALATION_MS = 2_000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Total wall-clock budget for one osascript run. */
function osascriptTimeoutMs(): number {
  return readPositiveIntEnv('OMNIFOCUS_SCRIPT_TIMEOUT_MS', DEFAULT_OSASCRIPT_TIMEOUT_MS);
}

/** Hard cap on accumulated stdout; the child is killed once it is passed. */
function osascriptMaxOutputBytes(): number {
  return readPositiveIntEnv('OMNIFOCUS_SCRIPT_MAX_OUTPUT_BYTES', OSASCRIPT_MAX_BUFFER);
}

/**
 * Concurrent osascript processes allowed. An out-of-range number is clamped
 * into 1–8 rather than ignored — `0` means "one at a time", not "fall back to
 * the default"; only an unparseable value reverts to the default.
 */
function maxConcurrentScripts(): number {
  const raw = process.env.OMNIFOCUS_MCP_MAX_CONCURRENT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_CONCURRENT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_CONCURRENT;
  return Math.min(MAX_MAX_CONCURRENT, Math.max(MIN_MAX_CONCURRENT, parsed));
}

/**
 * The binary to run. Overridable so tests can point at a fake osascript without
 * mutating PATH-dependent behaviour; production always resolves plain
 * `osascript` from PATH.
 */
function osascriptBinary(): string {
  const override = process.env.OMNIFOCUS_OSASCRIPT_BIN;
  return override && override.trim() !== '' ? override : 'osascript';
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(2);
}

function formatSeconds(ms: number): string {
  return String(ms / 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms); });
}

/**
 * Escape a script so it can be embedded inside a JXA template literal.
 * Backslashes, backticks and `$` would otherwise terminate the literal or
 * start an interpolation.
 */
export function escapeForJxaTemplate(source: string): string {
  return source.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

/**
 * Parse osascript output as JSON, falling back to a structured error so callers
 * reading `.success` / `.error` never see `undefined`.
 */
export function parseScriptOutput(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    const raw = stdout.trim();
    return {
      success: false,
      // Include a head of the raw output in the message itself so every
      // caller that renders `.error` surfaces the diagnostic automatically.
      error: raw
        ? `OmniFocus returned unparseable output: ${raw.slice(0, 300)}${raw.length > 300 ? '…' : ''}`
        : 'OmniFocus returned empty output',
      raw: raw.length > RAW_OUTPUT_LIMIT ? `${raw.slice(0, RAW_OUTPUT_LIMIT)}… [truncated]` : raw
    };
  }
}

// ---------------------------------------------------------------------------
// Concurrency gate
// ---------------------------------------------------------------------------

let activeScripts = 0;
const waiters: Array<() => void> = [];

/** FIFO ticket for one osascript process slot. */
function acquireSlot(): Promise<void> {
  if (activeScripts < maxConcurrentScripts()) {
    activeScripts++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => { waiters.push(resolve); });
}

function releaseSlot(): void {
  activeScripts--;
  // Drain in arrival order. The loop is synchronous, so no later caller can
  // jump the queue between the capacity check and the hand-off.
  while (activeScripts < maxConcurrentScripts() && waiters.length > 0) {
    const next = waiters.shift()!;
    activeScripts++;
    next();
  }
}

async function withScriptSlot<T>(run: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await run();
  } finally {
    releaseSlot();
  }
}

// ---------------------------------------------------------------------------
// osascript execution
// ---------------------------------------------------------------------------

interface OsascriptFailure extends Error {
  stderr?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  timeoutMs?: number;
  outputLimitExceeded?: boolean;
  outputLimitBytes?: number;
}

function makeFailure(message: string, fields: Partial<OsascriptFailure>): OsascriptFailure {
  const err = new Error(message) as OsascriptFailure;
  Object.assign(err, fields);
  return err;
}

/**
 * Run one osascript process, feeding the JXA source through stdin instead of a
 * temp file. Nothing user-controlled ever touches the filesystem or a shell
 * command line this way, and there is no temp file to leak on a hard kill.
 */
function executeOsascript(jxaScript: string, lease: Lease): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const timeoutMs = osascriptTimeoutMs();
    const maxOutputBytes = osascriptMaxOutputBytes();

    const child = spawn(osascriptBinary(), ['-l', 'JavaScript'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    if (child.pid) lease.trackChild(child.pid);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputLimitExceeded = false;

    const collected = (chunks: Buffer[]) => Buffer.concat(chunks).toString('utf8');

    // Kill, then stop listening: an orphaned grandchild can hold the pipe open
    // long after the parent has given up, and a live pipe keeps the event loop
    // (and this promise's caller) waiting for nothing.
    const terminate = () => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      const escalation = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, KILL_ESCALATION_MS);
      escalation.unref();
      try { child.stdin.destroy(); } catch { /* already closed */ }
      try { child.stdout.destroy(); } catch { /* already closed */ }
      try { child.stderr.destroy(); } catch { /* already closed */ }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      terminate();
      settle(() => reject(makeFailure(
        `osascript timed out after ${timeoutMs}ms`,
        { timedOut: true, timeoutMs, stderr: collected(stderrChunks) }
      )));
    }, timeoutMs);

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (outputLimitExceeded) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        outputLimitExceeded = true;
        terminate();
        settle(() => reject(makeFailure(
          `osascript produced more than ${maxOutputBytes} bytes of output`,
          { outputLimitExceeded: true, outputLimitBytes: maxOutputBytes, stderr: collected(stderrChunks) }
        )));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });

    // A child that dies before reading its input turns the stdin write into an
    // EPIPE; the real failure is reported by 'close'/'error' instead.
    child.stdin.on('error', () => { /* ignored */ });

    child.on('error', (error: NodeJS.ErrnoException) => {
      settle(() => reject(makeFailure(error.message, {
        stderr: collected(stderrChunks),
        exitCode: null
      })));
    });

    child.on('close', (code, signal) => {
      const stdout = collected(stdoutChunks);
      const stderr = collected(stderrChunks);
      if (code === 0) {
        settle(() => resolve({ stdout, stderr }));
        return;
      }
      const detail = stderr.trim() || stdout.trim();
      settle(() => reject(makeFailure(
        `osascript exited with ${signal ? `signal ${signal}` : `code ${code}`}${detail ? `: ${detail}` : ''}`,
        { stderr, exitCode: code, signal }
      )));
    });

    child.stdin.end(jxaScript);
  });
}

function failureStderr(error: unknown): string {
  const err = error as OsascriptFailure;
  const parts = [
    typeof err?.stderr === 'string' ? err.stderr : '',
    typeof err?.message === 'string' ? err.message : ''
  ];
  return parts.join('\n');
}

/**
 * Apple Event timeout (-1712). OmniFocus was busy — usually another client held
 * the single Apple Event thread. Safe to retry only for read-only scripts.
 */
function isAppleEventTimeout(error: unknown): boolean {
  const text = failureStderr(error);
  return text.includes('-1712') || /apple\s?event timed out/i.test(text);
}

/** macOS Automation (TCC) denial: -1743 / "not allowed" / "not authorized". */
function isAutomationPermissionError(text: string): boolean {
  return text.includes('-1743') || /not allowed/i.test(text) || /not authori[sz]ed/i.test(text);
}

/** OmniFocus is not launched: -600 / "isn't running". */
function isAppNotRunningError(text: string): boolean {
  return text.includes('-600') || /isn['’]t running/i.test(text) || /is not running/i.test(text);
}

/**
 * Turn an osascript failure into an actionable error. A hung osascript almost
 * always means OmniFocus is blocked on something waiting for a human; a denied
 * one means macOS never let the Apple Event through at all.
 */
function describeExecFailure(error: unknown): Error {
  const err = error as OsascriptFailure;

  if (err?.timedOut) {
    const seconds = formatSeconds(err.timeoutMs ?? DEFAULT_OSASCRIPT_TIMEOUT_MS);
    return new Error(
      `OmniFocus did not respond within ${seconds}s. ` +
      `The usual cause is a modal dialog or an automation permission prompt waiting for input in OmniFocus. ` +
      `Switch to OmniFocus, dismiss any open dialog or grant the prompt, then retry.`
    );
  }

  if (err?.outputLimitExceeded) {
    const megabytes = formatMegabytes(err.outputLimitBytes ?? OSASCRIPT_MAX_BUFFER);
    return new Error(
      `OmniFocus returned more than ${megabytes}MB of output. ` +
      `Narrow the request with a limit or filter, then retry.`
    );
  }

  const text = failureStderr(error);

  if (isAutomationPermissionError(text)) {
    return new Error(
      `macOS blocked automation of OmniFocus (Apple Event error -1743: not authorized). ` +
      `Fix: open System Settings → Privacy & Security → Automation, find the app running this MCP server ` +
      `(Claude Desktop, Claude Code, Terminal, …), and turn on the OmniFocus switch beneath it. ` +
      `Restart that app, then retry.`
    );
  }

  if (isAppNotRunningError(text)) {
    return new Error('OmniFocus is not running. Open OmniFocus and retry.');
  }

  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Gated osascript run: one concurrency slot per process, plus a single retry
 * for read-only scripts that lost an Apple Event race. A mutating script is
 * NEVER retried — a write that timed out may have partially applied.
 */
async function executeChecked(jxaScript: string): Promise<{ stdout: string; stderr: string }> {
  return withScriptSlot(() => withMacWideSlot(async lease => {
    try {
      const result = await executeOsascript(jxaScript, lease);
      const parsed = parseScriptOutput(result.stdout);
      if (parsed?.__omnifocusTransportError === true) {
        throw makeFailure(`Apple Event error ${parsed.code ?? 'unknown'}: ${parsed.error}`, {});
      }
      return result;
    } catch (error) {
      // Retain the shared slot until the forced-kill grace period has elapsed.
      if ((error as OsascriptFailure)?.timedOut || (error as OsascriptFailure)?.outputLimitExceeded) await delay(KILL_ESCALATION_MS + 100);
      throw error;
    }
  }));
}

async function runOsascript(
  jxaScript: string,
  options?: ScriptExecutionOptions
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await executeChecked(jxaScript);
  } catch (error) {
    if (options?.readOnly && isAppleEventTimeout(error)) {
      await delay(READ_ONLY_RETRY_DELAY_MS);
      try {
        return await executeChecked(jxaScript);
      } catch (retryError) {
        throw describeExecFailure(retryError);
      }
    }
    throw describeExecFailure(error);
  }
}

/**
 * Inject caller arguments into an OmniJS script file's top-level IIFE.
 * The replacement is a function so `$&`/`$'`-style sequences inside the JSON
 * payload are never treated as substitution patterns.
 */
export function injectScriptParameters(scriptContent: string, args: any): string {
  scriptContent = expandScriptHelpers(scriptContent);
  if (!args || Object.keys(args).length === 0) {
    return scriptContent;
  }

  const argsJson = JSON.stringify(args);
  const parameterInjection = `
    // Injected parameters
    const injectedArgs = ${argsJson};
    const perspectiveName = injectedArgs.perspectiveName || null;
    const perspectiveId = injectedArgs.perspectiveId || null;
    const hideCompleted = injectedArgs.hideCompleted !== undefined ? injectedArgs.hideCompleted : true;
    const limit = injectedArgs.limit || 100;
    const includeBuiltIn = injectedArgs.includeBuiltIn !== undefined ? injectedArgs.includeBuiltIn : false;
    const includeSidebar = injectedArgs.includeSidebar !== undefined ? injectedArgs.includeSidebar : true;
    const format = injectedArgs.format || "detailed";
    const tagName = injectedArgs.tagName || null;
    const exactMatch = injectedArgs.exactMatch !== undefined ? injectedArgs.exactMatch : false;
    `;

  return scriptContent.replace('(() => {', () => `(() => {
    ${parameterInjection}`);
}

/**
 * Options accepted by both script executors. `readOnly` marks a script that
 * performs no database mutations — this classification enables safe retry on
 * Apple Event contention and result caching. Never set it on a mutating
 * script.
 */
export interface ScriptExecutionOptions {
  readOnly?: boolean;
}

/**
 * Execute an inline OmniJS script inside OmniFocus via JXA.
 * Args are injected as `const args = {...};` at the top of the script.
 * Returns parsed JSON from the script's return value.
 */
export async function runOmniJs(
  omniJsScript: string,
  args?: Record<string, any>,
  options?: ScriptExecutionOptions
): Promise<any> {
  const argsInjection = args ? `const args = ${JSON.stringify(args)};` : '';
  const fullScript = argsInjection + omniJsScript;
  const escapedScript = escapeForJxaTemplate(fullScript);

  const jxaScript = `function run() {
  try {
    const app = Application('OmniFocus');
    app.includeStandardAdditions = true;
    const result = app.evaluateJavascript(\`(() => {
      try { ${escapedScript} } catch(e) { return JSON.stringify({success:false,error:e.message}); }
    })()\`);
    return result;
  } catch(e) {
    return JSON.stringify({__omnifocusTransportError:true,success:false,error:e.message,code:e.errorNumber || e.number || null});
  }
}`;

  const { stdout, stderr } = await runOsascript(jxaScript, options);
  if (stderr) {
    console.error("runOmniJs stderr:", stderr);
  }
  return recordToolData(parseScriptOutput(stdout));
}

// Execute a packaged OmniJS script file (from omnifocusScripts/) in OmniFocus.
export async function executeOmniFocusScript(
  scriptPath: string,
  args?: any,
  options?: ScriptExecutionOptions
): Promise<any> {
  try {
    // Get the actual script path (existing code remains the same)
    let actualPath;
    if (scriptPath.startsWith('@')) {
      const scriptName = scriptPath.substring(1);
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);

      const distPath = join(__dirname, '..', 'utils', 'omnifocusScripts', scriptName);
      const srcPath = join(__dirname, '..', '..', 'src', 'utils', 'omnifocusScripts', scriptName);

      if (existsSync(distPath)) {
        actualPath = distPath;
      } else if (existsSync(srcPath)) {
        actualPath = srcPath;
      } else {
        actualPath = join(__dirname, '..', 'omnifocusScripts', scriptName);
      }
    } else {
      actualPath = scriptPath;
    }

    // Read the script file and inject any caller arguments
    const scriptContent = injectScriptParameters(readFileSync(actualPath, 'utf8'), args);

    // Escape the script content properly for use in JXA
    const escapedScript = escapeForJxaTemplate(scriptContent);

    // Create a JXA script that will execute our OmniJS script in OmniFocus
    const jxaScript = `
    function run() {
      try {
        const app = Application('OmniFocus');
        app.includeStandardAdditions = true;

        // Run the OmniJS script in OmniFocus and capture the output
        const result = app.evaluateJavascript(\`${escapedScript}\`);

        // Return the result
        return result;
      } catch (e) {
        return JSON.stringify({ __omnifocusTransportError: true, success: false, error: e.message, code: e.errorNumber || e.number || null });
      }
    }
    `;

    // Pipe the wrapper straight into osascript's stdin — no temp file.
    const { stdout, stderr } = await runOsascript(jxaScript, options);

    if (stderr) {
      console.error("Script stderr output:", stderr);
    }

    return recordToolData(parseScriptOutput(stdout));
  } catch (error) {
    console.error("Failed to execute OmniFocus script:", error);
    throw error;
  }
}
