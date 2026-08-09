import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  escapeForJxaTemplate,
  createTempScriptPath,
  parseScriptOutput,
  injectScriptParameters,
} from './scriptExecution.js';

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

test('createTempScriptPath: back-to-back names never collide', () => {
  const a = createTempScriptPath('omnijs');
  const b = createTempScriptPath('omnijs');

  assert.notEqual(a, b);
  assert.ok(a.startsWith(tmpdir()), `expected ${a} under ${tmpdir()}`);
  assert.ok(a.endsWith('.js'));
  assert.match(a, /omnijs_[0-9a-f-]{36}\.js$/);

  const names = new Set(Array.from({ length: 200 }, () => createTempScriptPath('jxa_wrapper')));
  assert.equal(names.size, 200);
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

test('legacy hardcoded-perspective regex patches are gone from the source', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'scriptExecution.ts'), 'utf8');

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

test('no execAsync call is left without a timeout and maxBuffer', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, 'scriptExecution.ts'), 'utf8');

  const callCount = (src.match(/execAsync\(/g) || []).length;
  assert.equal(callCount, 1, 'osascript should be invoked through the single runOsascript wrapper');
  assert.match(src, /timeout: OSASCRIPT_TIMEOUT_MS/);
  assert.match(src, /maxBuffer: OSASCRIPT_MAX_BUFFER/);
  assert.doesNotMatch(src, /export async function executeAppleScript/, 'dead executeAppleScript still exported');
  assert.doesNotMatch(src, /export async function executeJXA/, 'dead executeJXA still exported');
});
