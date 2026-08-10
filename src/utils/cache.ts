/**
 * Minimal in-process TTL cache for list-shaped read tools.
 *
 * Wired centrally in registerStrictTool: tools registered with
 * `cacheable: true` get successful results cached keyed on
 * (toolName, JSON(args)); any call to a tool whose annotations do not
 * declare readOnlyHint clears the entire cache. Staleness from OTHER
 * processes mutating OmniFocus (Codex/Grok sessions, the app itself)
 * is bounded only by the short TTL — keep it small.
 */

export const DEFAULT_CACHE_TTL_MS = 30_000;

interface Entry {
  value: unknown;
  expires: number;
}

const store = new Map<string, Entry>();

export function cacheKey(toolName: string, args: unknown): string {
  return `${toolName}:${JSON.stringify(args ?? {})}`;
}

export function cacheGet(key: string): unknown | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet(key: string, value: unknown, ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

export function cacheClear(): void {
  store.clear();
}

export function cacheSize(): number {
  return store.size;
}
