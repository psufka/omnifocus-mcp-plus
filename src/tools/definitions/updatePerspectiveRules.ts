import { z } from 'zod';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  updatePerspectiveRules,
  validatePerspectiveRules,
  KNOWN_RULE_KEYS,
  STRUCTURAL_RULE_KEYS
} from '../primitives/updatePerspectiveRules.js';

export const baseSchema = z.object({
  perspectiveName: z.string().optional()
    .describe("Name of the custom perspective to rewrite. Ambiguous names are rejected with the matching identifiers — use perspectiveId then."),
  perspectiveId: z.string().optional()
    .describe("Identifier of the custom perspective (from list_custom_perspectives). Takes precedence over perspectiveName."),

  rules: z.array(z.record(z.unknown())).min(1)
    .describe(
      "The COMPLETE replacement rule array — this overwrites the perspective's rules, it does not merge. " +
      "Read the current value with list_custom_perspectives({includeRules: true}) first. " +
      `Leaf rules use keys such as: ${KNOWN_RULE_KEYS.slice(0, 12).join(', ')}, … ` +
      `Nest with { aggregateRules: [...], aggregateType: 'all' | 'any' | 'none' } and disable a clause with { disabledRule: {...} }. ` +
      "Example: [{ actionAvailability: 'remaining' }, { aggregateRules: [{ actionStatus: 'flagged' }, { actionStatus: 'due' }], aggregateType: 'any' }]"
    ),

  aggregation: z.enum(['all', 'any']).nullable().optional()
    .describe("Top-level filter aggregation: 'all' = every rule must match, 'any' = at least one. Pass null to clear it. Omit to leave the perspective's current aggregation untouched."),

  allowUnknownKeys: z.boolean().optional()
    .describe("Write rule keys this tool does not recognize. Default false. OmniFocus silently ignores unknown keys, which can turn a narrow perspective into one that matches everything — only set this if you are certain the key is valid for your OmniFocus version.")
}).strict();

export const schema = baseSchema.superRefine((data, ctx) => {
  if (!data.perspectiveName && !data.perspectiveId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either perspectiveName or perspectiveId must be provided.'
    });
    return;
  }

  // OmniFocus performs NO validation on assignment, so this is the only gate
  // between a typo'd rule key and a perspective that silently matches
  // everything. It runs before anything is written.
  const errors = validatePerspectiveRules(data.rules, { allowUnknownKeys: data.allowUnknownKeys === true });
  for (const message of errors) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});

function summarizeRule(rule: unknown): string {
  if (typeof rule !== 'object' || rule === null) return JSON.stringify(rule);
  const keys = Object.keys(rule as Record<string, unknown>);
  if (keys.includes('aggregateRules')) {
    const nested = (rule as any).aggregateRules;
    const type = (rule as any).aggregateType ?? 'all';
    return `group (${type}) of ${Array.isArray(nested) ? nested.length : '?'} rule(s)`;
  }
  if (keys.includes('disabledRule')) {
    return `disabled: ${summarizeRule((rule as any).disabledRule)}`;
  }
  return keys.map(k => `${k}=${JSON.stringify((rule as any)[k])}`).join(', ');
}

function ruleListLines(rules: unknown[] | undefined): string[] {
  if (!Array.isArray(rules) || rules.length === 0) return ['  (none)'];
  return rules.map((r, i) => `  ${i + 1}. ${summarizeRule(r)}`);
}

function jsonBlock(value: unknown): string {
  return ['```json', JSON.stringify(value ?? [], null, 2), '```'].join('\n');
}

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const result = await updatePerspectiveRules({
      perspectiveName: args.perspectiveName,
      perspectiveId: args.perspectiveId,
      rules: args.rules,
      setAggregation: args.aggregation !== undefined,
      aggregation: args.aggregation ?? null
    });

    if (!result.success) {
      const parts = [`Error: ${result.error}`];
      if (result.before !== undefined) {
        parts.push('', 'Rules as they stand now (previous value):', jsonBlock(result.before));
      }
      return {
        content: [{ type: "text" as const, text: parts.join('\n') }],
        isError: true
      };
    }

    const aggChanged = args.aggregation !== undefined && result.beforeAggregation !== result.afterAggregation;
    const lines = [
      `Updated rules for custom perspective "${result.name}" (id: ${result.identifier}) — verified by read-back.`,
      '',
      `**Before** (${Array.isArray(result.before) ? result.before.length : 0} rule(s), aggregation: ${result.beforeAggregation ?? '(none)'})`,
      ...ruleListLines(result.before),
      '',
      `**After** (${Array.isArray(result.after) ? result.after.length : 0} rule(s), aggregation: ${result.afterAggregation ?? '(none)'})`,
      ...ruleListLines(result.after)
    ];

    if (aggChanged) {
      lines.push('', `Aggregation changed: ${result.beforeAggregation ?? '(none)'} → ${result.afterAggregation ?? '(none)'}`);
    }

    lines.push(
      '',
      'Previous rules (keep this to undo):',
      jsonBlock(result.before)
    );

    return { content: [{ type: "text" as const, text: lines.join('\n') }] };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: [{ type: "text" as const, text: `Error updating perspective rules: ${error.message}` }],
      isError: true
    };
  }
}

/** Re-exported so the tool description and tests share one vocabulary list. */
export { KNOWN_RULE_KEYS, STRUCTURAL_RULE_KEYS };
