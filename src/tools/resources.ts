import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getInboxTasks } from './primitives/getInboxTasks.js';
import { getForecastTasks } from './primitives/getForecastTasks.js';
import { getFlaggedTasks } from './primitives/getFlaggedTasks.js';
import { getTaskCounts } from './primitives/getTaskCounts.js';
import { getProjectCounts } from './primitives/getProjectCounts.js';

/**
 * MCP resources — read-only, addressable views of the OmniFocus database that
 * a client can attach as context without spending a tool call.
 *
 * Every resource is built from an EXISTING primitive; there is no OmniJS in
 * this file. The primitives are injectable so the unit tests can exercise the
 * real read callbacks (including the error paths) without a live OmniFocus.
 */
export interface ResourceDeps {
  getInboxTasks: typeof getInboxTasks;
  getForecastTasks: typeof getForecastTasks;
  getFlaggedTasks: typeof getFlaggedTasks;
  getTaskCounts: typeof getTaskCounts;
  getProjectCounts: typeof getProjectCounts;
}

export const defaultResourceDeps: ResourceDeps = {
  getInboxTasks,
  getForecastTasks,
  getFlaggedTasks,
  getTaskCounts,
  getProjectCounts,
};

export const RESOURCE_MIME_TYPE = 'text/markdown';

function errorBody(title: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `# ${title}\n\n⚠️ Could not read this resource from OmniFocus.\n\n${message}\n\nOmniFocus may be closed, mid-sync, or waiting on an automation permission prompt. Retry, or use the equivalent tool for a more detailed error.`;
}

/**
 * A resource read must never throw — an unhandled rejection here surfaces to
 * the client as a protocol error instead of something the model can act on.
 */
async function readOrExplain(title: string, read: () => Promise<string>): Promise<string> {
  try {
    const text = await read();
    return text && text.trim() !== '' ? text : `# ${title}\n\n_No content returned._\n`;
  } catch (error) {
    return errorBody(title, error);
  }
}

/** Counts primitives return parsed JSON; a script failure arrives as `{success:false,error}`. */
function assertCounts(label: string, result: any): Record<string, any> {
  if (!result || typeof result !== 'object') {
    throw new Error(`${label}: unexpected result from OmniFocus`);
  }
  if (result.success === false || result.error) {
    throw new Error(`${label}: ${result.error ?? 'unknown error'}`);
  }
  return result;
}

function countRow(label: string, value: unknown): string {
  return `| ${label} | ${typeof value === 'number' ? value : '—'} |\n`;
}

export function formatStats(taskCounts: any, projectCounts: any): string {
  const tasks = assertCounts('Task counts', taskCounts);
  const projects = assertCounts('Project counts', projectCounts);

  let out = '# OMNIFOCUS STATS\n\n';
  out += '## Tasks\n\n| Metric | Count |\n| --- | --- |\n';
  out += countRow('Total', tasks.total);
  out += countRow('Available', tasks.available);
  out += countRow('Overdue', tasks.overdue);
  out += countRow('Due soon', tasks.dueSoon);
  out += countRow('Flagged', tasks.flagged);
  out += countRow('Deferred', tasks.deferred);
  out += countRow('Completed', tasks.completed);
  out += '\n## Projects\n\n| Metric | Count |\n| --- | --- |\n';
  out += countRow('Total', projects.total);
  out += countRow('Active', projects.active);
  out += countRow('On hold', projects.onHold);
  out += countRow('Stalled', projects.stalled);
  out += countRow('Completed', projects.completed);
  out += countRow('Dropped', projects.dropped);
  out += '\n_"Due soon" follows your own OmniFocus Due Soon setting. "Stalled" means an active project with remaining work but no next action._\n';
  return out;
}

export function registerResources(server: McpServer, deps: ResourceDeps = defaultResourceDeps): void {
  server.registerResource(
    'inbox',
    'omnifocus://inbox',
    {
      title: 'OmniFocus Inbox',
      description: 'Unprocessed tasks currently sitting in the OmniFocus inbox.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readOrExplain('INBOX TASKS', () => deps.getInboxTasks({ hideCompleted: true })),
        },
      ],
    })
  );

  server.registerResource(
    'today',
    'omnifocus://today',
    {
      title: "OmniFocus Today",
      description: "Today's landscape: tasks due or deferred to today, plus anything overdue.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          // days: 1 is the single-day forecast window (today counts as day 1);
          // the forecast script includes overdue tasks in that window.
          text: await readOrExplain('TODAY', () => deps.getForecastTasks({ days: 1, hideCompleted: true })),
        },
      ],
    })
  );

  server.registerResource(
    'flagged',
    'omnifocus://flagged',
    {
      title: 'OmniFocus Flagged',
      description: 'Flagged tasks across the database, grouped by project.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readOrExplain('FLAGGED TASKS', () => deps.getFlaggedTasks({ hideCompleted: true })),
        },
      ],
    })
  );

  server.registerResource(
    'stats',
    'omnifocus://stats',
    {
      title: 'OmniFocus Stats',
      description: 'Aggregate task and project counts — size and shape of the database.',
      mimeType: RESOURCE_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readOrExplain('OMNIFOCUS STATS', async () => {
            const [taskCounts, projectCounts] = await Promise.all([
              deps.getTaskCounts({}),
              deps.getProjectCounts({}),
            ]);
            return formatStats(taskCounts, projectCounts);
          }),
        },
      ],
    })
  );
}
