import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/**
 * MCP prompts — reusable, user-invoked GTD workflows.
 *
 * Each prompt returns a single user message that names the REAL tools in this
 * server; a prompt that references a tool that does not exist is worse than no
 * prompt at all, because the model will hallucinate arguments for it.
 *
 * MCP prompt arguments are always strings on the wire, so every argsSchema
 * field here is an optional string.
 */

/** Argument shapes are always optional strings — see note above. */
type PromptArgsShape = Record<string, z.ZodOptional<z.ZodString>>;

interface PromptConfig {
  title: string;
  description: string;
  argsSchema?: PromptArgsShape;
}

/**
 * Thin wrapper over `server.registerPrompt`.
 *
 * The SDK's generic signature infers the callback's argument type from the
 * argsSchema shape, and that inference blows TypeScript's instantiation depth
 * limit (TS2589) once several prompts are registered in one module. The types
 * we actually care about — config shape and callback signature — are pinned
 * here, and only the SDK hand-off is untyped.
 *
 * It also fixes a spec-compliance bug in the SDK's prompt validation. A
 * `prompts/get` request MAY omit the `arguments` key entirely (the SDK's own
 * client omits it when no arguments are passed), but the SDK validates
 * `request.params.arguments` against `z.object(argsSchema)` — and a plain
 * ZodObject rejects `undefined` no matter how optional its fields are. Every
 * prompt that declared any argument therefore failed with -32602 when called
 * with no arguments at all.
 *
 * The fix is a `.default({})` wrapper so the whole arguments object is
 * optional. It has to be installed AFTER registration because
 * `_createRegisteredPrompt` runs `objectFromShape()` on whatever it is given
 * (which would mangle a schema instance into a "shape"), while the request
 * handler re-reads `registeredPrompt.argsSchema` on every call. The `shape`
 * property is carried over explicitly: that is what `prompts/list` reflects on
 * to advertise each argument.
 */
function definePrompt(
  server: McpServer,
  name: string,
  config: PromptConfig,
  callback: (args: Record<string, string | undefined>) => GetPromptResult
): void {
  // The callback also tolerates a missing arguments object on its own, so a
  // future SDK that hands through `undefined` cannot crash a prompt.
  const tolerantCallback = (args?: Record<string, string | undefined>) => callback(args ?? {});

  const registered = (server as any).registerPrompt(name, config, tolerantCallback);

  if (config.argsSchema) {
    const objectSchema = z.object(config.argsSchema);
    registered.argsSchema = Object.assign(objectSchema.default({}), { shape: objectSchema.shape });
  }
}

function userMessage(text: string): GetPromptResult {
  return {
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text },
      },
    ],
  };
}

/** Closing line for any workflow that writes to the database. */
const SYNC_FOOTER = 'When all changes are made, finish by calling `app_control` sync once.';

function scopeLine(label: string, value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? `\n${label}: ${trimmed}\n` : '';
}

export function registerPrompts(server: McpServer): void {
  definePrompt(
    server,
    'weekly_review',
    {
      title: 'GTD Weekly Review',
      description:
        'Step-by-step GTD weekly review: projects due for review, stalled-project evidence, mark reviewed, inbox sweep, week ahead.',
      argsSchema: {
        folder: z
          .string()
          .optional()
          .describe('Optional folder name to limit the review to (default: every project)'),
      },
    },
    ({ folder }) =>
      userMessage(
        `Run a GTD weekly review with me. Work through these steps in order and pause for my input where noted.
${scopeLine('Scope', folder)}
1. **What is due for review** — call \`manage_reviews\` with operation \`list_due\` to get the projects whose next review date has arrived. Show me the list with names, ids, and how overdue each review is.

2. **Gather evidence before we walk the list** — call \`analyze\` with \`stalled_projects\` so we know which of those projects have no available next action. Also call \`list_projects\` for on-hold projects if the review list is short.

3. **Walk each project one at a time.** For each: state its status, its next action (or that it has none), and anything stale. Then ask me one question — keep it, change it, or drop it. Apply my answer with \`edit_item\` (rename, status, dates) or \`add_omnifocus_task\` if it needs a next action. Never guess a project id; use the id from step 1.

4. **Mark it reviewed as you go** — immediately after each project is handled, call \`manage_reviews\` with operation \`mark_reviewed\` for that project id. Do not batch this to the end; an interrupted review should still record the projects we finished.

5. **Sweep the inbox** — call \`get_inbox_tasks\`. For each item, propose a destination project and tags, and file it with \`edit_item\` once I agree.

6. **Look at the week ahead** — call \`get_forecast_tasks\` with days 7 and tell me where the week is overloaded relative to the commitments we just confirmed.

Finish with a short summary: projects reviewed, projects changed, inbox items filed, and the two or three things that most need my attention this week.

${SYNC_FOOTER}`
      )
  );

  definePrompt(
    server,
    'inbox_processing',
    {
      title: 'Process the Inbox',
      description:
        'Inbox triage loop: decide do / defer / delegate / delete per item, check for duplicates, then file with project, tags, and dates.',
      argsSchema: {
        limit: z
          .string()
          .optional()
          .describe('Optional maximum number of inbox items to process in this pass'),
      },
    },
    ({ limit }) =>
      userMessage(
        `Help me process my OmniFocus inbox to zero. One item at a time — do not batch decisions.
${scopeLine('Stop after this many items', limit)}
1. Call \`get_inbox_tasks\` and show me the items with their ids.

2. For each item, in order, tell me what it is and recommend exactly one of:
   - **Do** — under two minutes; I will do it now and you call \`complete_task\`.
   - **Defer** — it is real but not now; propose a project, tags, and a defer or planned date.
   - **Delegate** — it belongs to someone else; propose a waiting-for tag and a due date to check back.
   - **Delete** — it is not actionable; call \`remove_item\` only after I confirm.

3. **Before creating anything new**, call \`find_similar_tasks\` with the item's text. If a near-duplicate already exists, say so and offer to merge into the existing task (\`append_to_note\` or \`edit_item\`) instead of creating a second one.

4. **File it** with \`edit_item\`, moving the item to its project and setting tags and dates in the same call. Use the id from step 1 — never the name. If \`edit_item\` reports an ambiguous name, re-run \`get_inbox_tasks\` and use the id.

5. When the list is clear, call \`get_inbox_tasks\` once more to confirm the inbox is empty, and summarise where everything went.

${SYNC_FOOTER}`
      )
  );

  definePrompt(
    server,
    'daily_planning',
    {
      title: 'Plan Today',
      description:
        "Build today's plan from forecast, due-today, planned-today, and flagged tasks, then commit it with planned dates.",
      argsSchema: {
        date: z
          .string()
          .optional()
          .describe('Local date to plan as YYYY-MM-DD (default: today)'),
        hours: z
          .string()
          .optional()
          .describe('Roughly how many working hours are available today'),
      },
    },
    ({ date, hours }) =>
      userMessage(
        `Help me plan my day in OmniFocus. Be realistic — a plan I cannot finish is worse than a short one.
${scopeLine('Planning date (local)', date)}${scopeLine('Available hours', hours)}
1. **Collect the landscape.** Call, and show me the counts from each:
   - \`get_forecast_tasks\` with days 1 — what is due or deferred today, plus anything overdue.
   - \`filter_tasks\` with \`dueToday: true\` and \`filter_tasks\` with \`plannedToday: true\`.
   - \`filter_tasks\` with \`flagged: true\` and \`taskStatus: ["Available", "Next"]\`.
   Dates are local; a bare YYYY-MM-DD means local midnight that day.

2. **Deduplicate** the combined list by task id — the same task usually appears in several of those views.

3. **Propose the plan.** Group into "must land today" (overdue and hard due dates), "should" (flagged, next actions), and "if there is room". Use \`estimatedMinutes\` where tasks have it, and say plainly if the must-land group already exceeds the available time — then tell me what to move.

4. **Commit it** once I approve: call \`edit_item\` on each chosen task to set its planned date to the planning date. Use the ids from step 1.

5. End with the plan as a short ordered list, and name the single task that matters most.

${SYNC_FOOTER}`
      )
  );

  definePrompt(
    server,
    'task_health_scan',
    {
      title: 'Task System Health Scan',
      description:
        'Run the analyze tool across health, overdue clusters, stalled projects, and velocity, and present the evidence.',
    },
    () =>
      userMessage(
        `Give me an evidence-based health check of my OmniFocus system.

1. Call \`analyze\` four times and show the raw findings from each:
   - \`health_snapshot\` — overall shape of the database.
   - \`overdue_clusters\` — where overdue work is concentrated.
   - \`stalled_projects\` — active projects with no available next action.
   - \`velocity\` — completion throughput over time.

2. Present each result as its own short section: the numbers the tool returned, then two or three observations grounded in those numbers.

3. **Do not invent a score.** No 0–10 health rating, no letter grade, no percentage that no tool produced. If something looks bad, say which number says so.

4. Close with the three problems most worth fixing, each naming the specific projects or tasks involved and the tool you would use to fix it (for example \`manage_reviews\`, \`edit_item\`, \`add_omnifocus_task\`).

This scan is read-only — do not change anything without asking me first.`
      )
  );
}
