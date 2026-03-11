import { z } from 'zod';
import { setTaskRepetition } from '../primitives/setTaskRepetition.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  task_id: z.string().describe("The ID of the task"),
  rule_string: z.string().optional().describe("iCal RRULE string, e.g. 'FREQ=DAILY;INTERVAL=1', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR'. Required unless schedule_type is 'none'."),
  schedule_type: z.enum(['regularly', 'from_completion', 'none']).describe("'regularly' = fixed schedule, 'from_completion' = repeat X days after completion, 'none' = clear repetition")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    const result = await setTaskRepetition(args);
    if (result.success) {
      const msg = args.schedule_type === 'none'
        ? `Cleared repetition rule from task "${result.name}"`
        : `Set repetition on task "${result.name}": ${result.repetitionRule} (${args.schedule_type})`;
      return {
        content: [{ type: "text" as const, text: msg }]
      };
    } else {
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true
      };
    }
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: [{ type: "text" as const, text: `Error setting repetition: ${error.message}` }],
      isError: true
    };
  }
}
