/** Bounded process-local LRU/TTL cache. Other clients and GUI edits remain visible
 * after TTL expiry, or immediately when a caller asks for fresh: true. */
export const DEFAULT_CACHE_TTL_MS = 30_000;
export const MAX_CACHE_ENTRIES = 128;
export const MAX_CACHE_BYTES = 8_000_000;
interface Entry { value: unknown; expires: number; bytes: number }
const store = new Map<string, Entry>();
let generation = 0;
let totalBytes = 0;
function remove(key: string) {
  const entry = store.get(key);
  if (entry) totalBytes -= entry.bytes;
  store.delete(key);
}
function prune() {
  for (const [key, value] of store) if (Date.now() >= value.expires) remove(key);
}
export function cacheGeneration(): number { return generation; }
export function cacheKey(toolName: string, args: unknown): string { return `${toolName}:${JSON.stringify(args ?? {})}`; }
export function cacheGet(key: string): unknown | undefined {
  prune();
  const entry = store.get(key);
  if (!entry) return undefined;
  store.delete(key); store.set(key, entry);
  return entry.value;
}
export function cacheSet(key: string, value: unknown, ttlMs = DEFAULT_CACHE_TTL_MS, expectedGeneration = generation): void {
  if (expectedGeneration !== generation) return;
  prune();
  const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null') + Buffer.byteLength(key);
  if (bytes > MAX_CACHE_BYTES || ttlMs <= 0) return;
  remove(key);
  while (store.size >= MAX_CACHE_ENTRIES || totalBytes + bytes > MAX_CACHE_BYTES) remove(store.keys().next().value!);
  store.set(key, { value, bytes, expires: Date.now() + ttlMs }); totalBytes += bytes;
}
export function cacheClear(): void { generation++; store.clear(); totalBytes = 0; }
export function cacheSize(): number { prune(); return store.size; }
