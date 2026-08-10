import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERT_TASK_TO_PROJECT_SCRIPT,
  validateConvertTaskToProjectParams
} from './convertTaskToProject.js';

// --- Script syntax coverage ------------------------------------------------

test('convert_task_to_project script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function('args', CONVERT_TASK_TO_PROJECT_SCRIPT));
});

test('convert_task_to_project script survives the runOmniJs escaping round-trip', () => {
  assert.ok(!CONVERT_TASK_TO_PROJECT_SCRIPT.includes('`'), 'script contains a backtick');
  assert.ok(!CONVERT_TASK_TO_PROJECT_SCRIPT.includes('$'), 'script contains a dollar sign');
  assert.ok(!CONVERT_TASK_TO_PROJECT_SCRIPT.includes('\\'), 'script contains a backslash');
});

test('convert_task_to_project script reads user data only from the args object', () => {
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /\bargs\b/);
});

// --- Verified API facts ----------------------------------------------------

test('conversion uses the global convertTasksToProjects with an insertion point', () => {
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /convertTasksToProjects\(\[task\], destination\)/, 'does not call the global convertTasksToProjects');
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /folder \? folder\.ending : library\.ending/, 'destination is not a folder/library insertion point');
  assert.doesNotMatch(CONVERT_TASK_TO_PROJECT_SCRIPT, /document\.convertTasksToProjects/, 'convertTasksToProjects is a global, not a document method');
});

test('lookups go through the shared helpers', () => {
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /__resolveByIdOrName\(flattenedTasks, args\.taskId \|\| null, args\.taskName \|\| null, 'Task'\)/);
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /__resolveByIdOrName\(flattenedFolders, args\.folderId \|\| null, args\.folderName \|\| null, 'Folder'\)/);
});

test('a task that is already a project root is rejected, not converted again', () => {
  // A project and its root task share a primaryKey, so Project.byIdentifier on
  // the task id is the identity check.
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /Project\.byIdentifier\(taskId\)/, 'missing project-root identity guard');
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /is already the root task of a project/, 'missing already-a-project error');
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /cp\.id\.primaryKey === taskId/, 'missing containing-project identity guard');
});

test('the returned project is re-read from the database, not trusted', () => {
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /const byId = Project\.byIdentifier\(taskId\)/, 'does not re-read the new project by id');
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /flattenedProjects\.filter\(function \(p\) \{ return p\.name === taskName; \}\)/, 'missing name-based read-back fallback');
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /const identityOk = /, 'does not verify the task identity after conversion');
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /const subtasksOk = subtaskCountAfter === subtaskCountBefore/, 'does not verify subtask preservation');
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /verified: identityOk && subtasksOk/, 'verified flag is not derived from the read-back');
});

test('tags are only cleared when the caller explicitly opts out', () => {
  assert.match(CONVERT_TASK_TO_PROJECT_SCRIPT, /args\.keepTags === false/, 'keepTags must be opt-out, never the default');
  assert.doesNotMatch(CONVERT_TASK_TO_PROJECT_SCRIPT, /args\.keepTags !== true/, 'keepTags default must be "keep"');
});

// --- Parameter validation --------------------------------------------------

test('convert_task_to_project requires a task', () => {
  const v = validateConvertTaskToProjectParams({});
  assert.equal(v.valid, false);
  assert.match(v.error || '', /Either taskId or taskName/);
});

test('convert_task_to_project rejects both taskId and taskName', () => {
  const v = validateConvertTaskToProjectParams({ taskId: 't1', taskName: 'Plan trip' });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /Cannot specify both taskId and taskName/);
});

test('convert_task_to_project rejects both folderId and folderName', () => {
  const v = validateConvertTaskToProjectParams({ taskId: 't1', folderId: 'f1', folderName: 'Travel' });
  assert.equal(v.valid, false);
  assert.match(v.error || '', /Cannot specify both folderId and folderName/);
});

test('convert_task_to_project accepts a task with an optional destination', () => {
  assert.equal(validateConvertTaskToProjectParams({ taskId: 't1' }).valid, true);
  assert.equal(validateConvertTaskToProjectParams({ taskName: 'Plan trip', folderName: 'Travel' }).valid, true);
});
