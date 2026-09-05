import { readFileSync } from 'node:fs';

export const OMNIJS_TASK_QUERY_HELPERS = readFileSync(new URL('./omnifocusScripts/taskQueryHelpers.js', import.meta.url), 'utf8');

/** Explicit marker keeps packaged scripts self-contained after expansion. */
export function expandScriptHelpers(source: string): string {
  return source.replaceAll('/* @task-query-helpers */', () => OMNIJS_TASK_QUERY_HELPERS);
}
