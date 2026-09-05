import { z } from 'zod';
import { buildInfo } from '../../utils/buildInfo.js';
import { runOmniJs } from '../../utils/scriptExecution.js';
import { recordToolData } from '../../utils/toolResult.js';
import { stateDirectory } from '../../utils/processLock.js';

export const schema = z.object({ probe: z.boolean().optional().describe('Check OmniFocus automation connectivity and capabilities (default true). False reads only local build information.') }).strict();
// Application and Version API: https://omni-automation.com/omnifocus/application.html
export const DIAGNOSTIC_SCRIPT = `
  const sample = flattenedTasks.length ? flattenedTasks[0] : null;
  function supports(key) { try { return sample ? key in sample : null; } catch (e) { return null; } }
  return JSON.stringify({ success: true, connected: true,
    version: app.userVersion ? app.userVersion.versionString : null,
    build: app.buildVersion ? app.buildVersion.versionString : null,
    capabilities: { plannedDates: supports('plannedDate'), effectivePlannedDates: supports('effectivePlannedDate'),
      attachments: supports('attachments'), taskLookupById: typeof Task.byIdentifier === 'function',
      projectLookupById: typeof Project.byIdentifier === 'function' } });
`;
export async function handler(args: z.infer<typeof schema>) {
  let omnifocus: any = { connected: null, probed: false };
  if (args.probe !== false) {
    try { omnifocus = { ...await runOmniJs(DIAGNOSTIC_SCRIPT, {}, { readOnly: true }), probed: true }; }
    catch (error) { omnifocus = { connected: false, probed: true, error: (error as Error).message }; }
  }
  const data = recordToolData({ ...buildInfo(), stateDirectory: stateDirectory(), coordinator: { scope: 'macOS-user', slots: 2 }, omnifocus });
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    ...(omnifocus.connected === false || omnifocus.success === false ? { isError: true } : {}) };
}
