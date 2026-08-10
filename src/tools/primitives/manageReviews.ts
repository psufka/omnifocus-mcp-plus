import { runOmniJs } from '../../utils/scriptExecution.js';
import { OMNIJS_LOOKUP_HELPERS } from '../../utils/omniJsHelpers.js';

/**
 * Project review support (OmniFocus "Review" perspective).
 *
 * Three operations behind one tool:
 *   list_due     — projects whose nextReviewDate has arrived (read-only)
 *   mark_reviewed— stamp lastReviewDate and advance nextReviewDate
 *   set_schedule — set a project's review interval
 *
 * Verified OmniJS facts this file depends on (probed live, OmniFocus 4.8.13):
 *   - There is NO markReviewed()/markProjectReviewed() API anywhere. Reviewing
 *     a project means assigning `lastReviewDate` and `nextReviewDate`; both
 *     setters exist.
 *   - `project.reviewInterval` is a plain object `{unit: string, steps: number}`
 *     where unit is a PLURAL string ('days' | 'weeks' | 'months' | 'years').
 *     `JSON.stringify(reviewInterval)` returns `{}` — the fields must be read
 *     explicitly via `.unit` / `.steps`.
 *   - `project.taskStatus` EXISTS on a Project and reports the ROOT TASK's
 *     status ("Blocked"/"Next"), not the project status. The shared
 *     `__statusLabel` helper prefers taskStatus, so review code reads
 *     `String(project.status)` through its own `__projectStatusLabel`.
 *   - Review dates in the database are stored at local midnight (OmniFocus
 *     treats reviews as day-granular), so post-write verification compares
 *     calendar days rather than exact timestamps.
 */

export type ManageReviewsOperation = 'list_due' | 'mark_reviewed' | 'set_schedule';

/** Singular units accepted from callers; OmniFocus stores the plural form. */
export type ReviewIntervalUnit = 'day' | 'week' | 'month' | 'year';

export interface ReviewInterval {
  unit: string | null;
  steps: number | null;
}

export interface ReviewProjectRow {
  id: string;
  name: string;
  status: string;
  folder: string | null;
  reviewInterval: ReviewInterval | null;
  nextReviewDate: string | null;
  lastReviewDate: string | null;
  /** nextReviewDate has already arrived (<= now). */
  dueForReview: boolean;
}

export interface MarkReviewedRow {
  index: number;
  success: boolean;
  id?: string;
  name?: string;
  previousLastReviewDate?: string | null;
  previousNextReviewDate?: string | null;
  newLastReviewDate?: string | null;
  newNextReviewDate?: string | null;
  reviewInterval?: ReviewInterval | null;
  /** false when the project has no review interval to advance from. */
  nextComputed?: boolean;
  verified?: boolean;
  warnings?: string[];
  error?: string;
}

export interface SetScheduleResult {
  id: string;
  name: string;
  previousInterval: ReviewInterval | null;
  reviewInterval: ReviewInterval | null;
  nextReviewDate: string | null;
  verified: boolean;
}

export interface ManageReviewsParams {
  operation: ManageReviewsOperation;
  // list_due
  all?: boolean;
  includeOnHold?: boolean;
  // mark_reviewed (single) + set_schedule
  projectId?: string;
  projectName?: string;
  // mark_reviewed (batch)
  projectIds?: string[];
  // set_schedule
  unit?: ReviewIntervalUnit;
  steps?: number;
}

export interface ManageReviewsResult {
  success: boolean;
  operation: ManageReviewsOperation;
  /** list_due */
  projects?: ReviewProjectRow[];
  scanned?: number;
  /** mark_reviewed */
  results?: MarkReviewedRow[];
  /** set_schedule */
  project?: SetScheduleResult;
  error?: string;
}

export const MAX_REVIEW_BATCH = 100;

/** Caller-facing singular unit -> the plural string OmniFocus stores. */
export const REVIEW_UNIT_PLURAL: Record<ReviewIntervalUnit, string> = {
  day: 'days',
  week: 'weeks',
  month: 'months',
  year: 'years'
};

/**
 * Cross-field validation, shared with the tool schema's refinements so the
 * primitive is safe to call directly (batch tools and tests do).
 */
export function validateManageReviewsParams(params: ManageReviewsParams): { valid: boolean; error?: string } {
  const hasSingle = Boolean(params.projectId || params.projectName);
  const hasBatch = Array.isArray(params.projectIds) && params.projectIds.length > 0;

  if (params.operation === 'list_due') {
    if (hasSingle || hasBatch) {
      return { valid: false, error: 'list_due does not take a project — it scans every reviewable project. Drop projectId/projectName/projectIds.' };
    }
    if (params.unit !== undefined || params.steps !== undefined) {
      return { valid: false, error: 'unit and steps are only supported when operation is "set_schedule".' };
    }
    return { valid: true };
  }

  if (params.all !== undefined || params.includeOnHold !== undefined) {
    return { valid: false, error: 'all and includeOnHold are only supported when operation is "list_due".' };
  }

  if (params.operation === 'mark_reviewed') {
    if (params.unit !== undefined || params.steps !== undefined) {
      return { valid: false, error: 'unit and steps are only supported when operation is "set_schedule". mark_reviewed advances by the project\'s existing review interval.' };
    }
    if (hasSingle && hasBatch) {
      return { valid: false, error: 'Cannot combine projectIds with projectId/projectName. Use projectIds for a batch, or projectId/projectName for one project.' };
    }
    if (!hasSingle && !hasBatch) {
      return { valid: false, error: 'mark_reviewed needs a project: pass projectId, projectName, or projectIds.' };
    }
    if (params.projectId && params.projectName) {
      return { valid: false, error: 'Cannot specify both projectId and projectName. Please use only one.' };
    }
    if (hasBatch && (params.projectIds as string[]).length > MAX_REVIEW_BATCH) {
      return { valid: false, error: `projectIds accepts at most ${MAX_REVIEW_BATCH} ids per call (got ${(params.projectIds as string[]).length}).` };
    }
    return { valid: true };
  }

  // set_schedule
  if (hasBatch) {
    return { valid: false, error: 'set_schedule applies to one project — use projectId or projectName, not projectIds.' };
  }
  if (!hasSingle) {
    return { valid: false, error: 'set_schedule needs a project: pass projectId or projectName.' };
  }
  if (params.projectId && params.projectName) {
    return { valid: false, error: 'Cannot specify both projectId and projectName. Please use only one.' };
  }
  if (!params.unit) {
    return { valid: false, error: 'set_schedule requires unit (day, week, month, or year).' };
  }
  if (params.steps === undefined) {
    return { valid: false, error: 'set_schedule requires steps (a whole number >= 1).' };
  }
  if (!Number.isInteger(params.steps) || params.steps < 1) {
    return { valid: false, error: 'steps must be a whole number >= 1.' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Shared OmniJS review helpers. Written without template literals, backticks,
// `$` or backslashes so the runOmniJs escaping layer has nothing to transform.
// ---------------------------------------------------------------------------
const REVIEW_HELPERS = `
  // Project.status stringifies as "[object Project.Status: Active]". The shared
  // __statusLabel prefers taskStatus, which on a Project is the ROOT TASK status
  // (Blocked/Next) — useless for reviews, so parse status directly.
  function __projectStatusLabel(p) {
    try {
      var s = String(p.status);
      var i = s.indexOf(': ');
      if (i >= 0 && s.charAt(s.length - 1) === ']') { return s.slice(i + 2, -1); }
      return '';
    } catch (e) { return ''; }
  }

  // reviewInterval JSON.stringifies to {} — read .unit / .steps explicitly.
  function __readInterval(p) {
    try {
      var ri = p.reviewInterval;
      if (!ri) { return null; }
      var unit = (ri.unit === undefined || ri.unit === null) ? null : String(ri.unit);
      var steps = (typeof ri.steps === 'number') ? ri.steps : null;
      if (unit === null && steps === null) { return null; }
      return { unit: unit, steps: steps };
    } catch (e) { return null; }
  }

  function __isoOrNull(d) {
    try { return d ? d.toISOString() : null; } catch (e) { return null; }
  }

  // Calendar-month arithmetic with end-of-month clamping: Jan 31 + 1 month is
  // Feb 28/29, never Mar 3 (which is what adding 30 days would give).
  function __addMonths(base, n) {
    var day = base.getDate();
    var d = new Date(base.getTime());
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(day < lastDay ? day : lastDay);
    return d;
  }

  // steps x unit from base. Unit is OmniFocus's plural string; matched by
  // prefix so a singular spelling from an older build still resolves.
  function __addInterval(base, unit, steps) {
    if (!unit) { return null; }
    if (typeof steps !== 'number' || !isFinite(steps) || steps < 1) { return null; }
    var u = String(unit).toLowerCase();
    var d = new Date(base.getTime());
    if (u.indexOf('day') === 0) { d.setDate(d.getDate() + steps); return d; }
    if (u.indexOf('week') === 0) { d.setDate(d.getDate() + (steps * 7)); return d; }
    if (u.indexOf('month') === 0) { return __addMonths(d, steps); }
    if (u.indexOf('year') === 0) { return __addMonths(d, steps * 12); }
    return null;
  }

  // Strict same-local-day comparison, with no slack in either direction.
  // OmniFocus normalizes review dates to local midnight, so the NEXT review
  // date is compared by calendar day rather than by timestamp.
  function __sameReviewDay(a, b) {
    if (!a || !b) { return false; }
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // lastReviewDate is checked much harder than the next date, because it is the
  // one a NO-OP would pass: a project reviewed yesterday (or an hour ago) still
  // carries a plausible-looking lastReviewDate, and a plus-or-minus-day window
  // would call that a verified write. It must look like it was written just
  // now: within a few minutes, or exactly local midnight TODAY for a build that
  // truncates the stamp to the day (in which case within-the-day is the best
  // any check can do — the resolution simply is not there).
  var __REVIEW_STAMP_SLACK_MS = 300000; // 5 minutes

  function __reviewStampIsFresh(stamp, now) {
    if (!stamp || !now) { return false; }
    if (Math.abs(stamp.getTime() - now.getTime()) <= __REVIEW_STAMP_SLACK_MS) { return true; }
    var truncatedToMidnight = stamp.getHours() === 0 && stamp.getMinutes() === 0 &&
      stamp.getSeconds() === 0 && stamp.getMilliseconds() === 0;
    return truncatedToMidnight && __sameReviewDay(stamp, now);
  }
`;

/** Read-only scan of every reviewable project. */
export const LIST_DUE_REVIEWS_SCRIPT = `
  ${REVIEW_HELPERS}

  const nowMs = new Date().getTime();
  const includeOnHold = args.includeOnHold !== false;
  const wantAll = args.all === true;
  const projects = flattenedProjects;
  const rows = [];

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const status = __projectStatusLabel(p);

    // Finished projects are never reviewable.
    if (status === 'Done' || status === 'Completed' || status === 'Dropped') { continue; }
    if (status === 'OnHold' && !includeOnHold) { continue; }

    const interval = __readInterval(p);
    const next = __isoOrNull(p.nextReviewDate);
    const last = __isoOrNull(p.lastReviewDate);

    // "Review info" = an interval or any review date. A project with none has
    // never been put on a review cycle and would be noise in either mode.
    if (interval === null && next === null && last === null) { continue; }

    const dueForReview = next !== null && new Date(next).getTime() <= nowMs;
    if (!wantAll && !dueForReview) { continue; }

    let folderName = null;
    try { folderName = p.parentFolder ? p.parentFolder.name : null; } catch (e) { folderName = null; }

    rows.push({
      id: p.id.primaryKey,
      name: p.name,
      status: status,
      folder: folderName,
      reviewInterval: interval,
      nextReviewDate: next,
      lastReviewDate: last,
      dueForReview: dueForReview
    });
  }

  return JSON.stringify({ success: true, projects: rows, scanned: projects.length });
`;

/**
 * Stamp lastReviewDate and advance nextReviewDate for one or many projects.
 * ONE script per call — background sync mutates the database between script
 * invocations, so a read-modify-write split across calls is never safe.
 */
export const MARK_REVIEWED_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${REVIEW_HELPERS}

  const now = new Date();
  const specs = args.projects || [];
  const results = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    try {
      const lookup = __resolveByIdOrName(flattenedProjects, spec.id || null, spec.name || null, 'Project');
      if (lookup.error) {
        results.push({ index: i, success: false, id: spec.id, name: spec.name, verified: false, error: lookup.error });
        continue;
      }

      const p = lookup.item;
      const projectId = p.id.primaryKey;
      const projectName = p.name;
      const previousLast = __isoOrNull(p.lastReviewDate);
      const previousNext = __isoOrNull(p.nextReviewDate);
      const interval = __readInterval(p);
      const computedNext = interval ? __addInterval(now, interval.unit, interval.steps) : null;
      const warnings = [];

      // OmniJS has no mark-reviewed method of any kind — reviewing a project IS
      // these two date writes. lastReviewDate goes first: if a build auto-derives
      // the next date from it, the explicit assignment below still wins.
      p.lastReviewDate = now;
      if (computedNext) { p.nextReviewDate = computedNext; }

      if (interval === null) {
        warnings.push('Project has no review interval — lastReviewDate was stamped but nextReviewDate could not be computed. Use operation "set_schedule" to give it a review cycle.');
      } else if (computedNext === null) {
        warnings.push('Unrecognized review interval (' + String(interval.steps) + ' ' + String(interval.unit) + ') — lastReviewDate was stamped but nextReviewDate could not be computed.');
      }

      const newLast = __isoOrNull(p.lastReviewDate);
      const newNext = __isoOrNull(p.nextReviewDate);
      // lastReviewDate must look freshly stamped; nextReviewDate must be the
      // exact day this run computed. Anything looser passes a write that never
      // happened.
      const lastOk = newLast !== null && __reviewStampIsFresh(new Date(newLast), now);
      const nextOk = computedNext === null ? true : (newNext !== null && __sameReviewDay(new Date(newNext), computedNext));
      const verified = lastOk && nextOk;

      let failure = undefined;
      if (!verified) {
        failure = 'Review dates did not verify after writing: lastReviewDate read back as ' +
          (newLast === null ? 'null' : new Date(newLast).toLocaleString()) +
          ' (expected about ' + now.toLocaleString() + ')' +
          (computedNext === null ? '' : ', nextReviewDate read back as ' +
            (newNext === null ? 'null' : new Date(newNext).toLocaleString()) +
            ' (expected ' + computedNext.toLocaleString() + ')') +
          '. The project may not have been marked reviewed.';
      }

      results.push({
        index: i,
        success: verified,
        id: projectId,
        name: projectName,
        previousLastReviewDate: previousLast,
        previousNextReviewDate: previousNext,
        newLastReviewDate: newLast,
        newNextReviewDate: newNext,
        reviewInterval: interval,
        nextComputed: computedNext !== null,
        verified: verified,
        warnings: warnings,
        error: failure
      });
    } catch (e) {
      results.push({
        index: i,
        success: false,
        id: spec.id,
        name: spec.name,
        verified: false,
        error: (e && e.message) ? e.message : 'Unknown error marking project reviewed'
      });
    }
  }

  return JSON.stringify({ success: true, results: results });
`;

/**
 * Assign a project's review interval. The write shape `{unit, steps}` is
 * verified only as a READ shape, so the assignment is read back and compared;
 * a silent no-op is reported as an error rather than as success.
 */
export const SET_REVIEW_SCHEDULE_SCRIPT = `
  ${OMNIJS_LOOKUP_HELPERS}
  ${REVIEW_HELPERS}

  const lookup = __resolveByIdOrName(flattenedProjects, args.projectId || null, args.projectName || null, 'Project');
  if (lookup.error) {
    return JSON.stringify({ success: false, error: lookup.error });
  }

  const project = lookup.item;
  const previous = __readInterval(project);

  // Compare 'week' and 'weeks' as equal: the caller sends the plural form
  // OmniFocus uses, but a build that normalizes differently must not be
  // mistaken for a failed write.
  function __normUnit(u) {
    var s = String(u === null || u === undefined ? '' : u).toLowerCase();
    return (s.charAt(s.length - 1) === 's') ? s.slice(0, -1) : s;
  }

  try {
    // OmniFocus only accepts a Project.ReviewInterval value here — a plain
    // {unit, steps} object throws. The type has no public constructor, so use
    // the documented idiom: reading .reviewInterval returns a mutable copy;
    // set its fields and assign it back. New projects always carry a default
    // interval; if this one somehow has none, borrow a copy from any
    // scheduled project.
    var writeInterval = project.reviewInterval;
    if (writeInterval === null || writeInterval === undefined) {
      var donor = flattenedProjects.filter(function (q) {
        return q.reviewInterval !== null && q.reviewInterval !== undefined;
      })[0];
      if (donor) { writeInterval = donor.reviewInterval; }
    }
    if (writeInterval === null || writeInterval === undefined) {
      return JSON.stringify({
        success: false,
        verified: false,
        error: 'Cannot obtain a Project.ReviewInterval instance: this project has no existing interval and no other project has one to copy. Set any review interval once in the OmniFocus UI, then retry.'
      });
    }
    writeInterval.unit = args.unit;
    writeInterval.steps = args.steps;
    project.reviewInterval = writeInterval;
  } catch (e) {
    return JSON.stringify({
      success: false,
      verified: false,
      error: 'Assigning reviewInterval threw: ' + ((e && e.message) ? e.message : String(e))
    });
  }

  const actual = __readInterval(project);
  const verified = actual !== null && __normUnit(actual.unit) === __normUnit(args.unit) && actual.steps === args.steps;

  if (!verified) {
    return JSON.stringify({
      success: false,
      verified: false,
      id: project.id.primaryKey,
      name: project.name,
      previousInterval: previous,
      reviewInterval: actual,
      error: 'reviewInterval assignment did not stick: requested ' + String(args.steps) + ' ' + String(args.unit) +
        ' but the project reads back as ' + (actual === null ? 'no interval' : (String(actual.steps) + ' ' + String(actual.unit))) +
        '. The review schedule was NOT changed.'
    });
  }

  return JSON.stringify({
    success: true,
    verified: true,
    id: project.id.primaryKey,
    name: project.name,
    previousInterval: previous,
    reviewInterval: actual,
    nextReviewDate: __isoOrNull(project.nextReviewDate)
  });
`;

/** nextReviewDate ascending; projects with no next date sort last. */
function byNextReviewDate(a: ReviewProjectRow, b: ReviewProjectRow): number {
  const at = a.nextReviewDate ? new Date(a.nextReviewDate).getTime() : Number.POSITIVE_INFINITY;
  const bt = b.nextReviewDate ? new Date(b.nextReviewDate).getTime() : Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;
  return a.name.localeCompare(b.name);
}

/** Build the per-project spec list for mark_reviewed (single or batch). */
export function buildMarkReviewedSpecs(params: ManageReviewsParams): Array<{ id?: string; name?: string }> {
  if (Array.isArray(params.projectIds) && params.projectIds.length > 0) {
    return params.projectIds.map(id => ({ id }));
  }
  return [{ id: params.projectId, name: params.projectName }];
}

export async function manageReviews(params: ManageReviewsParams): Promise<ManageReviewsResult> {
  const validation = validateManageReviewsParams(params);
  if (!validation.valid) {
    return { success: false, operation: params.operation, error: validation.error };
  }

  try {
    if (params.operation === 'list_due') {
      const raw = await runOmniJs(
        LIST_DUE_REVIEWS_SCRIPT,
        { all: params.all === true, includeOnHold: params.includeOnHold !== false },
        { readOnly: true }
      );
      if (!raw || raw.success !== true) {
        return { success: false, operation: 'list_due', error: raw?.error || 'list_due script returned no result' };
      }
      const projects: ReviewProjectRow[] = Array.isArray(raw.projects) ? raw.projects : [];
      return {
        success: true,
        operation: 'list_due',
        projects: projects.slice().sort(byNextReviewDate),
        scanned: typeof raw.scanned === 'number' ? raw.scanned : undefined
      };
    }

    if (params.operation === 'mark_reviewed') {
      const specs = buildMarkReviewedSpecs(params);
      const raw = await runOmniJs(MARK_REVIEWED_SCRIPT, { projects: specs });

      if (!raw || !Array.isArray(raw.results)) {
        const message = raw?.error || 'mark_reviewed script returned no results';
        return {
          success: false,
          operation: 'mark_reviewed',
          results: specs.map((spec, index) => ({ index, success: false, id: spec.id, name: spec.name, verified: false, error: message })),
          error: message
        };
      }

      const results: MarkReviewedRow[] = specs.map((spec, index) => {
        const entry = raw.results.find((r: any) => r && r.index === index);
        if (!entry) {
          return { index, success: false, id: spec.id, name: spec.name, verified: false, error: 'No result returned for this project' };
        }
        return {
          ...entry,
          index,
          success: entry.success === true,
          verified: entry.verified === true,
          warnings: Array.isArray(entry.warnings) && entry.warnings.length > 0 ? entry.warnings : undefined
        } as MarkReviewedRow;
      });

      const anySucceeded = results.some(r => r.success);
      return {
        success: anySucceeded,
        operation: 'mark_reviewed',
        results,
        error: anySucceeded ? undefined : (results[0]?.error || 'No project could be marked reviewed.')
      };
    }

    // set_schedule
    const unit = params.unit as ReviewIntervalUnit;
    const raw = await runOmniJs(SET_REVIEW_SCHEDULE_SCRIPT, {
      projectId: params.projectId,
      projectName: params.projectName,
      unit: REVIEW_UNIT_PLURAL[unit],
      steps: params.steps
    });

    if (!raw || raw.success !== true) {
      return { success: false, operation: 'set_schedule', error: raw?.error || 'set_schedule script returned no result' };
    }

    return {
      success: true,
      operation: 'set_schedule',
      project: {
        id: raw.id,
        name: raw.name,
        previousInterval: raw.previousInterval ?? null,
        reviewInterval: raw.reviewInterval ?? null,
        nextReviewDate: raw.nextReviewDate ?? null,
        verified: raw.verified === true
      }
    };
  } catch (error: any) {
    return {
      success: false,
      operation: params.operation,
      error: error?.message || 'Unknown error in manageReviews'
    };
  }
}
