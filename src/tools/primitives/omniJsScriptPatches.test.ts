import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// These OmniJS-embedded fixes cannot be unit-tested by executing the script
// (it requires the OmniFocus runtime), so as a smoke check the test verifies
// the source file contains the expected fix logic. End-to-end verification
// requires restarting Claude Code so the rebuilt MCP server loads.

const here = dirname(fileURLToPath(import.meta.url));

function readPrimitive(name: string): string {
  return readFileSync(join(here, name), 'utf8');
}

// The ambiguity guard from Bug 1 / v0.3.3 now lives in the shared lookup
// helpers (v0.5.0): get_task_by_id delegates to __resolveByIdOrName instead of
// duplicating the scan, so the guarantee is asserted at both ends.
test('getTaskById primitive resolves through the shared strict lookup helper', () => {
  const src = readPrimitive('getTaskById.ts');
  assert.match(src, /OMNIJS_LOOKUP_HELPERS/, 'getTaskById does not prepend the shared lookup helpers');
  assert.match(
    src,
    /__resolveByIdOrName\(flattenedTasks, args\.taskId \|\| null, args\.taskName \|\| null, 'Task'\)/,
    'getTaskById does not use __resolveByIdOrName'
  );
  assert.doesNotMatch(src, /flattenedTasks\.filter\(t => t\.id\.primaryKey === args\.taskId\)/, 'getTaskById still hand-rolls its ID scan');
  assert.doesNotMatch(src, /error: 'Task not found' \}/, 'getTaskById still returns the bare "Task not found" message');
});

test('shared lookup helper still guards ambiguous names (Bug 1 / v0.3.3)', () => {
  const helpers = readFileSync(join(here, '..', '..', 'utils', 'omniJsHelpers.ts'), 'utf8');
  assert.match(helpers, /matches\.length > 1/, 'shared helper missing matches.length ambiguity check');
  assert.match(helpers, /Ambiguous ' \+ label \+ ' name/, 'shared helper missing ambiguity error message');
});

test('editItem primitive errors instead of auto-creating missing folders (Bug 3 / v0.3.3)', () => {
  const src = readPrimitive('editItem.ts');
  // The bug: old code did `destFolder = new Folder(args.newFolderName)` when
  // lookup failed, silently creating a folder. The fix returns an error.
  assert.doesNotMatch(src, /destFolder = new Folder\(args\.newFolderName\)/, 'editItem still auto-creates missing folders');
  assert.match(src, /Folder not found:/, 'editItem missing folder-not-found error message');
});

test('editItem primitive supports newFolderId lookup (v0.3.3 follow-up)', () => {
  const src = readPrimitive('editItem.ts');
  assert.match(src, /args\.newFolderId/, 'editItem missing newFolderId reference');
  assert.match(src, /primaryKey === args\.newFolderId/, 'editItem missing newFolderId lookup by primaryKey');
  assert.match(src, /Folder not found with ID:/, 'editItem missing newFolderId not-found error message');
});

test('editItem primitive supports slash-path folder resolution (v0.3.3 follow-up)', () => {
  const src = readPrimitive('editItem.ts');
  assert.match(src, /resolveFolderPath/, 'editItem missing recursive resolveFolderPath helper');
  assert.match(src, /newFolderName\.indexOf\('\/'\)/, 'editItem missing path-detection check on /');
  assert.match(src, /f\.parent && f\.parent\.id\.primaryKey/, 'editItem missing parent-walk filter for path resolution');
  // The resolver must split on '/' from the rightmost position so the longest
  // literal prefix wins — required for folder names that themselves contain '/'.
  assert.match(src, /for \(let i = pathStr\.length - 1; i >= 0; i--\)/, 'editItem resolver not iterating from rightmost slash');
});
