import { z } from 'zod';
import {
  manageReviews,
  validateManageReviewsParams,
  MAX_REVIEW_BATCH,
  ManageReviewsParams,
  ManageReviewsResult,
  MarkReviewedRow,
  ReviewInterval,
  ReviewProjectRow
} from '../primitives/manageReviews.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  operation: z.enum(['list_due', 'mark_reviewed', 'set_schedule']).describe(
    "What to do. 'list_due' = show projects whose review date has arrived (read-only). 'mark_reviewed' = stamp a project (or many) as reviewed now and advance its next review date by its own review interval. 'set_schedule' = set how often a project should be reviewed."
  ),

  // --- list_due ---
  all: z.boolean().optional().describe(
    "list_due only. false (default) returns only projects whose next review date has arrived; true returns every reviewable project that has a review schedule, due or not."
  ),
  includeOnHold: z.boolean().optional().describe(
    "list_due only. Include on-hold projects (default true — on-hold projects are still reviewable in OmniFocus). Completed and dropped projects are never returned."
  ),

  // --- mark_reviewed (single) and set_schedule ---
  projectId: z.string().optional().describe(
    "Project ID. Used by mark_reviewed (single project) and set_schedule. A stale ID is an error — it never falls back to the name."
  ),
  projectName: z.string().optional().describe(
    "Project name (alternative to projectId). Ambiguous names are rejected with the list of matches."
  ),

  // --- mark_reviewed (batch) ---
  projectIds: z.array(z.string()).min(1).max(MAX_REVIEW_BATCH).optional().describe(
    `mark_reviewed only. Mark many projects reviewed in one pass (1-${MAX_REVIEW_BATCH} IDs). Mutually exclusive with projectId/projectName.`
  ),

  // --- set_schedule ---
  unit: z.enum(['day', 'week', 'month', 'year']).optional().describe(
    "set_schedule only. Review interval unit. Combined with steps: unit 'week' + steps 2 = review every 2 weeks."
  ),
  steps: z.number().int().min(1).optional().describe(
    "set_schedule only. How many units between reviews (whole number >= 1)."
  )
}).strict().superRefine((value, ctx) => {
  const validation = validateManageReviewsParams(value as ManageReviewsParams);
  if (!validation.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: validation.error ?? 'Invalid manage_reviews input'
    });
  }
});

// --- rendering helpers -----------------------------------------------------
// Scripts serialize dates as ISO (that is the wire format); everything the
// caller sees is re-rendered in local time so no `…Z` string ever escapes.

function localDate(iso?: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** Whole-calendar-day difference (local), positive when `iso` is in the past. */
function daysAgo(iso: string, now: Date): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

function dueLabel(iso: string | null, now: Date): string {
  if (!iso) return 'no next review date';
  const diff = daysAgo(iso, now);
  if (diff > 1) return `${localDate(iso)} — ${diff} days overdue`;
  if (diff === 1) return `${localDate(iso)} — 1 day overdue`;
  if (diff === 0) return `${localDate(iso)} — due today`;
  if (diff === -1) return `${localDate(iso)} — due tomorrow`;
  return `${localDate(iso)} — in ${-diff} days`;
}

function intervalLabel(interval?: ReviewInterval | null): string {
  if (!interval || interval.steps === null || !interval.unit) return 'no review interval';
  const unit = String(interval.unit).replace(/s$/, '');
  return interval.steps === 1 ? `every ${unit}` : `every ${interval.steps} ${unit}s`;
}

function renderListDue(result: ManageReviewsResult, args: z.infer<typeof schema>): string {
  const now = new Date();
  const projects: ReviewProjectRow[] = result.projects ?? [];
  const dueCount = projects.filter(p => p.dueForReview).length;

  let out = `# Project Review${args.all ? ' — All Scheduled Projects' : ' — Due Now'}\n\n`;
  if (projects.length === 0) {
    out += args.all
      ? 'No active projects have a review schedule.\n'
      : 'Nothing is due for review. 🎉\n';
    if (result.scanned !== undefined) out += `\nScanned ${result.scanned} projects (as of ${now.toLocaleDateString()}).\n`;
    return out;
  }

  out += `${dueCount} due for review`;
  if (args.all) out += ` of ${projects.length} scheduled`;
  if (result.scanned !== undefined) out += ` · scanned ${result.scanned} projects`;
  out += ` (as of ${now.toLocaleDateString()})\n\n`;

  for (const p of projects) {
    const marker = p.dueForReview ? '⚠️' : '○';
    const parts = [
      dueLabel(p.nextReviewDate, now),
      intervalLabel(p.reviewInterval),
      `last reviewed ${localDate(p.lastReviewDate)}`
    ];
    if (p.status && p.status !== 'Active') parts.push(p.status);
    if (p.folder) parts.push(`in ${p.folder}`);
    out += `${marker} **${p.name}** — ${parts.join(' · ')}\n   id: ${p.id}\n`;
  }

  out += `\nMark them reviewed with operation "mark_reviewed" (projectIds accepts up to ${MAX_REVIEW_BATCH} at once).\n`;
  return out;
}

function renderMarkReviewed(result: ManageReviewsResult): string {
  const rows: MarkReviewedRow[] = result.results ?? [];
  const succeeded = rows.filter(r => r.success).length;
  const failed = rows.length - succeeded;

  let out = `# Marked Reviewed\n\n${succeeded}/${rows.length} project${rows.length === 1 ? '' : 's'} marked reviewed`;
  if (failed > 0) out += ` (${failed} failed)`;
  out += '\n\n';

  for (const r of rows) {
    const label = r.name || r.id || `project ${r.index}`;
    if (!r.success) {
      out += `❌ ${label}: ${r.error || 'unknown error'}\n`;
      continue;
    }
    const previous = r.previousNextReviewDate ? ` (was ${localDate(r.previousNextReviewDate)})` : '';
    if (r.nextComputed === false) {
      out += `⚠️ **${label}** — reviewed ${localDate(r.newLastReviewDate)}, but no next review date could be computed\n`;
    } else {
      out += `✅ **${label}** — reviewed ${localDate(r.newLastReviewDate)}, next review ${localDate(r.newNextReviewDate)}${previous}\n`;
    }
    for (const warning of r.warnings ?? []) {
      out += `   ⚠️ ${warning}\n`;
    }
  }

  return out;
}

function renderSetSchedule(result: ManageReviewsResult): string {
  const p = result.project;
  if (!p) return 'Review schedule updated.';
  const previous = p.previousInterval && p.previousInterval.unit
    ? ` (was ${intervalLabel(p.previousInterval)})`
    : '';
  let out = `✅ Review schedule for **${p.name}**: ${intervalLabel(p.reviewInterval)}${previous}\n`;
  if (p.nextReviewDate) out += `Next review: ${localDate(p.nextReviewDate)}\n`;
  out += `id: ${p.id}\n`;
  return out;
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await manageReviews(args as ManageReviewsParams);

    if (!result.success) {
      // mark_reviewed can fail per project; show the rows so a partial batch is
      // still actionable instead of collapsing to one error line.
      if (result.operation === 'mark_reviewed' && (result.results?.length ?? 0) > 0) {
        return {
          content: [{ type: "text" as const, text: renderMarkReviewed(result) }],
          isError: true
        };
      }
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true
      };
    }

    let text: string;
    if (result.operation === 'list_due') {
      text = renderListDue(result, args);
    } else if (result.operation === 'mark_reviewed') {
      text = renderMarkReviewed(result);
    } else {
      text = renderSetSchedule(result);
    }

    // A partially failed batch is not an error overall, but the failures are
    // already rendered per row above.
    return {
      content: [{ type: "text" as const, text }]
    };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: [{ type: "text" as const, text: `Error managing reviews: ${error.message}` }],
      isError: true
    };
  }
}
