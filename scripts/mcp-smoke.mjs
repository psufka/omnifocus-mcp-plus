// MCP stdio smoke client for omnifocus-mcp-plus.
// Usage: node scripts/mcp-smoke.mjs <server.js path> <mode: read|mutate>
//
// read   — read-only calls against the live database; safe to run any time.
// mutate — creates a handful of clearly-marked throwaway items, exercises the
//          0.5.0 write paths (repetition, attachments, convert, reviews,
//          perspective same-value rewrite, undo), and removes everything it
//          created. Nothing pre-existing is touched.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const serverPath = process.argv[2];
const mode = process.argv[3] ?? 'read';

const proc = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  return { isError: res.result.isError === true, text: firstText(res.result) };
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
check('initialize', init.result?.serverInfo?.version === '0.5.0', `version=${init.result?.serverInfo?.version}`);
check('instructions present at handshake', typeof init.result?.instructions === 'string' && init.result.instructions.length > 50,
  `len=${init.result?.instructions?.length ?? 0}`);
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const list = await rpc('tools/list', {});
const tools = list.result?.tools ?? [];
check('tools/list count', tools.length === 50, `count=${tools.length}`);
const nonStrict = tools.filter((t) => t.inputSchema?.additionalProperties !== false);
check('all schemas strict (additionalProperties:false)', nonStrict.length === 0,
  nonStrict.slice(0, 5).map((t) => t.name).join(','));
const unannotated = tools.filter((t) => !t.annotations || t.annotations.readOnlyHint === undefined);
check('all tools annotated', unannotated.length === 0, unannotated.slice(0, 5).map((t) => t.name).join(','));

const prompts = await rpc('prompts/list', {});
check('prompts/list has 4 prompts', (prompts.result?.prompts ?? []).length === 4,
  (prompts.result?.prompts ?? []).map((p) => p.name).join(','));
const resources = await rpc('resources/list', {});
check('resources/list has 4 resources', (resources.result?.resources ?? []).length === 4,
  (resources.result?.resources ?? []).map((r) => r.uri).join(','));

if (mode === 'read') {
  const counts = await call('get_task_counts', {});
  check('get_task_counts', !counts.isError && !counts.protoError, counts.text || JSON.stringify(counts.protoError));

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

  const badClause = await call('filter_tasks', { and: [{ bogusKey: true }] });
  check('unsupported clause key rejects loudly', badClause.isError === true || badClause.protoError !== undefined,
    (badClause.text || JSON.stringify(badClause.protoError) || '').slice(0, 150));

  const search = await call('search_items', { query: 'a', limitPerType: 3 });
  check('search_items', !search.isError && !search.protoError, search.text.slice(0, 150));

  const reviews = await call('manage_reviews', { operation: 'list_due', all: true });
  check('manage_reviews list_due', !reviews.isError && !reviews.protoError, reviews.text.slice(0, 150));

  const health = await call('analyze', { analysis: 'health_snapshot' });
  check('analyze health_snapshot', !health.isError && !health.protoError, health.text.slice(0, 150));

  const stalled = await call('analyze', { analysis: 'stalled_projects' });
  check('analyze stalled_projects', !stalled.isError && !stalled.protoError, stalled.text.slice(0, 120));

  const persp = await call('list_custom_perspectives', { includeRules: true });
  check('list_custom_perspectives includeRules', !persp.isError && !persp.protoError && /actionAvailability|rules/i.test(persp.text),
    persp.text.slice(0, 150));

  const similar = await call('find_similar_tasks', { name: 'call the clinic' });
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

  const coerced = await call('filter_tasks', { countOnly: 'true', flagged: 'true' });
  check('stringified booleans coerce (tolerant input)', !coerced.isError && !coerced.protoError,
    coerced.text.slice(0, 120));
}

if (mode === 'mutate') {
  const stamp = Date.now();
  const marker = `MCP smoke ${stamp} (safe to delete)`;
  const cleanup = []; // {id, itemType}

  // --- dryRun creates nothing ---
  const dryName = `${marker} dryrun`;
  const dry = await call('batch_add_items', { dryRun: true, items: [{ itemType: 'task', name: dryName }] });
  check('batch_add_items dryRun succeeds', !dry.isError && !dry.protoError, dry.text.slice(0, 150));
  const dryGone = omni(`return flattenedTasks.filter(t => t.name === ${JSON.stringify(dryName)}).length === 0 ? 'nothing-created' : 'CREATED';`);
  check('dryRun created nothing', dryGone === 'nothing-created', dryGone);

  // --- undo cycle FIRST: OmniFocus coalesces automation changes into undo
  // groups, so this must run before any other smoke object exists — an undo
  // later in the sequence swallows them all (observed live). ---
  const undoName = `${marker} undome`;
  await call('add_omnifocus_task', { name: undoName });
  const undoTaskId = omni(`const t = flattenedTasks.filter(t => t.name === ${JSON.stringify(undoName)})[0]; return t ? t.id.primaryKey : 'NOT-FOUND';`);
  check('undo target created', undoTaskId !== 'NOT-FOUND', `id=${undoTaskId}`);
  const undo = await call('app_control', { operation: 'undo', confirm: true });
  check('app_control undo with confirm', !undo.isError && !undo.protoError, undo.text.slice(0, 150));
  const undone = omni(`return Task.byIdentifier(${JSON.stringify(undoTaskId)}) === null ? 'gone' : 'still-there';`);
  check('undo removed the just-created task', undone === 'gone', undone);
  if (undone !== 'gone') cleanup.push({ id: undoTaskId, itemType: 'task' });

  // --- verified create ---
  const add = await call('add_omnifocus_task', { name: marker, note: 'Created by smoke test; will be removed.' });
  check('add_omnifocus_task verified create', !add.isError && !add.protoError && !/verified.*false/i.test(add.text),
    add.text.slice(0, 150));
  const taskId = omni(`const t = flattenedTasks.filter(t => t.name === ${JSON.stringify(marker)})[0]; return t ? t.id.primaryKey : 'NOT-FOUND';`);
  check('task exists in OmniFocus', taskId !== 'NOT-FOUND' && !taskId.startsWith('ERR'), `id=${taskId}`);
  cleanup.push({ id: taskId, itemType: 'task' });

  // --- find_similar sees it ---
  const sim = await call('find_similar_tasks', { name: `MCP smoke ${stamp} safe to delete` });
  check('find_similar_tasks finds the throwaway', !sim.isError && sim.text.includes(taskId), sim.text.slice(0, 200));

  // --- structured repetition ---
  const rep = await call('set_task_repetition', {
    task_id: taskId, frequency: 'daily', interval: 2, schedule_type: 'from_completion',
  });
  check('set_task_repetition structured (every 2 days, from completion)', !rep.isError && !rep.protoError,
    rep.text.slice(0, 200));
  const method = omni(`const t = Task.byIdentifier(${JSON.stringify(taskId)}); if (!t) return 'NOT-FOUND'; if (!t.repetitionRule) return 'NO-RULE'; const r = t.repetitionRule; return JSON.stringify({ isDueDate: r.method === Task.RepetitionMethod.DueDate, rule: r.ruleString });`);
  let methodOk = false;
  try { const m = JSON.parse(method); methodOk = m.isDueDate === true && /FREQ=DAILY/.test(m.rule) && /INTERVAL=2/.test(m.rule); } catch {}
  check('repetition rule verified live (DueDate + FREQ=DAILY;INTERVAL=2)', methodOk, method);

  // --- attachment cycle (also verifies FileWrapper field shape live) ---
  const attAdd = await call('manage_attachments', {
    operation: 'add', taskId, filename: 'smoke.txt', base64: Buffer.from(`hello from smoke ${stamp}`).toString('base64'),
  });
  check('manage_attachments add', !attAdd.isError && !attAdd.protoError, attAdd.text.slice(0, 180));
  const attList = await call('manage_attachments', { operation: 'list', taskId });
  check('manage_attachments list shows 1', !attList.isError && /smoke\.txt|1/.test(attList.text), attList.text.slice(0, 180));
  const attRead = await call('manage_attachments', { operation: 'read', taskId, index: 0 });
  const wantB64 = Buffer.from(`hello from smoke ${stamp}`).toString('base64');
  check('manage_attachments read round-trips content', !attRead.isError && attRead.text.includes(wantB64),
    attRead.text.slice(0, 180));
  const attRm = await call('manage_attachments', { operation: 'remove', taskId, index: 0 });
  check('manage_attachments remove', !attRm.isError && !attRm.protoError, attRm.text.slice(0, 150));
  const attCount = omni(`const t = Task.byIdentifier(${JSON.stringify(taskId)}); return t ? String(t.attachments.length) : 'NOT-FOUND';`);
  check('attachments empty after remove', attCount === '0', attCount);

  // --- stale-ID guard still holds ---
  const staleId = await call('remove_item', { id: 'zzz-nonexistent-id-zzz', name: marker, itemType: 'task' });
  check('stale ID does NOT fall back to name', staleId.isError === true && /not found with ID/i.test(staleId.text),
    staleId.text.slice(0, 200));

  // --- convert task -> project (second throwaway) ---
  const convName = `${marker} convertme`;
  await call('add_omnifocus_task', { name: convName, note: 'smoke conversion target' });
  const convTaskId = omni(`const t = flattenedTasks.filter(t => t.name === ${JSON.stringify(convName)})[0]; return t ? t.id.primaryKey : 'NOT-FOUND';`);
  const conv = await call('convert_task_to_project', { taskId: convTaskId });
  check('convert_task_to_project', !conv.isError && !conv.protoError, conv.text.slice(0, 200));
  const convProjId = omni(`const p = flattenedProjects.filter(p => p.name === ${JSON.stringify(convName)})[0]; return p ? p.id.primaryKey : 'NOT-FOUND';`);
  check('converted project exists', convProjId !== 'NOT-FOUND' && !convProjId.startsWith('ERR'), `id=${convProjId}`);
  if (convProjId !== 'NOT-FOUND' && !convProjId.startsWith('ERR')) cleanup.push({ id: convProjId, itemType: 'project' });
  else if (convTaskId !== 'NOT-FOUND') cleanup.push({ id: convTaskId, itemType: 'task' });

  // --- review cycle (third throwaway: a project) ---
  const revName = `${marker} reviewproj`;
  await call('add_project', { name: revName });
  const revProjId = omni(`const p = flattenedProjects.filter(p => p.name === ${JSON.stringify(revName)})[0]; return p ? p.id.primaryKey : 'NOT-FOUND';`);
  check('review project created', revProjId !== 'NOT-FOUND' && !revProjId.startsWith('ERR'), `id=${revProjId}`);
  cleanup.push({ id: revProjId, itemType: 'project' });
  const sched = await call('manage_reviews', { operation: 'set_schedule', projectId: revProjId, unit: 'week', steps: 2 });
  check('manage_reviews set_schedule', !sched.isError && !sched.protoError, sched.text.slice(0, 180));
  const marked = await call('manage_reviews', { operation: 'mark_reviewed', projectId: revProjId });
  check('manage_reviews mark_reviewed verified', !marked.isError && !/verified.*false/i.test(marked.text),
    marked.text.slice(0, 200));
  const revDates = omni(`const p = Project.byIdentifier(${JSON.stringify(revProjId)}); if (!p) return 'NOT-FOUND'; const days = Math.round((p.nextReviewDate - p.lastReviewDate) / 86400000); return JSON.stringify({ days, unit: p.reviewInterval.unit, steps: p.reviewInterval.steps });`);
  let revOk = false;
  // 13 or 14: mark_reviewed may normalize the next date to local midnight,
  // which shaves partial-day hours off the raw day diff.
  try { const r = JSON.parse(revDates); revOk = (r.days === 14 || r.days === 13) && r.unit === 'weeks' && r.steps === 2; } catch {}
  check('review dates verified live (next = last + 2 weeks, interval 2 weeks)', revOk, revDates);

  // --- perspective same-value rewrite (zero net change) ---
  const perspName = omni(`const c = Perspective.Custom.all; return c.length > 0 ? c[0].name : 'NONE';`);
  if (perspName !== 'NONE' && !perspName.startsWith('ERR')) {
    const before = omni(`const p = Perspective.Custom.byName(${JSON.stringify(perspName)}); return JSON.stringify(p.archivedFilterRules);`);
    const rules = JSON.parse(before);
    const rewrite = await call('update_perspective_rules', { perspectiveName: perspName, rules });
    check('update_perspective_rules same-value rewrite verified', !rewrite.isError && /verified|✅|success/i.test(rewrite.text),
      rewrite.text.slice(0, 200));
    const after = omni(`const p = Perspective.Custom.byName(${JSON.stringify(perspName)}); return JSON.stringify(p.archivedFilterRules);`);
    check('perspective rules byte-identical after rewrite', JSON.stringify(JSON.parse(after)) === JSON.stringify(rules),
      `before=${before.slice(0, 80)} after=${after.slice(0, 80)}`);
  } else {
    console.log('INFO: no custom perspectives — rewrite check skipped');
  }

  // --- focus cycle (only from a clean empty-focus state) ---
  const focusBefore = omni(`return document.windows.length === 0 ? 'NO-WINDOW' : String(document.windows[0].focus.length);`);
  if (focusBefore === '0') {
    const folderName = omni(`return flattenedFolders.length > 0 ? flattenedFolders[0].name : 'NONE';`);
    if (folderName !== 'NONE') {
      const setF = await call('app_control', { operation: 'set_focus', folderNames: [folderName] });
      check('app_control set_focus', !setF.isError && !setF.protoError, setF.text.slice(0, 150));
      const getF = await call('app_control', { operation: 'get_focus' });
      check('get_focus shows the folder', getF.text.includes(folderName), getF.text.slice(0, 150));
      const clearF = await call('app_control', { operation: 'clear_focus' });
      check('app_control clear_focus restores empty focus', !clearF.isError &&
        omni(`return String(document.windows[0].focus.length);`) === '0', clearF.text.slice(0, 120));
    }
  } else {
    console.log(`INFO: focus not empty or no window (${focusBefore}) — focus cycle skipped to avoid disturbing state`);
  }

  // --- cleanup everything we created (tolerate objects a coalesced undo or
  // background sync already removed) ---
  for (const item of cleanup) {
    if (!item.id || item.id === 'NOT-FOUND' || item.id.startsWith('ERR')) continue;
    const cls = item.itemType === 'project' ? 'Project' : 'Task';
    const exists = omni(`return ${cls}.byIdentifier(${JSON.stringify(item.id)}) !== null ? 'yes' : 'no';`);
    if (exists !== 'yes') {
      console.log(`INFO: ${item.itemType} ${item.id} already gone — cleanup skipped`);
      continue;
    }
    const rm = await call('remove_item', { id: item.id, itemType: item.itemType });
    check(`cleanup ${item.itemType} ${item.id}`, !rm.isError && !rm.protoError, rm.text.slice(0, 100));
  }
  const leftovers = omni(`return String(flattenedTasks.filter(t => t.name.indexOf('MCP smoke ${stamp}') === 0).length + flattenedProjects.filter(p => p.name.indexOf('MCP smoke ${stamp}') === 0).length);`);
  check('zero smoke leftovers in database', leftovers === '0', `leftovers=${leftovers}`);

  // --- sync once at the end, per our own guidance ---
  const sync = await call('app_control', { operation: 'sync' });
  check('app_control sync', !sync.isError && !sync.protoError, sync.text.slice(0, 100));
}

check('no stdout pollution', nonJsonLines === 0, `${nonJsonLines} non-JSON lines`);
console.log(failures.length === 0 ? 'SMOKE: ALL PASS' : `SMOKE: ${failures.length} FAILURES: ${failures.join('; ')}`);
if (stderrBuf.trim()) console.log(`STDERR (first 300): ${stderrBuf.slice(0, 300)}`);
proc.kill();
process.exit(failures.length === 0 ? 0 : 1);
