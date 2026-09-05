import test from 'node:test';
import assert from 'node:assert/strict';
import { LIST_TAGS_SCRIPT, SEARCH_TAGS_SCRIPT } from './tagTools.js';

test('tag listing sorts and reports actual availableTasks lengths; search reports counts too', () => {
  const tags = [1, 7, 0, 3].map((count, i) => ({ id: { primaryKey: String(i) }, name: `tag ${i}`, status: 'active', parent: null, availableTasks: Array(count).fill({}) }));
  const run = (script: string, args: any) => JSON.parse(new Function('args','flattenedTags','Tag',script)(args, tags, { Status: { Active: 'active', OnHold: 'on_hold', Dropped: 'dropped' } }));
  const listed = run(LIST_TAGS_SCRIPT, { sortBy: 'taskCount', limit: 3 });
  assert.deepEqual(listed.tags.map((t: any) => t.availableTaskCount), [7, 3, 1]);
  assert.deepEqual(listed.tags.map((t: any) => t.id), ['1', '3', '0']);
  const searched = run(SEARCH_TAGS_SCRIPT, { query: 'tag 3' });
  assert.equal(searched.tags[0].availableTaskCount, 3);
});
