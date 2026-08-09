import assert from 'node:assert/strict';
import test from 'node:test';

import { ADD_TASK_SCRIPT } from './addOmniFocusTask.js';
import { BATCH_ADD_ITEMS_SCRIPT } from './batchAddItems.js';
import { BATCH_REMOVE_ITEMS_SCRIPT } from './batchRemoveItems.js';
import { BATCH_MOVE_TASKS_SCRIPT } from './batchMoveTasks.js';
import {
  ADD_NOTIFICATION_SCRIPT,
  LIST_NOTIFICATIONS_SCRIPT,
  REMOVE_NOTIFICATION_SCRIPT
} from './notificationTools.js';

// These scripts only ever run inside OmniFocus, so a syntax error in one would
// otherwise surface as a runtime failure against the live database. Compiling
// each with `new Function` parses it (identifiers like `flattenedTasks` are
// resolved at call time, which never happens here) without touching OmniFocus.

const SCRIPTS: Array<[string, string]> = [
  ['add_omnifocus_task', ADD_TASK_SCRIPT],
  ['batch_add_items', BATCH_ADD_ITEMS_SCRIPT],
  ['batch_remove_items', BATCH_REMOVE_ITEMS_SCRIPT],
  ['batch_move_tasks', BATCH_MOVE_TASKS_SCRIPT],
  ['list_notifications', LIST_NOTIFICATIONS_SCRIPT],
  ['add_notification', ADD_NOTIFICATION_SCRIPT],
  ['remove_notification', REMOVE_NOTIFICATION_SCRIPT]
];

for (const [name, script] of SCRIPTS) {
  test(`${name} script is syntactically valid JavaScript`, () => {
    assert.doesNotThrow(() => new Function('args', script), `${name} script failed to parse`);
  });

  test(`${name} script survives the runOmniJs escaping round-trip`, () => {
    // runOmniJs escapes \ ` and $ before embedding the script in a JXA template
    // literal; a script containing any of them is a hazard.
    assert.ok(!script.includes('`'), `${name} script contains a backtick`);
    assert.ok(!script.includes('$'), `${name} script contains a dollar sign`);
    assert.ok(!script.includes('\\'), `${name} script contains a backslash`);
  });

  test(`${name} script reads user data only from the args object`, () => {
    // Every user value is injected as `const args = {...}` by runOmniJs. A
    // script that referenced anything else would mean string interpolation.
    assert.match(script, /\bargs\b/, `${name} script never reads args`);
  });
}
