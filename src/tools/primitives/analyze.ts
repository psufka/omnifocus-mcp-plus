import { OMNIJS_TASK_QUERY_HELPERS } from '../../utils/taskQueryHelpers.js';
import { runOmniJs } from '../../utils/scriptExecution.js';

/**
 * analyze — read-only database analytics.
 *
 * Design principle: EVIDENCE, NOT JUDGMENT. Every analysis returns counts,
 * rates, lists and dates. There are deliberately no health scores, no
 * "insights" strings and no recommendations — the calling model does the
 * judging, and inventing a verdict here would launder an opinion as data.
 *
 * Two independent signals are always reported side by side rather than merged
 * (see stalled_projects), for the same reason.
 *
 * Every date the caller sees is rendered in LOCAL time by the Node side; the
 * OmniJS script serializes dates as ISO (the wire format) and nothing else.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnalysisKind =
  | 'health_snapshot'
  | 'velocity'
  | 'overdue_clusters'
  | 'stalled_projects';

export interface AnalyzeParams {
  includeProjectRoots?: boolean;
  dateMode?: 'direct' | 'effective';
  analysis: AnalysisKind;
  velocity?: { days?: number };
  overdueClusters?: { topN?: number };
  stalledProjects?: { inactiveDays?: number; includeOnHold?: boolean };
}

export interface AnalyzeResult {
  success: boolean;
  analysis: AnalysisKind;
  markdown?: string;
  error?: string;
}

/** Injection seam so unit tests can exercise the renderers without OmniFocus. */
export interface AnalyzeDeps {
  runOmniJs: (
    script: string,
    args?: Record<string, any>,
    options?: { readOnly?: boolean }
  ) => Promise<any>;
}

export const DEFAULT_VELOCITY_DAYS = 14;
export const DEFAULT_OVERDUE_TOP_N = 10;
export const DEFAULT_INACTIVE_DAYS = 30;

/** Stalled-project rows are capped so a neglected database cannot flood the reply. */
export const STALLED_PROJECT_ROW_CAP = 50;

// ---------------------------------------------------------------------------
// OmniJS script — ONE evaluation per call, branching on args.analysis.
//
// Written without backticks, `$` or backslashes so the runOmniJs escaping
// round-trip has nothing to transform. All user-supplied values arrive through
// the injected `args` object; nothing is interpolated into the source.
// ---------------------------------------------------------------------------

export const ANALYZE_SCRIPT = `
  ${OMNIJS_TASK_QUERY_HELPERS}
  function __isFinished(t) {
    return t.taskStatus === Task.Status.Completed || t.taskStatus === Task.Status.Dropped;
  }

  function __iso(d) { return d ? d.toISOString() : null; }

  function __startOfToday() {
    var d = new Date(now.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Local-calendar arithmetic, not fixed-millisecond arithmetic: a 24h step is
  // wrong across a DST transition.
  function __midnightDaysAgo(n) {
    var d = __startOfToday();
    d.setDate(d.getDate() - n);
    return d;
  }

  // Both endpoints are inclusive. Future-dated imports or edits are not
  // observed activity, even when their timestamp is later on the same day.
  function __inObservedWindow(date, start) {
    return date && date >= start && date <= now;
  }

  function __folderPath(project) {
    var parts = [];
    var f = project.parentFolder;
    while (f) { parts.unshift(f.name); f = f.parent; }
    return parts.join(' / ');
  }

  var FAR_FUTURE_MS = 8640000000000000;
  var RECORD_CAP = 5000;

  var analysis = args.analysis;
  var now = new Date();
  var allTasks = __queryTasks(args.includeProjectRoots);

  if (analysis === 'health_snapshot') {
    var incomplete = allTasks.filter(function (t) { return !__isFinished(t); });
    var todayStart = __startOfToday();
    var tomorrowStart = __startOfToday();
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    // 7 local days INCLUDING today.
    var completedWindowStart = __midnightDaysAgo(6);

    var overdue = 0, dueToday = 0, flagged = 0, untagged = 0, noEstimate = 0, inboxIncomplete = 0;
    incomplete.forEach(function (t) {
      var due = __queryDate(t, 'dueDate', args.dateMode || 'direct');
      if (due) {
        if (due < now) { overdue++; }
        if (due >= todayStart && due < tomorrowStart) { dueToday++; }
      }
      if (t.flagged) { flagged++; }
      if (t.tags.length === 0) { untagged++; }
      if (t.estimatedMinutes === null || t.estimatedMinutes === undefined) { noEstimate++; }
      if (t.inInbox === true) { inboxIncomplete++; }
    });

    var completedRecent = 0;
    allTasks.forEach(function (t) {
      if (__inObservedWindow(t.completionDate, completedWindowStart)) { completedRecent++; }
    });

    var pActive = 0, pOnHold = 0, pDone = 0, pDropped = 0, pNoNext = 0;
    flattenedProjects.forEach(function (p) {
      if (p.status === Project.Status.Active) {
        pActive++;
        if (p.nextTask === null) { pNoNext++; }
      } else if (p.status === Project.Status.OnHold) { pOnHold++; }
      else if (p.status === Project.Status.Done) { pDone++; }
      else if (p.status === Project.Status.Dropped) { pDropped++; }
    });

    return JSON.stringify({
      success: true,
      dateMode: args.dateMode || 'direct', includeProjectRoots: args.includeProjectRoots === true,
      analysis: 'health_snapshot',
      generatedIso: __iso(now),
      completedWindowStartIso: __iso(completedWindowStart),
      completedWindowEndIso: __iso(now),
      inboxIncomplete: inboxIncomplete,
      incompleteTotal: incomplete.length,
      overdue: overdue,
      dueToday: dueToday,
      flaggedIncomplete: flagged,
      untaggedIncomplete: untagged,
      noEstimateIncomplete: noEstimate,
      completedLast7Days: completedRecent,
      projects: {
        active: pActive,
        onHold: pOnHold,
        done: pDone,
        dropped: pDropped,
        total: flattenedProjects.length
      },
      activeProjectsNoNextAction: pNoNext
    });
  }

  if (analysis === 'velocity') {
    var days = args.days;
    var windowStart = __midnightDaysAgo(days - 1);
    var completedRecords = [];
    var createdStamps = [];
    var completedTruncated = false;
    var createdTruncated = false;

    allTasks.forEach(function (t) {
      var c = t.completionDate;
      if (__inObservedWindow(c, windowStart)) {
        if (completedRecords.length < RECORD_CAP) {
          // repeating: a repeating task's completed instance is materialized AT
          // completion time (verified live: added lands a few hundred ms AFTER
          // completionDate), so its age is not a real creation-to-completion
          // time. Flagged here; the Node side excludes it from the median and
          // says so rather than silently dropping it.
          completedRecords.push({
            completedIso: __iso(c),
            addedIso: __iso(t.added),
            repeating: t.repetitionRule ? true : false
          });
        } else { completedTruncated = true; }
      }
      var a = t.added;
      if (__inObservedWindow(a, windowStart)) {
        if (createdStamps.length < RECORD_CAP) { createdStamps.push(__iso(a)); }
        else { createdTruncated = true; }
      }
    });

    return JSON.stringify({
      success: true,
      dateMode: args.dateMode || 'direct', includeProjectRoots: args.includeProjectRoots === true,
      analysis: 'velocity',
      days: days,
      windowStartIso: __iso(windowStart),
      windowEndIso: __iso(now),
      generatedIso: __iso(now),
      completed: completedRecords,
      created: createdStamps,
      truncated: completedTruncated || createdTruncated
    });
  }

  if (analysis === 'overdue_clusters') {
    var byProject = {};
    var byTag = {};
    var untaggedOverdue = 0;
    var totalOverdue = 0;

    allTasks.forEach(function (t) {
      if (__isFinished(t)) { return; }
      var due = __queryDate(t, 'dueDate', args.dateMode || 'direct');
      if (!due || due >= now) { return; }
      totalOverdue++;
      var ms = due.getTime();

      var cp = t.containingProject;
      var pKey = cp ? cp.id.primaryKey : '__inbox__';
      var pEntry = byProject[pKey];
      if (!pEntry) {
        pEntry = { id: cp ? cp.id.primaryKey : null, name: cp ? cp.name : 'Inbox', count: 0, oldestMs: FAR_FUTURE_MS, oldestIso: null };
        byProject[pKey] = pEntry;
      }
      pEntry.count++;
      if (ms < pEntry.oldestMs) { pEntry.oldestMs = ms; pEntry.oldestIso = __iso(due); }

      var tags = t.tags;
      if (tags.length === 0) { untaggedOverdue++; }
      tags.forEach(function (tag) {
        var tKey = tag.id.primaryKey;
        var tEntry = byTag[tKey];
        if (!tEntry) {
          tEntry = { id: tKey, name: tag.name, count: 0, oldestMs: FAR_FUTURE_MS, oldestIso: null };
          byTag[tKey] = tEntry;
        }
        tEntry.count++;
        if (ms < tEntry.oldestMs) { tEntry.oldestMs = ms; tEntry.oldestIso = __iso(due); }
      });
    });

    function __toSortedList(map) {
      var keys = Object.getOwnPropertyNames(map);
      var list = keys.map(function (k) {
        var e = map[k];
        return { id: e.id, name: e.name, count: e.count, oldestDueIso: e.oldestIso, oldestMs: e.oldestMs };
      });
      list.sort(function (a, b) {
        if (b.count !== a.count) { return b.count - a.count; }
        return a.oldestMs - b.oldestMs;
      });
      return list.map(function (e) {
        return { id: e.id, name: e.name, count: e.count, oldestDueIso: e.oldestDueIso };
      });
    }

    return JSON.stringify({
      success: true,
      dateMode: args.dateMode || 'direct', includeProjectRoots: args.includeProjectRoots === true,
      analysis: 'overdue_clusters',
      generatedIso: __iso(now),
      totalOverdue: totalOverdue,
      untaggedOverdue: untaggedOverdue,
      byProject: __toSortedList(byProject),
      byTag: __toSortedList(byTag)
    });
  }

  if (analysis === 'stalled_projects') {
    var inactiveDays = args.inactiveDays;
    var includeOnHold = args.includeOnHold === true;
    var threshold = __midnightDaysAgo(inactiveDays);
    var scanned = 0;
    var rows = [];

    flattenedProjects.forEach(function (p) {
      var isActive = p.status === Project.Status.Active;
      var isOnHold = p.status === Project.Status.OnHold;
      if (!isActive && !(includeOnHold && isOnHold)) { return; }
      scanned++;

      // Project itself has no .modified — the root task shares the project's
      // primaryKey and carries the timestamps.
      var root = p.task;
      var lastActivity = root ? root.modified : null;
      var noNextAction = p.nextTask === null;
      var stale = lastActivity ? lastActivity < threshold : false;
      if (!noNextAction && !stale) { return; }

      var remaining = 0;
      // Same root-task exclusion every other task count uses: a project root
      // task is a member of flattenedTasks and would inflate the remaining
      // count by one for every project.
      p.flattenedTasks.forEach(function (t) { if (__isRealTask(t) && !__isFinished(t)) { remaining++; } });

      rows.push({
        id: p.id.primaryKey,
        name: p.name,
        folderPath: __folderPath(p),
        status: isActive ? 'Active' : 'OnHold',
        remainingTasks: remaining,
        noNextAction: noNextAction,
        lastActivityIso: __iso(lastActivity),
        lastActivityStale: stale
      });
    });

    rows.sort(function (a, b) {
      var av = a.lastActivityIso ? Date.parse(a.lastActivityIso) : FAR_FUTURE_MS;
      var bv = b.lastActivityIso ? Date.parse(b.lastActivityIso) : FAR_FUTURE_MS;
      return av - bv;
    });

    return JSON.stringify({
      success: true,
      dateMode: args.dateMode || 'direct', includeProjectRoots: args.includeProjectRoots === true,
      analysis: 'stalled_projects',
      generatedIso: __iso(now),
      inactiveDays: inactiveDays,
      includeOnHold: includeOnHold,
      thresholdIso: __iso(threshold),
      scannedProjects: scanned,
      projects: rows
    });
  }

  return JSON.stringify({ success: false, error: 'Unknown analysis: ' + String(analysis) });
`;

// ---------------------------------------------------------------------------
// Local-time helpers (Node side). The script hands over ISO instants; every
// value the caller reads is re-rendered here in local time.
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" from a Date's LOCAL calendar fields.
 *  toISOString().slice(0, 10) buckets in UTC and pushes a 23:30 local
 *  completion into tomorrow, so it is never used for bucketing. */
export function localDayKey(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${date.getFullYear()}-${month < 10 ? '0' : ''}${month}-${day < 10 ? '0' : ''}${day}`;
}

/** Count ISO instants per LOCAL calendar day. Unparseable entries are dropped. */
export function bucketByLocalDay(isoTimestamps: Array<string | null | undefined>): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const iso of isoTimestamps) {
    if (!iso) continue;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) continue;
    const key = localDayKey(date);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return buckets;
}

const NO_VALUE = '—';

function localDate(iso: string | null | undefined): string {
  if (!iso) return NO_VALUE;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? NO_VALUE : date.toLocaleDateString();
}

function localDateTime(iso: string | null | undefined): string {
  if (!iso) return NO_VALUE;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? NO_VALUE : date.toLocaleString();
}

/** Markdown table cells break on a literal pipe or newline in a project/tag name. */
function cell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return NO_VALUE;
  return String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function round(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : NO_VALUE;
}

/** Median of a numeric list; NaN for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Renderers — pure functions over the script payload.
// ---------------------------------------------------------------------------

export function renderHealthSnapshot(data: any): string {
  const projects = data.projects ?? {};
  const lines: string[] = [];

  lines.push('# OmniFocus health snapshot');
  lines.push(`_Generated ${localDateTime(data.generatedIso)}_`);
  lines.push('');
  lines.push('| Task metric | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Inbox (incomplete) | ${data.inboxIncomplete ?? 0} |`);
  lines.push(`| Incomplete tasks (total) | ${data.incompleteTotal ?? 0} |`);
  lines.push(`| Overdue | ${data.overdue ?? 0} |`);
  lines.push(`| Due today | ${data.dueToday ?? 0} |`);
  lines.push(`| Flagged (incomplete) | ${data.flaggedIncomplete ?? 0} |`);
  lines.push(`| Untagged (incomplete) | ${data.untaggedIncomplete ?? 0} |`);
  lines.push(`| No time estimate (incomplete) | ${data.noEstimateIncomplete ?? 0} |`);
  lines.push(`| Completed in last 7 days | ${data.completedLast7Days ?? 0} |`);
  lines.push('');
  lines.push('| Project metric | Count |');
  lines.push('| --- | ---: |');
  lines.push(`| Active | ${projects.active ?? 0} |`);
  lines.push(`| On hold | ${projects.onHold ?? 0} |`);
  lines.push(`| Done | ${projects.done ?? 0} |`);
  lines.push(`| Dropped | ${projects.dropped ?? 0} |`);
  lines.push(`| All projects | ${projects.total ?? 0} |`);
  lines.push(`| Active with no next action | ${data.activeProjectsNoNextAction ?? 0} |`);
  lines.push('');
  lines.push(
    '_Definitions: project roots ' + (data.includeProjectRoots ? 'included' : 'excluded') + '. Dates: ' + (data.dateMode || 'direct') + '. "Overdue" and "Due today" overlap ' +
    'for a task whose due time already passed today. "Completed in last 7 days" counts ' +
    `completions from ${localDate(data.completedWindowStartIso)} at local midnight through the observation time above, inclusive. ` +
    '"Active with no next action" is project.nextTask === null — it means the project has remaining ' +
    'tasks but none is currently actionable. A project with no remaining tasks reports its own root ' +
    'task as nextTask, so it is NOT counted here._'
  );

  return lines.join('\n');
}

export function renderVelocity(data: any): string {
  const days: number = typeof data.days === 'number' && data.days > 0 ? data.days : DEFAULT_VELOCITY_DAYS;
  const completedRecords: any[] = Array.isArray(data.completed) ? data.completed : [];
  const createdStamps: any[] = Array.isArray(data.created) ? data.created : [];

  const completedBuckets = bucketByLocalDay(completedRecords.map(r => r?.completedIso));
  const createdBuckets = bucketByLocalDay(createdStamps);

  // Rebuild the window from its local-midnight start so a day with zero
  // activity still gets a row.
  const start = data.windowStartIso ? new Date(data.windowStartIso) : null;
  const windowStart = start && !Number.isNaN(start.getTime()) ? start : (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (days - 1));
    return d;
  })();

  const dayKeys: Array<{ key: string; date: Date }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(windowStart.getTime());
    d.setDate(windowStart.getDate() + i);
    d.setHours(0, 0, 0, 0);
    dayKeys.push({ key: localDayKey(d), date: d });
  }

  const totalCompleted = completedRecords.length;
  const totalCreated = createdStamps.length;
  const dailyAverageCompleted = totalCompleted / days;
  const backlogGrowthPerDay = (totalCreated - totalCompleted) / days;

  const completionHours: number[] = [];
  let excludedRepeating = 0;
  let excludedNoCreation = 0;
  for (const record of completedRecords) {
    if (record?.repeating === true) { excludedRepeating++; continue; }
    if (!record?.completedIso || !record?.addedIso) { excludedNoCreation++; continue; }
    const done = new Date(record.completedIso).getTime();
    const added = new Date(record.addedIso).getTime();
    if (Number.isNaN(done) || Number.isNaN(added) || done < added) { excludedNoCreation++; continue; }
    completionHours.push((done - added) / 3_600_000);
  }
  const medianHours = median(completionHours);

  const lines: string[] = [];
  lines.push(`# Velocity — trailing ${days} day${days === 1 ? '' : 's'}`);
  lines.push(`_Generated ${localDateTime(data.generatedIso)}_`);
  lines.push('');
  lines.push('| Day | Completed | Created |');
  lines.push('| --- | ---: | ---: |');
  for (const { key, date } of dayKeys) {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
    lines.push(`| ${weekday} ${date.toLocaleDateString()} | ${completedBuckets.get(key) ?? 0} | ${createdBuckets.get(key) ?? 0} |`);
  }
  lines.push('');
  const windowEnd = dayKeys.length > 0 ? dayKeys[dayKeys.length - 1].date : windowStart;
  lines.push(`- Window: ${windowStart.toLocaleDateString()} through ${windowEnd.toLocaleDateString()} (${days} local day${days === 1 ? '' : 's'}, bucketed at local midnight)`);
  lines.push(`- Completed: ${totalCompleted} · Created: ${totalCreated}`);
  lines.push(`- Daily average completed: ${round(dailyAverageCompleted, 2)}`);
  lines.push(`- Backlog growth per day: ${round(backlogGrowthPerDay, 2)} — (created − completed) / days; negative = shrinking`);
  lines.push(
    completionHours.length > 0
      ? `- Median completion time: ${round(medianHours, 1)} h (creation → completion, across ${completionHours.length} of ${totalCompleted} completed task${totalCompleted === 1 ? '' : 's'})`
      : `- Median completion time: ${NO_VALUE} (no completed task in the window had a usable creation date)`
  );
  if (excludedRepeating > 0 || excludedNoCreation > 0) {
    const parts: string[] = [];
    if (excludedRepeating > 0) {
      parts.push(`${excludedRepeating} repeating-task instance${excludedRepeating === 1 ? '' : 's'} (an instance is created at completion time, so its age is ~0)`);
    }
    if (excludedNoCreation > 0) {
      parts.push(`${excludedNoCreation} task${excludedNoCreation === 1 ? '' : 's'} with no usable creation date`);
    }
    lines.push(`- Excluded from the median: ${parts.join('; ')}`);
  }
  if (data.truncated) {
    lines.push('- ⚠️ Raw record cap reached; totals above undercount. Narrow the window with a smaller "days".');
  }
  lines.push('');
  lines.push(
    '_Definitions: days are LOCAL calendar days, ending at the observation time above; future timestamps are excluded. "Completed" buckets on completionDate, "Created" on the ' +
    'task creation date — including instances of repeating tasks, which are created each time the previous ' +
    'instance is completed. Project root tasks are excluded from both._'
  );

  return lines.join('\n');
}

export function renderOverdueClusters(data: any, topN: number = DEFAULT_OVERDUE_TOP_N): string {
  const byProject: any[] = Array.isArray(data.byProject) ? data.byProject : [];
  const byTag: any[] = Array.isArray(data.byTag) ? data.byTag : [];

  const lines: string[] = [];
  lines.push('# Overdue clusters');
  lines.push(`_Generated ${localDateTime(data.generatedIso)}_`);
  lines.push('');
  lines.push(`Overdue incomplete tasks: **${data.totalOverdue ?? 0}**`);

  if ((data.totalOverdue ?? 0) === 0) {
    lines.push('');
    lines.push('No overdue tasks.');
    return lines.join('\n');
  }

  const section = (
    heading: string,
    rows: any[],
    label: string,
    remainderNoun: string
  ): void => {
    lines.push('');
    lines.push(heading);
    if (rows.length === 0) {
      lines.push('');
      lines.push(`No overdue tasks carry a ${label.toLowerCase()}.`);
      return;
    }
    lines.push('');
    lines.push(`| ${label} | Overdue | Oldest due |`);
    lines.push('| --- | ---: | --- |');
    for (const row of rows.slice(0, topN)) {
      lines.push(`| ${cell(row.name)} | ${row.count ?? 0} | ${localDate(row.oldestDueIso)} |`);
    }
    const hidden = rows.slice(topN);
    if (hidden.length > 0) {
      const hiddenTasks = hidden.reduce((sum, row) => sum + (row.count ?? 0), 0);
      lines.push('');
      lines.push(`_+ ${hidden.length} more in other ${remainderNoun} (${hiddenTasks} overdue task${hiddenTasks === 1 ? '' : 's'} not shown)._`);
    }
  };

  section('## By project', byProject, 'Project', 'projects');
  section('## By tag', byTag, 'Tag', 'tags');

  lines.push('');
  lines.push(
    `_Definitions: a task counts once per project and once per each of its own tags, so the ` +
    `tag column sums to more or less than ${data.totalOverdue ?? 0}. ${data.untaggedOverdue ?? 0} overdue ` +
    `task${(data.untaggedOverdue ?? 0) === 1 ? '' : 's'} carry no tag and appear in no tag row. ` +
    `Overdue means the task's OWN due date has passed; a due date inherited from its project or ` +
    `parent (the effective due date) is not counted. ` +
    `Tags are the task's own tags, not tags inherited from a parent. Tasks with no project are grouped as "Inbox"._`
  );

  return lines.join('\n');
}

export function renderStalledProjects(data: any): string {
  const projects: any[] = Array.isArray(data.projects) ? data.projects : [];
  const inactiveDays = data.inactiveDays ?? DEFAULT_INACTIVE_DAYS;

  const lines: string[] = [];
  lines.push('# Stalled-project signals');
  lines.push(`_Generated ${localDateTime(data.generatedIso)}_`);
  lines.push('');
  lines.push(
    `Scope: ${data.includeOnHold ? 'Active + on-hold' : 'Active'} projects ` +
    `(${data.scannedProjects ?? 0} scanned) · inactivity threshold ${inactiveDays} day${inactiveDays === 1 ? '' : 's'} ` +
    `(last activity before ${localDate(data.thresholdIso)})`
  );

  if (projects.length === 0) {
    lines.push('');
    lines.push('No project fired either signal.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('| Project | id | Folder | Remaining | No next action | Last activity | Inactive ≥ threshold |');
  lines.push('| --- | --- | --- | ---: | :-: | --- | :-: |');
  for (const project of projects.slice(0, STALLED_PROJECT_ROW_CAP)) {
    lines.push(
      `| ${cell(project.name)} | ${cell(project.id)} | ${cell(project.folderPath)} | ${project.remainingTasks ?? 0} ` +
      `| ${project.noNextAction ? 'yes' : 'no'} | ${localDate(project.lastActivityIso)} ` +
      `| ${project.lastActivityStale ? 'yes' : 'no'} |`
    );
  }
  const hidden = projects.length - STALLED_PROJECT_ROW_CAP;
  if (hidden > 0) {
    lines.push('');
    lines.push(`_+ ${hidden} more project${hidden === 1 ? '' : 's'} matched but are not shown (cap ${STALLED_PROJECT_ROW_CAP})._`);
  }

  lines.push('');
  lines.push(
    '_Definitions: the two signal columns are INDEPENDENT, not a combined verdict. ' +
    '"No next action" is project.nextTask === null — it means the project has remaining tasks but ' +
    'none is currently actionable. A project with Remaining 0 reports its own root task as nextTask, ' +
    'so it shows "no" here; read the two columns against Remaining. "Last activity" is the ' +
    'modification date of the project\'s root task (Project itself carries no modification date). ' +
    'A project is listed when EITHER signal fires; rows are sorted oldest activity first._'
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildScriptArgs(params: AnalyzeParams): Record<string, any> {
  return {
    dateMode: params.dateMode || 'direct',
    includeProjectRoots: params.includeProjectRoots === true,
    analysis: params.analysis,
    days: params.velocity?.days ?? DEFAULT_VELOCITY_DAYS,
    inactiveDays: params.stalledProjects?.inactiveDays ?? DEFAULT_INACTIVE_DAYS,
    includeOnHold: params.stalledProjects?.includeOnHold ?? false
  };
}

export function renderAnalysis(params: AnalyzeParams, data: any): string {
  switch (params.analysis) {
    case 'health_snapshot':
      return renderHealthSnapshot(data);
    case 'velocity':
      return renderVelocity(data);
    case 'overdue_clusters':
      return renderOverdueClusters(data, params.overdueClusters?.topN ?? DEFAULT_OVERDUE_TOP_N);
    case 'stalled_projects':
      return renderStalledProjects(data);
    default:
      return `Unknown analysis: ${String(params.analysis)}`;
  }
}

export async function analyze(
  params: AnalyzeParams,
  deps: AnalyzeDeps = { runOmniJs }
): Promise<AnalyzeResult> {
  const result = await deps.runOmniJs(ANALYZE_SCRIPT, buildScriptArgs(params), { readOnly: true });

  if (!result || result.success !== true) {
    return {
      success: false,
      analysis: params.analysis,
      error: result?.error ? String(result.error) : 'OmniFocus returned no analysis data'
    };
  }

  return { success: true, analysis: params.analysis, markdown: renderAnalysis(params, result) };
}
