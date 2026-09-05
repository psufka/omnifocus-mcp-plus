// MCP stdio smoke client for omnifocus-mcp-plus.
// Usage: node scripts/mcp-smoke.mjs <server.js path> <mode: read|mutate>
//
// read   — read-only calls against the live database; safe to run any time.
// mutate — creates disposable objects, verifies writes, then removes only its own
//          objects in finally. Does not use global undo or rewrite existing perspectives.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const serverPath = resolve(process.argv[2] || 'dist/server.js');
const expectedVersion = JSON.parse(readFileSync(join(dirname(serverPath), '..', 'package.json'), 'utf8')).version;
const mode = process.argv[3] ?? 'read';

const proc = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderrBuf = '';
proc.stderr.on('data', (d) => (stderrBuf += d));

const rl = createInterface({ input: proc.stdout });
const pending = new Map();
let nonJsonLines = 0;
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    nonJsonLines++;
    console.log(`STDOUT-POLLUTION: ${line.slice(0, 120)}`);
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

let nextId = 1;
function rpc(method, params, timeoutMs = 150_000) {
  const id = nextId++;
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${method} (id ${id})`)), timeoutMs);
    pending.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    proc.stdin.write(payload + '\n');
  });
}

function firstText(result) {
  return result?.content?.find((c) => c.type === 'text')?.text ?? '';
}

async function call(name, args) {
  const res = await rpc('tools/call', { name, arguments: args });
  if (res.error) return { protoError: res.error };
  return { isError: res.result.isError === true, text: firstText(res.result), data: res.result.structuredContent?.data, meta: res.result.structuredContent?.meta };
}

const failures = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ' — ' + detail.replace(/\n/g, ' | ').slice(0, 220) : ''}`);
  if (!ok) failures.push(label);
}

// Direct OmniJS probe for independent verification (bypasses the server).
const omni = (script) => {
  const jxa = `function run() { const app = Application('OmniFocus'); app.includeStandardAdditions = true; return app.evaluateJavascript(${JSON.stringify(`(() => { try { ${script} } catch(e) { return 'ERR: ' + e.message; } })()`)}); }`;
  return execFileSync('osascript', ['-l', 'JavaScript', '-e', jxa], { encoding: 'utf8', timeout: 30_000 }).trim();
};

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
});
check('initialize', init.result?.serverInfo?.version === expectedVersion, `version=${init.result?.serverInfo?.version}`);
check('instructions present at handshake', typeof init.result?.instructions === 'string' && init.result.instructions.length > 50,
  `len=${init.result?.instructions?.length ?? 0}`);
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const list = await rpc('tools/list', {});
const tools = list.result?.tools ?? [];
check('tools/list count', tools.length === 52, `count=${tools.length}`);
const nonStrict = tools.filter((t) => t.inputSchema?.additionalProperties !== false);
check('all schemas strict (additionalProperties:false)', nonStrict.length === 0,
  nonStrict.slice(0, 5).map((t) => t.name).join(','));
const unannotated = tools.filter((t) => !t.annotations || t.annotations.readOnlyHint === undefined);
check('all tools advertise output schemas', tools.every(t => t.outputSchema && t.outputSchema.properties?.success));
check('all tools annotated', unannotated.length === 0, unannotated.slice(0, 5).map((t) => t.name).join(','));

const prompts = await rpc('prompts/list', {});
check('prompts/list has 4 prompts', (prompts.result?.prompts ?? []).length === 4,
  (prompts.result?.prompts ?? []).map((p) => p.name).join(','));
const resources = await rpc('resources/list', {});
check('resources/list has 4 resources', (resources.result?.resources ?? []).length === 4,
  (resources.result?.resources ?? []).map((r) => r.uri).join(','));

if (mode === 'read') {
  const info = await call('server_info', {});
  check('server diagnostics report build and live OmniFocus version', !info.isError && info.data.version === expectedVersion && /^[a-f0-9]{64}$/.test(info.data.buildId) && typeof info.data.omnifocus.version === 'string' && info.data.omnifocus.connected === true);
  const tags = await call('list_tags', { sortBy: 'taskCount', limit: 5, fresh: true });
  const tagCounts = tags.data?.tags?.map(t => t.availableTaskCount) || [];
  check('tag counts are numeric and sorted', !tags.isError && tagCounts.every((n,i) => Number.isInteger(n) && (i === 0 || tagCounts[i-1] >= n)) && tagCounts.length > 0);
  const counts = await call('get_task_counts', {});
  check('get_task_counts', !counts.isError && !counts.protoError, counts.text || JSON.stringify(counts.protoError));

  const allCount = await call('filter_tasks', { countOnly: true, taskStatus: ['Available','Next','Blocked','DueSoon','Overdue','Completed','Dropped'] });
  check('filter total agrees with task counts', allCount.data?.count === counts.data?.total, `${allCount.data?.count} / ${counts.data?.total}`);
  const week = await call('filter_tasks', { completedThisWeek: true, limit: 5 });
  check('filter_tasks completedThisWeek', !week.isError && !week.protoError, week.text.slice(0, 200));

  const orClause = await call('filter_tasks', {
    or: [{ flagged: true }, { hasNote: true }],
    limit: 5,
  });
  check('filter_tasks or-clause', !orClause.isError && !orClause.protoError, orClause.text.slice(0, 150));

  const countOnly = await call('filter_tasks', { countOnly: true, flagged: true });
  check('filter_tasks countOnly', !countOnly.isError && !countOnly.protoError && /\d/.test(countOnly.text),
    countOnly.text.slice(0, 120));

  const paged = await call('filter_tasks', { limit: 3, offset: 3, sortBy: 'name' });
  check('filter_tasks offset paging', !paged.isError && !paged.protoError && /showing/i.test(paged.text),
    paged.text.slice(0, 150));

  const fields = await call('filter_tasks', { limit: 3, fields: ['status'] });
  check('filter_tasks fields projection', !fields.isError && !fields.protoError, fields.text.slice(0, 120));

  check('structured field projection hides unrequested notes and tags', fields.data?.tasks?.every(t => !('note' in t) && !('tags' in t) && t.id && t.name));
  const badClause = await call('filter_tasks', { and: [{ bogusKey: true }] });
  check('unsupported clause key rejects loudly', badClause.isError === true || badClause.protoError !== undefined,
    (badClause.text || JSON.stringify(badClause.protoError) || '').slice(0, 150));

  const search = await call('search_items', { query: 'a', limitPerType: 3 });
  check('search_items', !search.isError && !search.protoError, search.text.slice(0, 150));

  const reviews = await call('manage_reviews', { operation: 'list_due', all: true });
  check('manage_reviews list_due', !reviews.isError && !reviews.protoError, reviews.text.slice(0, 150));

  const health = await call('analyze', { analysis: 'health_snapshot', fresh: true });
  const incomplete = await call('filter_tasks', { countOnly: true });
  check('health and filter incomplete task counts agree', health.data?.incompleteTotal === incomplete.data?.count, `${health.data?.incompleteTotal} / ${incomplete.data?.count}`);
  check('analyze health_snapshot', !health.isError && !health.protoError, health.text.slice(0, 150));

  const stalled = await call('analyze', { analysis: 'stalled_projects' });
  check('analyze stalled_projects', !stalled.isError && !stalled.protoError, stalled.text.slice(0, 120));

  const persp = await call('list_custom_perspectives', { includeRules: true });
  check('list_custom_perspectives includeRules', !persp.isError && !persp.protoError && /actionAvailability|rules/i.test(persp.text),
    persp.text.slice(0, 150));

  const similar = await call('find_similar_tasks', { name: 'call the clinic', limit: 3 });
  check('structured similarity results are ranked and limited', Array.isArray(similar.data?.matches) && similar.data.matches.length <= 3 && similar.data.matches.every(m => typeof m.score === 'number') && !('tasks' in similar.data));
  check('find_similar_tasks', !similar.isError && !similar.protoError, similar.text.slice(0, 120));

  const focus = await call('app_control', { operation: 'get_focus' });
  check('app_control get_focus', !focus.isError && !focus.protoError, focus.text.slice(0, 120));

  const undoState = await call('app_control', { operation: 'undo' });
  check('app_control undo without confirm only reports state',
    !undoState.protoError && /canUndo|confirm/i.test(undoState.text), undoState.text.slice(0, 150));

  const inboxRes = await rpc('resources/read', { uri: 'omnifocus://inbox' });
  check('resources/read omnifocus://inbox', !!inboxRes.result?.contents?.[0]?.text,
    (inboxRes.result?.contents?.[0]?.text ?? JSON.stringify(inboxRes.error)).slice(0, 100));

  const bogus = await call('get_task_counts', { bogusField: 1 });
  check('strict rejection of unknown field', bogus.isError === true || bogus.protoError,
    bogus.text || JSON.stringify(bogus.protoError));

  const badDate = await call('filter_tasks', { dueBefore: 'not-a-date' });
  check('bad date rejected', badDate.isError === true || badDate.protoError !== undefined,
    (badDate.text || JSON.stringify(badDate.protoError) || '').slice(0, 150));

  for (const date of ['2026-02-31','2026-02-29','1']) {
    const invalid = await call('list_projects', { completedBefore: date });
    check(`impossible or ambiguous date rejected: ${date}`, invalid.isError || invalid.protoError);
  }
  const coerced = await call('filter_tasks', { countOnly: 'true', flagged: 'true' });
  check('stringified booleans coerce (tolerant input)', !coerced.isError && !coerced.protoError,
    coerced.text.slice(0, 120));
}

if (mode === 'mutate') {
  const stamp = Date.now();
  const marker = `MCP reliability smoke ${stamp}`;
  const owned = (name) => `${marker} ${name}`;
  const must = (response, label) => {
    check(label, !response.isError && !response.protoError, response.text || JSON.stringify(response.protoError));
    if (response.isError || response.protoError) throw new Error(label);
    return response.data;
  };
  try {
    const dry = await call('batch_add_items', { dryRun: true, items: [{ itemType: 'task', name: owned('dry run') }] });
    must(dry, 'batch creation preview');
    check('preview creates nothing', omni(`return flattenedTasks.filter(t => t.name === ${JSON.stringify(owned('dry run'))}).length;`) === '0');

    const folder = must(await call('create_folder', { name: owned('folder') }), 'create disposable folder');
    const parentA = must(await call('create_tag', { name: owned('parent A') }), 'create tag parent A');
    const parentB = must(await call('create_tag', { name: owned('parent B') }), 'create tag parent B');
    const tagA = must(await call('create_tag', { name: owned('duplicate'), parent: parentA.id }), 'create tag leaf A');
    const tagB = must(await call('create_tag', { name: owned('duplicate'), parent: parentB.id }), 'create tag leaf B');
    const projectArgs = { name: owned('project'), folderName: folder.id, dueDate: '2030-02-28',
      tags: [`${parentA.name}/${tagA.name}`], sequential: false, idempotencyKey: owned('project request') };
    const project = must(await call('add_project', projectArgs), 'verified project creation by tag path');
    check('project tag and placement verified', project.verified === true && project.tagIds.includes(tagA.id));
    const replay = await call('add_project', projectArgs);
    check('create request key replays the same project', !replay.isError && replay.data.projectId === project.projectId && replay.meta.idempotency.replayed === true);
    const independentReplay = JSON.parse(execFileSync(process.execPath, [join(dirname(serverPath), 'cli.js'), 'call', 'add_project', JSON.stringify(projectArgs)], { encoding: 'utf8', timeout: 30_000 }));
    check('request key replays across a separate CLI process', independentReplay.structuredContent.data.projectId === project.projectId && independentReplay.structuredContent.meta.idempotency.replayed === true);

    const task = must(await call('add_omnifocus_task', { name: owned('task'), projectName: projectArgs.name, tagIds: [tagA.id], note: 'Disposable reliability smoke item.' }), 'verified task creation by tag ID');
    const inherited = await call('filter_tasks', { projectFilter: projectArgs.name, dueBefore: '2030-03-01', dateMode: 'effective', countOnly: true });
    const direct = await call('filter_tasks', { projectFilter: projectArgs.name, dueBefore: '2030-03-01', dateMode: 'direct', countOnly: true });
    check('inherited dates are explicit and project roots excluded', inherited.data.count === 1 && direct.data.count === 0);

    const ambiguousCreate = await call('add_omnifocus_task', { name: owned('must not exist'), tags: [tagA.name] });
    check('ambiguous creation rejected before mutation', ambiguousCreate.isError && /Ambiguous/.test(ambiguousCreate.text));
    const ambiguousEdit = await call('edit_item', { id: task.taskId, itemType: 'task', newName: owned('wrong rename'), replaceTags: [tagA.name] });
    check('ambiguous replacement rejected before rename or clear', ambiguousEdit.isError && /Ambiguous/.test(ambiguousEdit.text));
    const unchanged = must(await call('get_task_by_id', { taskId: task.taskId }), 'read after rejected edit');
    check('failed tag preflight left the item intact', unchanged.task.name === owned('task') && unchanged.task.tags.some(t => (typeof t === 'string' ? t : t.name) === tagA.name));

    const edits = { items: [{ id: task.taskId, itemType: 'task', newDueDate: '2030-02-27', newPlannedDate: '2030-02-26', replaceTagIds: [tagB.id] }] };
    const preview = must(await call('batch_edit_items', { ...edits, dryRun: true }), 'batch edit preview');
    check('batch edit preview returns target ID and changes', preview.results[0].id === task.taskId && preview.results[0].status === 'wouldEdit');
    const beforeEdit = must(await call('get_task_by_id', { taskId: task.taskId }), 'read after preview');
    check('batch edit preview did not set due date', !beforeEdit.task.dueDate);
    const edited = must(await call('batch_edit_items', edits), 'batch edit applies and verifies');
    check('batch edit verifies exact tag ID', edited.results[0].verified === true && edited.results[0].tagIds.includes(tagB.id));

    const batch = must(await call('batch_add_items', { atomic: true, items: [
      { itemType: 'task', name: owned('parent task'), projectName: projectArgs.name, tempId: 'parent' },
      { itemType: 'task', name: owned('child task'), parentTempId: 'parent', tagIds: [tagB.id] }
    ] }), 'atomic hierarchy creation');
    check('batch hierarchy read-back verified', batch.verified === true && batch.results.every(r => r.id && r.verified));
    const rollback = await call('batch_add_items', { atomic: true, items: [
      { itemType: 'task', name: owned('rolled back') },
      { itemType: 'task', name: owned('invalid destination'), projectName: owned('nonexistent project') }
    ] });
    check('failed atomic batch verifies complete rollback', rollback.isError && rollback.data.rolledBack === true && rollback.data.rollbackStatus === 'complete' && rollback.data.survivingItems.length === 0);

    must(await call('set_task_repetition', { task_id: task.taskId, frequency: 'daily', interval: 2, schedule_type: 'from_completion' }), 'set repetition on disposable task');
    const content = Buffer.from(`smoke ${stamp}`).toString('base64');
    must(await call('manage_attachments', { operation: 'add', taskId: task.taskId, filename: 'smoke.txt', base64: content }), 'add disposable attachment');
    const attachment = must(await call('manage_attachments', { operation: 'read', taskId: task.taskId, index: 0 }), 'read disposable attachment');
    check('structured attachment round-trips bytes', attachment.base64 === content);
    must(await call('manage_attachments', { operation: 'remove', taskId: task.taskId, index: 0 }), 'remove disposable attachment');
    must(await call('manage_reviews', { operation: 'set_schedule', projectId: project.projectId, unit: 'week', steps: 2 }), 'set disposable project review');
    must(await call('manage_reviews', { operation: 'mark_reviewed', projectId: project.projectId }), 'mark disposable project reviewed');
    const toConvert = must(await call('add_omnifocus_task', { name: owned('convert') }), 'create disposable conversion task');
    must(await call('convert_task_to_project', { taskId: toConvert.taskId }), 'convert disposable task');
  } catch (error) {
    check('mutation workflow finished', false, error.message);
  } finally {
    // Locate only this run's uniquely prefixed objects, including creates whose
    // transport response was lost. Cleanup uses IDs, never a fuzzy name match.
    const leftovers = JSON.parse(omni(`const prefix = ${JSON.stringify(marker)}; const matches = x => x.name.indexOf(prefix) === 0;
      return JSON.stringify({tasks: flattenedTasks.filter(t => !t.project && matches(t)).map(t => t.id.primaryKey),
        projects: flattenedProjects.filter(matches).map(p => p.id.primaryKey), tags: flattenedTags.filter(matches).map(t => t.id.primaryKey).reverse(),
        folders: flattenedFolders.filter(matches).map(f => f.id.primaryKey).reverse()});`));
    for (const [kind, ids] of Object.entries(leftovers)) {
      for (const id of ids) {
        try {
          const cls = { tasks: 'Task', projects: 'Project', tags: 'Tag', folders: 'Folder' }[kind];
          if (omni(`return ${cls}.byIdentifier(${JSON.stringify(id)}) === null ? 'gone' : 'exists';`) === 'gone') continue;
          const result = kind === 'tags' ? await call('delete_tag', { name_or_id: id })
            : kind === 'folders' ? await call('delete_folder', { name_or_id: id })
            : await call('remove_item', { id, itemType: kind === 'tasks' ? 'task' : 'project' });
          check(`cleanup ${kind} ${id}`, !result.isError && !result.protoError, result.text);
        } catch (error) { check(`cleanup ${kind} ${id}`, false, error.message); }
      }
    }
    const remaining = omni(`const prefix = ${JSON.stringify(marker)}; return String([flattenedTasks,flattenedProjects,flattenedTags,flattenedFolders].reduce((n, xs) => n + xs.filter(x => x.name.indexOf(prefix) === 0).length,0));`);
    check('zero disposable leftovers', remaining === '0', `leftovers=${remaining}`);
  }
}

check('no stdout pollution', nonJsonLines === 0, `${nonJsonLines} non-JSON lines`);
console.log(failures.length === 0 ? 'SMOKE: ALL PASS' : `SMOKE: ${failures.length} FAILURES: ${failures.join('; ')}`);
if (stderrBuf.trim()) console.log(`STDERR (first 300): ${stderrBuf.slice(0, 300)}`);
proc.kill();
process.exit(failures.length === 0 ? 0 : 1);
