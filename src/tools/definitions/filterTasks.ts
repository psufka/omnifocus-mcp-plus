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

// Optional markdown line components. Task id and name always render.
const FieldEnum = z.enum(["dates", "status", "estimate", "note", "tags", "project"]);

// Clause date fields carry deliberately tiny descriptions: ConditionSchema is
// serialized THREE times in the advertised JSON Schema (and / or / not), so
// every byte here costs triple against the per-tool context budget. The full
// semantics live in docs/skills/omnifocus/filters.md.
const clauseDate = (label: string) => optionalIsoDate(label);

/**
 * One clause condition. Deliberately FLAT and non-recursive (no z.lazy): every
 * key here is evaluated inside omnifocusScripts/filterTasks.js, and the script
 * rejects any key it cannot evaluate rather than silently returning an
 * unfiltered result. `.strict()` is mandatory — a non-strict nested clause
 * would drop typo'd keys and match everything.
 *
 * Date predicates inside a clause require the date to EXIST on the task: a task
 * that was never completed does not satisfy `completedBefore`.
 */
export const ConditionSchema = z.object({
  taskStatus: z.array(TaskStatusEnum).optional(),
  flagged: z.boolean().optional(),
  hasNote: z.boolean().optional(),
  isRepeating: z.boolean().optional(),
  projectFilter: z.string().optional(),
  tagFilter: z.union([z.string(), z.array(z.string())]).optional().describe("Tag name(s); substring match (exactTagMatch is top-level only)"),
  tagMatchMode: z.enum(["any", "all"]).optional(),
  nameContains: z.string().optional(),
  nameMatches: z.string().optional(),
  searchText: z.string().optional(),

  dueBefore: clauseDate("Due before"),
  dueAfter: clauseDate("Due after"),
  deferBefore: clauseDate("Defer before"),
  deferAfter: clauseDate("Defer after"),
  plannedBefore: clauseDate("Planned before"),
  plannedAfter: clauseDate("Planned after"),
  completedBefore: clauseDate("Completed before"),
  completedAfter: clauseDate("Completed after"),
  addedBefore: clauseDate("Created before"),
  addedAfter: clauseDate("Created after"),
  modifiedBefore: clauseDate("Modified before"),
  modifiedAfter: clauseDate("Modified after"),
  droppedBefore: clauseDate("Dropped before"),
  droppedAfter: clauseDate("Dropped after")
}).strict().describe("Flat condition; same meaning as the like-named top-level fields. Date predicates require the date to exist. No nesting");

// Numeric predicate on task.estimatedMinutes. All supplied comparators must
// hold, and a task with no estimate never matches.
const EstimatedMinutesSchema = z.object({
  lessThan: z.number().optional(),
  greaterThan: z.number().optional(),
  equals: z.number().optional(),
  between: z.array(z.number()).length(2)
    .transform((values): [number, number] => [values[0], values[1]])
    .optional()
}).strict();

export const schema = z.object({
  // Task status filter
  taskStatus: z.array(TaskStatusEnum).optional().describe("Filter by task status. Can specify multiple statuses"),

  // Perspective scope
  perspective: PerspectiveEnum.optional().describe("Limit search to specific perspective: inbox, flagged, all tasks"),

  // Project / folder / tag filters
  projectFilter: z.string().optional().describe("Filter by project name (partial match)"),
  folderName: z.string().optional().describe("Only tasks whose project is in this folder or any folder nested inside it. Inbox tasks never match"),
  folderId: z.string().optional().describe("Same as folderName, by id. An id matching nothing is an error; never falls back to name"),
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
  completedYesterday: z.boolean().optional().describe("Show tasks completed yesterday (local midnight to local midnight)"),
  completedThisWeek: z.boolean().optional().describe("Show tasks completed since the most recent Monday at local midnight"),
  completedThisMonth: z.boolean().optional().describe("Show tasks completed since the 1st of this month at local midnight"),

  // Metadata date filters
  addedBefore: optionalIsoDate("Show tasks created before this date"),
  addedAfter: optionalIsoDate("Show tasks created after this date"),
  modifiedBefore: optionalIsoDate("Show tasks last modified before this date"),
  modifiedAfter: optionalIsoDate("Show tasks last modified after this date"),
  droppedBefore: optionalIsoDate("Show tasks dropped before this date (implies dropped tasks)"),
  droppedAfter: optionalIsoDate("Show tasks dropped after this date (implies dropped tasks)"),

  // Other filters
  flagged: z.boolean().optional().describe("Filter by flagged status"),
  searchText: z.string().optional().describe("Search in task names and notes"),
  nameContains: z.string().optional().describe("Case-insensitive substring match on the task name only"),
  nameMatches: z.string().optional().describe("Case-insensitive regex matched against the task name. Invalid patterns are rejected"),
  hasNote: z.boolean().optional().describe("true = only tasks with a non-empty note; false = only tasks without one"),
  isRepeating: z.boolean().optional().describe("true = only repeating tasks; false = only non-repeating tasks"),
  estimatedMinutes: EstimatedMinutesSchema.optional().describe("Estimate in minutes. All supplied comparators must hold; no estimate never matches"),

  // Logical clauses — ONE level deep, no nesting. Top-level filters above
  // implicitly AND with the clause results.
  and: z.array(ConditionSchema).min(1).optional().describe("Every condition must be true"),
  or: z.array(ConditionSchema).min(1).optional().describe("At least one condition must be true"),
  not: ConditionSchema.optional().describe("The condition must be false"),

  // Output controls
  fields: z.array(FieldEnum).optional().describe("Optional detail components to render ('project' = per-project headings). Id and name always render; omit for all"),
  countOnly: z.boolean().optional().describe("Return only the number of matches. Far cheaper — no task details are read"),
  limit: z.number().int().min(1).max(1000).optional().describe("Maximum number of tasks to return (default: 100). Applied after all filters and sorting; the output notes when results were capped"),
  offset: z.number().int().min(0).optional().describe("Skip this many matches (default: 0). Applied after the sort, so paging never repeats or skips a task"),
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
