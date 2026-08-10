import assert from 'node:assert/strict';
import test from 'node:test';

import { APP_CONTROL_SCRIPT, appControl, validateAppControlParams } from './appControl.js';

// --- script hygiene ---

test('app_control script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', APP_CONTROL_SCRIPT));
});

test('app_control script survives the runOmniJs escaping round-trip', () => {
  assert.ok(!APP_CONTROL_SCRIPT.includes('`'), 'script contains a backtick');
  assert.ok(!APP_CONTROL_SCRIPT.includes('$'), 'script contains a dollar sign');
  assert.ok(!APP_CONTROL_SCRIPT.includes('\\'), 'script contains a backslash');
});

test('app_control script reads user data only from the args object', () => {
  assert.match(APP_CONTROL_SCRIPT, /\bargs\b/);
});

test('app_control script uses the shared lookup helpers for every resolution', () => {
  assert.match(APP_CONTROL_SCRIPT, /__resolveByIdOrName\(flattenedFolders/);
  assert.match(APP_CONTROL_SCRIPT, /__resolveByIdOrName\(flattenedProjects/);
  assert.match(APP_CONTROL_SCRIPT, /__resolveByIdOrName\(flattenedTasks/);
});

test('app_control script guards against a zero-window OmniFocus', () => {
  // document.windows[0] on a windowless app is a TypeError with no useful
  // message; the guard has to fire before any window property is read.
  assert.match(APP_CONTROL_SCRIPT, /windows\.length === 0/);
  assert.match(APP_CONTROL_SCRIPT, /OmniFocus has no open window/);
});

test('app_control script refuses to undo or redo without explicit confirmation', () => {
  assert.match(APP_CONTROL_SCRIPT, /args\.confirm !== true/);
  assert.match(APP_CONTROL_SCRIPT, /needsConfirmation: true/);
  // and it checks the stack before acting
  assert.match(APP_CONTROL_SCRIPT, /Nothing to undo/);
  assert.match(APP_CONTROL_SCRIPT, /Nothing to redo/);
});

test('app_control script treats set_focus as all-or-nothing', () => {
  assert.match(APP_CONTROL_SCRIPT, /Focus unchanged\. Could not resolve/);
});

test('app_control script reports a rejected reveal instead of claiming success', () => {
  assert.match(APP_CONTROL_SCRIPT, /selectObjects\(\[target\]\)/);
  assert.match(APP_CONTROL_SCRIPT, /selectError/);
});

test('app_control script never switches perspectives', () => {
  assert.doesNotMatch(APP_CONTROL_SCRIPT, /w\.perspective\s*=/, 'the tool must not change the user perspective');
});

// --- Node-side validation ---

test('validateAppControlParams requires a focus target for set_focus', () => {
  assert.equal(validateAppControlParams({ operation: 'set_focus' }).valid, false);
  assert.equal(validateAppControlParams({ operation: 'set_focus', folderNames: [] }).valid, false);
  assert.equal(validateAppControlParams({ operation: 'set_focus', folderNames: ['Work'] }).valid, true);
  assert.equal(validateAppControlParams({ operation: 'set_focus', projectIds: ['p1'] }).valid, true);
});

test('validateAppControlParams requires exactly one reveal target', () => {
  assert.equal(validateAppControlParams({ operation: 'reveal' }).valid, false);
  assert.equal(validateAppControlParams({ operation: 'reveal', taskId: 't1', projectName: 'P' }).valid, false);
  assert.equal(validateAppControlParams({ operation: 'reveal', taskName: 'Buy milk' }).valid, true);
});

test('validateAppControlParams leaves the target-free operations alone', () => {
  for (const operation of ['sync', 'undo', 'redo', 'get_focus', 'clear_focus'] as const) {
    assert.equal(validateAppControlParams({ operation }).valid, true, `${operation} should validate`);
  }
});

// --- Node layer, with runOmniJs mocked ---

interface RunCall { script: string; args: any; options: any }

function mockRunner(response: any) {
  const calls: RunCall[] = [];
  const run = async (script: string, args?: any, options?: any) => {
    calls.push({ script, args, options });
    return response;
  };
  return { run: run as any, calls };
}

test('appControl marks only get_focus read-only', async () => {
  const { run, calls } = mockRunner({ success: true, focus: [] });
  await appControl({ operation: 'get_focus' }, run);
  assert.deepEqual(calls[0].options, { readOnly: true });

  const sync = mockRunner({ success: true, initiated: true });
  await appControl({ operation: 'sync' }, sync.run);
  assert.equal(sync.calls[0].options, undefined, 'sync writes, so it must not be retry-eligible');

  const undo = mockRunner({ success: true, performed: false, needsConfirmation: true });
  await appControl({ operation: 'undo' }, undo.run);
  assert.equal(undo.calls[0].options, undefined);
});

test('appControl runs exactly one script per call', async () => {
  const { run, calls } = mockRunner({ success: true, focus: [{ name: 'Work', id: 'f1', kind: 'folder' }] });
  await appControl({ operation: 'set_focus', folderNames: ['Work'] }, run);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].script, APP_CONTROL_SCRIPT);
  assert.deepEqual(calls[0].args.folderNames, ['Work']);
});

test('appControl short-circuits invalid input without touching OmniFocus', async () => {
  const { run, calls } = mockRunner({ success: true });
  const result = await appControl({ operation: 'reveal' }, run);
  assert.equal(result.success, false);
  assert.match(result.error || '', /exactly one of taskId/);
  assert.equal(calls.length, 0);
});

test('appControl passes confirm through so the script can gate undo', async () => {
  const { run, calls } = mockRunner({ success: true, performed: true, canUndo: false, canRedo: true });
  const result = await appControl({ operation: 'undo', confirm: true }, run);
  assert.equal(calls[0].args.confirm, true);
  assert.equal(result.performed, true);
  assert.equal(result.canRedo, true);
});

test('appControl reports a non-object script result as a failure', async () => {
  const { run } = mockRunner(undefined);
  const result = await appControl({ operation: 'sync' }, run);
  assert.equal(result.success, false);
  assert.match(result.error || '', /no result/);
});
