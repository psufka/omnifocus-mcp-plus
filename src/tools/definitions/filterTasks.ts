import { z } from 'zod';
import { optionalIsoDate } from '../../utils/zodHelpers.js';
import { filterTasks } from '../primitives/filterTasks.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

// Task status enum
const TaskStatusEnum = z.enum([
  "Available",
  "Next",
  "Blocked",
  "DueSoon",
  "Overdue",
  "Completed",
  "Dropped"
]);

// Perspective scope enum
const PerspectiveEnum = z.enum(["inbox", "flagged", "all"]);

export const schema = z.object({
  // Task status filter
  taskStatus: z.array(TaskStatusEnum).optional().describe("Filter by task status. Can specify multiple statuses"),

  // Perspective scope
  perspective: PerspectiveEnum.optional().describe("Limit search to specific perspective: inbox, flagged, all tasks"),

  // Project / tag filters
  projectFilter: z.string().optional().describe("Filter by project name (partial match)"),
  tagFilter: z.union([z.string(), z.array(z.string())]).optional().describe("Filter by tag name(s). Can be single tag or array of tags"),
  exactTagMatch: z.boolean().optional().describe("Set to true for exact tag name match, false for partial (default: false)"),
  tagMatchMode: z.enum(["any", "all"]).optional().describe("Match any tag (OR, default) or all tags (AND)"),

  // Due date filters
  dueBefore: optionalIsoDate("Show tasks due before this date. Bare YYYY-MM-DD is safe: it means local midnight that day. Full ISO 8601 (e.g., 2026-03-05T09:00:00-06:00) also accepted"),
  dueAfter: optionalIsoDate("Show tasks due after this date. Bare YYYY-MM-DD is safe: it means local midnight that day. Full ISO 8601 (e.g., 2026-03-05T09:00:00-06:00) also accepted"),
  dueToday: z.boolean().optional().describe("Show tasks due today"),
  dueThisWeek: z.boolean().optional().describe("Show tasks due this week (Sunday through Saturday, local time)"),
  dueThisMonth: z.boolean().optional().describe("Show tasks due this month"),
  overdue: z.boolean().optional().describe("Show overdue tasks only"),

  // Defer date filters
  deferBefore: optionalIsoDate("Show tasks with defer date before this date. Bare YYYY-MM-DD is safe: it means local midnight that day"),
  deferAfter: optionalIsoDate("Show tasks with defer date after this date. Bare YYYY-MM-DD is safe: it means local midnight that day"),
  deferToday: z.boolean().optional().describe("Show tasks deferred to today"),
  deferThisWeek: z.boolean().optional().describe("Show tasks deferred to this week (Sunday through Saturday, local time)"),
  deferAvailable: z.boolean().optional().describe("Show tasks whose defer date has passed (now available)"),

  // Planned date filters
  plannedBefore: optionalIsoDate("Show tasks planned before this date. Bare YYYY-MM-DD is safe: it means local midnight that day"),
  plannedAfter: optionalIsoDate("Show tasks planned after this date. Bare YYYY-MM-DD is safe: it means local midnight that day"),
  plannedToday: z.boolean().optional().describe("Show tasks planned for today"),
  plannedThisWeek: z.boolean().optional().describe("Show tasks planned for this week (Sunday through Saturday, local time)"),
  plannedThisMonth: z.boolean().optional().describe("Show tasks planned for this month"),

  // Completion date filters
  completedBefore: optionalIsoDate("Show tasks completed before this date. Bare YYYY-MM-DD is safe: it means local midnight that day"),
  completedAfter: optionalIsoDate("Show tasks completed after this date. Bare YYYY-MM-DD is safe: it means local midnight that day"),
  completedToday: z.boolean().optional().describe("Show tasks completed today (since local midnight)"),
  completedThisWeek: z.boolean().optional().describe("Show tasks completed since the most recent Monday at local midnight"),
  completedThisMonth: z.boolean().optional().describe("Show tasks completed since the 1st of this month at local midnight"),

  // Other filters
  flagged: z.boolean().optional().describe("Filter by flagged status"),
  searchText: z.string().optional().describe("Search in task names and notes"),
  // Output controls
  limit: z.number().max(1000).optional().describe("Maximum number of tasks to return (default: 100). Applied after all filters and sorting; the output notes when results were capped"),
  sortBy: z.enum(["name", "dueDate", "deferDate", "plannedDate", "completedDate", "flagged", "project"]).optional().describe("Sort results by field"),
  sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort order (default: asc)")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await filterTasks(args);

    return {
      content: [{
        type: "text" as const,
        text: result
      }]
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
    return {
      content: [{
        type: "text" as const,
        text: `Error filtering tasks: ${errorMessage}`
      }],
      isError: true
    };
  }
}
