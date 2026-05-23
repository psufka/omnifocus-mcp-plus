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

test('getTaskById primitive contains ambiguity-check pattern (Bug 1 / v0.3.3)', () => {
  const src = readPrimitive('getTaskById.ts');
  assert.match(src, /matches\.length > 1/, 'getTaskById missing matches.length ambiguity check');
  assert.match(src, /Ambiguous task name/, 'getTaskById missing ambiguity error message');
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
  assert.match(src, /newFolderName\.split\('\/'\)/, 'editItem missing path split on /');
  assert.match(src, /newFolderName\.indexOf\('\/'\)/, 'editItem missing path-detection check on /');
  assert.match(src, /f\.parent && f\.parent\.id\.primaryKey/, 'editItem missing parent-walk filter for path resolution');
});
