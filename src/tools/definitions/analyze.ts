import { z } from 'zod';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  analyze,
  AnalyzeDeps,
  AnalyzeParams,
  DEFAULT_INACTIVE_DAYS,
  DEFAULT_OVERDUE_TOP_N,
  DEFAULT_VELOCITY_DAYS
} from '../primitives/analyze.js';

// Nested option objects are .strict() individually: registerStrictTool only
// applies .strict() to the TOP-level object, and a permissive nested object
// would silently swallow a typo'd key (e.g. "inactivedays") and then quietly
// use the default.
export const schema = z.object({
  analysis: z
    .enum(['health_snapshot', 'velocity', 'overdue_clusters', 'stalled_projects'])
    .describe(
      'Which analysis to run. ' +
      'health_snapshot = one-pass counts of inbox, incomplete, overdue, due-today, flagged, untagged, ' +
      'un-estimated tasks plus project status counts and recent completions. ' +
      'velocity = per-day completed/created counts over a trailing window. ' +
      'overdue_clusters = overdue tasks grouped by project and by tag. ' +
      'stalled_projects = active projects with no next action and/or no recent activity.'
    ),
  velocity: z
    .object({
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe(`Length of the trailing window in local days, counting today (default: ${DEFAULT_VELOCITY_DAYS})`)
    })
    .strict()
    .optional()
    .describe('Options for analysis="velocity"; ignored by other analyses'),
  overdueClusters: z
    .object({
      topN: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(`How many groups to show per grouping; the rest are summarized in a remainder line (default: ${DEFAULT_OVERDUE_TOP_N})`)
    })
    .strict()
    .optional()
    .describe('Options for analysis="overdue_clusters"; ignored by other analyses'),
  stalledProjects: z
    .object({
      inactiveDays: z
        .number()
        .int()
        .min(1)
        .max(3650)
        .optional()
        .describe(`Days without a change to the project's root task before the inactivity signal fires (default: ${DEFAULT_INACTIVE_DAYS})`),
      includeOnHold: z
        .boolean()
        .optional()
        .describe('Also scan on-hold projects, not just active ones (default: false)')
    })
    .strict()
    .optional()
    .describe('Options for analysis="stalled_projects"; ignored by other analyses')
}).strict().describe(
  'Read-only analytics over the OmniFocus database. Returns counts, rates, lists and dates as markdown — ' +
  'deliberately no health score, no insights and no recommendations, so the caller does the interpreting.'
);

// `deps` is a test-only third parameter. MCP calls the handler with
// (args, extra), so it is always undefined in production and the primitive
// falls back to the real runOmniJs.
export async function handler(
  args: z.infer<typeof schema>,
  extra: RequestHandlerExtra<any, any>,
  deps?: AnalyzeDeps
) {
  try {
    const result = deps
      ? await analyze(args as AnalyzeParams, deps)
      : await analyze(args as AnalyzeParams);

    if (result.success && result.markdown) {
      return {
        content: [{ type: "text" as const, text: result.markdown }]
      };
    }
    return {
      content: [{ type: "text" as const, text: `Error: ${result.error ?? 'analysis produced no output'}` }],
      isError: true
    };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: [{ type: "text" as const, text: `Error running analysis: ${error.message}` }],
      isError: true
    };
  }
}
