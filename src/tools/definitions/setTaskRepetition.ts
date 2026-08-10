import { z } from 'zod';
import { setTaskRepetition } from '../primitives/setTaskRepetition.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { buildRuleString, describeRuleString, RRuleError, WEEKDAY_NAMES, type BuildRuleParams } from '../../utils/rrule.js';
import { optionalIsoDate } from '../../utils/zodHelpers.js';

const dayNameEnum = z.enum([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
]);

// NESTED objects must call .strict() themselves — registerStrictTool only
// applies it at the top level, and a tolerated typo here would silently drop
// the ordinal position and produce "every Tuesday" instead of "2nd Tuesday".
const dayOfWeekSpec = z.object({
  day: dayNameEnum,
  position: z.number().int().min(-1).max(4).optional()
    .describe("Ordinal position within the month: 1-4 = first through fourth, -1 = last. Requires frequency 'monthly' or 'yearly'. Omit for 'every <day>'.")
}).strict();

/** Structured fields, listed once so the refinements and the handler agree. */
const STRUCTURED_FIELDS = ['frequency', 'interval', 'daysOfWeek', 'daysOfMonth', 'count', 'endDate'] as const;

/**
 * The field shape without the cross-field refinements. Exported so tests (and
 * anything that needs per-field descriptions) can reach `.shape`, which
 * ZodEffects — what `schema` becomes once superRefine is applied — does not
 * expose.
 */
export const baseSchema = z.object({
  task_id: z.string().describe("The ID of the task"),
  schedule_type: z.enum(['regularly', 'from_completion', 'defer_from_completion', 'none'])
    .describe("'regularly' = fixed schedule (repeats on the calendar regardless of when you finish), 'from_completion' = OmniFocus 'Due Again' (next due date measured from the completion date), 'defer_from_completion' = OmniFocus 'Defer Another' (next defer date measured from the completion date), 'none' = clear repetition"),

  rule_string: z.string().optional()
    .describe("Raw iCal RRULE string, e.g. 'FREQ=DAILY;INTERVAL=1', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR'. Escape hatch for rules the structured fields below cannot express. Mutually exclusive with frequency/interval/daysOfWeek/daysOfMonth/count/endDate. Ignored when schedule_type is 'none'."),

  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional()
    .describe("Structured repetition: how often the task repeats. Required when using any other structured field."),
  interval: z.number().int().min(1).optional()
    .describe("Structured repetition: repeat every N periods of `frequency` (default 1). E.g. frequency 'weekly' + interval 2 = every other week."),
  daysOfWeek: z.array(z.union([dayNameEnum, dayOfWeekSpec])).min(1).optional()
    .describe(`Structured repetition: which weekdays. Either plain names (${WEEKDAY_NAMES.join('/')}) or objects like { day: 'tuesday', position: 2 } for '2nd Tuesday' / { day: 'friday', position: -1 } for 'last Friday'. Positions require frequency 'monthly' or 'yearly'. Cannot be used with frequency 'daily' or together with daysOfMonth.`),
  daysOfMonth: z.array(z.number().int()).min(1).optional()
    .describe("Structured repetition: days of the month, 1-31, or -1 for the last day. Requires frequency 'monthly' or 'yearly'. Cannot be combined with daysOfWeek."),
  count: z.number().int().min(1).optional()
    .describe("Structured repetition: stop after this many occurrences (ICS COUNT). Mutually exclusive with endDate."),
  endDate: optionalIsoDate("Structured repetition: stop repeating after this date (ICS UNTIL). Bare 'YYYY-MM-DD' emits the ICS DATE form for that calendar day; a full date-time is converted to the UTC form the ICS spec requires. Mutually exclusive with count.")
}).strict();

function usedStructuredFields(data: Record<string, unknown>): string[] {
  return STRUCTURED_FIELDS.filter(f => data[f] !== undefined);
}

export const schema = baseSchema.superRefine((data, ctx) => {
  const structured = usedStructuredFields(data as Record<string, unknown>);
  const hasRaw = data.rule_string !== undefined;

  if (data.schedule_type === 'none') {
    // rule_string is tolerated (and ignored) for backwards compatibility, but
    // the structured fields are new surface — accepting them silently would
    // imply a schedule was set when the call actually cleared one.
    if (structured.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `schedule_type 'none' clears repetition and cannot be combined with ${structured.join(', ')}. Drop those fields, or pick a real schedule_type.`
      });
    }
    return;
  }

  if (hasRaw && structured.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Provide EITHER rule_string OR the structured fields (${structured.join(', ')}), not both.`
    });
    return;
  }

  if (!hasRaw && structured.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Repetition requires either rule_string or the structured fields (start with `frequency`) when schedule_type is not 'none'."
    });
    return;
  }

  if (structured.length > 0) {
    if (data.frequency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `frequency is required when using structured repetition fields (${structured.join(', ')}).`
      });
      return;
    }
    // Compose here so an unsupported combination is rejected at validation
    // time rather than reaching OmniFocus as a rule that repeats wrongly.
    try {
      buildRuleString(data as BuildRuleParams);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof RRuleError ? err.message : String(err)
      });
    }
  }
});

const SCHEDULE_LABELS: Record<string, string> = {
  regularly: 'fixed schedule',
  from_completion: 'due again from completion',
  defer_from_completion: 'defer another from completion',
  none: 'none'
};

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    let ruleString = args.rule_string;

    if (args.schedule_type !== 'none' && args.frequency !== undefined) {
      // buildRuleString already succeeded in the refinement; it is pure, so
      // recomputing here cannot diverge.
      ruleString = buildRuleString(args as BuildRuleParams);
    }

    const result = await setTaskRepetition({
      task_id: args.task_id,
      schedule_type: args.schedule_type,
      rule_string: args.schedule_type === 'none' ? undefined : ruleString
    });

    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true
      };
    }

    if (args.schedule_type === 'none') {
      return {
        content: [{ type: "text" as const, text: `Cleared repetition rule from task "${result.name}"` }]
      };
    }

    const lines = [
      `Set repetition on task "${result.name}": \`${result.repetitionRule}\` (${describeRuleString(result.repetitionRule ?? '')})`,
      `- Method: ${args.schedule_type} — ${SCHEDULE_LABELS[args.schedule_type] ?? args.schedule_type} (OmniFocus method \`${result.method}\`)`,
      `- Schedule type: ${result.repetitionScheduleType} · anchor date: ${result.anchorDateKey} · catch up automatically: ${result.catchUpAutomatically}`,
      `- Verified by read-back: ${result.verified === true ? 'yes' : 'NO'}`
    ];
    if (result.previousRule) {
      lines.push(`- Replaced previous rule: \`${result.previousRule}\``);
    }

    return { content: [{ type: "text" as const, text: lines.join('\n') }] };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: [{ type: "text" as const, text: `Error setting repetition: ${error.message}` }],
      isError: true
    };
  }
}
