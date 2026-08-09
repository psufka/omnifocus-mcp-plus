import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';

const execAsync = promisify(exec);

const OSASCRIPT_TIMEOUT_MS = 120_000;
const OSASCRIPT_MAX_BUFFER = 50 * 1024 * 1024;
const RAW_OUTPUT_LIMIT = 2000;

/**
 * Escape a script so it can be embedded inside a JXA template literal.
 * Backslashes, backticks and `$` would otherwise terminate the literal or
 * start an interpolation.
 */
export function escapeForJxaTemplate(source: string): string {
  return source.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

/**
 * Build a collision-free temp script path. Concurrent MCP calls can land in the
 * same millisecond, so the name is keyed on a UUID rather than the clock.
 */
export function createTempScriptPath(prefix: string): string {
  return join(tmpdir(), `${prefix}_${randomUUID()}.js`);
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

/**
 * Turn an exec failure into an actionable error. A hung osascript almost always
 * means OmniFocus is blocked on something waiting for a human.
 */
function describeExecFailure(error: unknown): Error {
  const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };

  if (err && err.killed && err.signal === 'SIGTERM') {
    return new Error(
      `OmniFocus did not respond within ${OSASCRIPT_TIMEOUT_MS / 1000}s. ` +
      `The usual cause is a modal dialog or an automation permission prompt waiting for input in OmniFocus. ` +
      `Switch to OmniFocus, dismiss any open dialog or grant the prompt, then retry.`
    );
  }

  if (err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new Error(
      `OmniFocus returned more than ${OSASCRIPT_MAX_BUFFER / (1024 * 1024)}MB of output. ` +
      `Narrow the request with a limit or filter, then retry.`
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

async function runOsascript(tempFile: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execAsync(`osascript -l JavaScript "${tempFile}"`, {
      timeout: OSASCRIPT_TIMEOUT_MS,
      maxBuffer: OSASCRIPT_MAX_BUFFER
    });
  } catch (error) {
    throw describeExecFailure(error);
  }
}

/**
 * Inject caller arguments into an OmniJS script file's top-level IIFE.
 * The replacement is a function so `$&`/`$'`-style sequences inside the JSON
 * payload are never treated as substitution patterns.
 */
export function injectScriptParameters(scriptContent: string, args: any): string {
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
 * Execute an inline OmniJS script inside OmniFocus via JXA.
 * Args are injected as `const args = {...};` at the top of the script.
 * Returns parsed JSON from the script's return value.
 */
export async function runOmniJs(omniJsScript: string, args?: Record<string, any>): Promise<any> {
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
    return JSON.stringify({success:false,error:e.message});
  }
}`;

  const tempFile = createTempScriptPath('omnijs');
  try {
    writeFileSync(tempFile, jxaScript);
    const { stdout, stderr } = await runOsascript(tempFile);
    if (stderr) {
      console.error("runOmniJs stderr:", stderr);
    }
    return parseScriptOutput(stdout);
  } finally {
    try { unlinkSync(tempFile); } catch {}
  }
}

// Function to execute scripts in OmniFocus using the URL scheme
// Update src/utils/scriptExecution.ts
export async function executeOmniFocusScript(scriptPath: string, args?: any): Promise<any> {
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

    // Create a temporary file for our JXA wrapper script
    const tempFile = createTempScriptPath('jxa_wrapper');

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
        return JSON.stringify({ error: e.message });
      }
    }
    `;

    try {
      // Write the JXA script to the temporary file
      writeFileSync(tempFile, jxaScript);

      // Execute the JXA script using osascript
      const { stdout, stderr } = await runOsascript(tempFile);

      if (stderr) {
        console.error("Script stderr output:", stderr);
      }

      return parseScriptOutput(stdout);
    } finally {
      // Clean up the temporary file
      try { unlinkSync(tempFile); } catch {}
    }
  } catch (error) {
    console.error("Failed to execute OmniFocus script:", error);
    throw error;
  }
}
