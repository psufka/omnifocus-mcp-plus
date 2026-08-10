import { runOmniJs } from '../../utils/scriptExecution.js';
import { rankBySimilarity, type Scored } from '../../utils/similarity.js';

/**
 * find_similar_tasks — duplicate detection before task creation.
 *
 * Split of responsibilities:
 *   - ONE read-only OmniJS script pulls candidate {id, name, projectName,
 *     status} rows out of the database. It does no matching at all.
 *   - All scoring happens in Node via utils/similarity.ts, which is pure and
 *     unit-tested. Keeping the ranking out of OmniJS means the algorithm can
 *     be tested without OmniFocus and tuned without touching the script.
 */

export interface FindSimilarTasksParams {
  name: string;
  includeCompleted?: boolean;
  limit?: number;
  minScore?: number;
}

export interface SimilarTaskCandidate {
  id: string;
  name: string;
  projectName: string | null;
  status: string;
}

export interface FindSimilarTasksResult {
  success: boolean;
  error?: string;
  query?: string;
  /** How many tasks were scanned in OmniFocus before scoring. */
  candidatesScanned?: number;
  minScore?: number;
  includeCompleted?: boolean;
  matches?: Array<Scored<SimilarTaskCandidate>>;
}

/**
 * Read-only candidate sweep. Completed/dropped tasks are skipped unless
 * includeCompleted is true. No user string ever reaches this script — only the
 * includeCompleted boolean — so there is nothing to interpolate.
 */
export const FIND_SIMILAR_TASKS_SCRIPT = `
  const includeCompleted = args.includeCompleted === true;

  const statusMap = {};
  statusMap[Task.Status.Available] = 'Available';
  statusMap[Task.Status.Blocked] = 'Blocked';
  statusMap[Task.Status.Completed] = 'Completed';
  statusMap[Task.Status.Dropped] = 'Dropped';
  statusMap[Task.Status.DueSoon] = 'DueSoon';
  statusMap[Task.Status.Next] = 'Next';
  statusMap[Task.Status.Overdue] = 'Overdue';

  const all = flattenedTasks;
  const out = [];
  for (let i = 0; i < all.length; i++) {
    const t = all[i];
    const st = t.taskStatus;
    if (!includeCompleted && (st === Task.Status.Completed || st === Task.Status.Dropped)) { continue; }
    const nm = t.name;
    if (!nm) { continue; }

    let projectName = null;
    try {
      const cp = t.containingProject;
      if (cp) { projectName = cp.name; }
      else if (t.inInbox) { projectName = 'Inbox'; }
    } catch (e) {}

    out.push({
      id: t.id.primaryKey,
      name: nm,
      projectName: projectName,
      status: statusMap[st] || 'Unknown'
    });
  }

  return JSON.stringify({ success: true, candidateCount: out.length, tasks: out });
`;

type OmniJsRunner = typeof runOmniJs;

export async function findSimilarTasks(
  params: FindSimilarTasksParams,
  run: OmniJsRunner = runOmniJs
): Promise<FindSimilarTasksResult> {
  const query = (params.name ?? '').trim();
  if (!query) {
    return { success: false, error: 'name is required and must not be empty.' };
  }

  const limit = params.limit ?? 5;
  const minScore = params.minScore ?? 0.35;
  const includeCompleted = params.includeCompleted === true;

  const raw = await run(
    FIND_SIMILAR_TASKS_SCRIPT,
    { includeCompleted },
    { readOnly: true }
  );

  if (!raw || raw.success !== true) {
    return { success: false, error: raw?.error || 'OmniFocus returned no candidate tasks.' };
  }

  const candidates: SimilarTaskCandidate[] = Array.isArray(raw.tasks) ? raw.tasks : [];
  const matches = rankBySimilarity(query, candidates, { limit, minScore });

  return {
    success: true,
    query,
    candidatesScanned: typeof raw.candidateCount === 'number' ? raw.candidateCount : candidates.length,
    minScore,
    includeCompleted,
    matches
  };
}
