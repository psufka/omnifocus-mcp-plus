import { runOmniJs } from '../../utils/scriptExecution.js';

export interface SearchAutomationApiParams {
  query: string;
  offset?: number;
  maxCharacters?: number;
  refresh?: boolean;
}

// Always check the running application's version/build, even on cache hits.
// Documentation is returned as text, never evaluated as JavaScript.
export const SEARCH_AUTOMATION_API_SCRIPT = `
  const version = app.userVersion ? app.userVersion.versionString : null;
  const build = app.buildVersion ? app.buildVersion.versionString : null;
  const supported = typeof app.getTypeScriptDeclarations === 'function';
  if (!supported) return JSON.stringify({ success: false, supported: false, version, build,
    error: 'API documentation lookup requires OmniFocus 4.9 or newer. Update OmniFocus and try again.' });
  if (version && build && args.cachedVersion === version && args.cachedBuild === build) {
    return JSON.stringify({ success: true, supported: true, version, build, cacheHit: true });
  }
  const declarations = app.getTypeScriptDeclarations(args.query);
  if (typeof declarations !== 'string') return JSON.stringify({ success: false, supported: true, version, build,
    error: 'OmniFocus returned an unexpected API documentation format; expected TypeScript text.' });
  return JSON.stringify({ success: true, supported: true, version, build, declarations, cacheHit: false });
`;

interface Entry { version: string; build: string; declarations: string; fetchedAt: number }
const CACHE_TTL_MS = 300_000;
const MAX_ENTRIES = 16;
const MAX_CACHE_CHARACTERS = 1_000_000;

/** OmniFocus 4.9 prepends a generated timestamp and tsconfig setup guide to
 * every result, including no matches. Remove only that recognized preamble,
 * preserving the API sections and their comments. This keeps pages stable. */
export function normalizeApiDocumentation(text: string): string {
  if (!text.startsWith('// TypeScript definitions for OmniFocus ')) return text;
  const endMarker = '\n// }\n';
  const end = text.indexOf(endMarker);
  if (end < 0 || !text.slice(0, end).includes('// To use these definitions, save this file as')) return text;
  return text.slice(end + endMarker.length).replace(/^\n+/, '');
}

/** Separate from task-data caching: keyed by query + verified app version/build,
 * bounded by age, entry count and total text size. Injectable for behavioral tests. */
export function createAutomationApiSearch(execute = runOmniJs, now = Date.now) {
  const cache = new Map<string, Entry>();
  function prune() {
    for (const [key, value] of cache) if (now() - value.fetchedAt >= CACHE_TTL_MS) cache.delete(key);
    let size = Array.from(cache.values()).reduce((sum, entry) => sum + entry.declarations.length, 0);
    while (cache.size > MAX_ENTRIES || size > MAX_CACHE_CHARACTERS) {
      const key = cache.keys().next().value!;
      size -= cache.get(key)!.declarations.length;
      cache.delete(key);
    }
  }
  return async (params: SearchAutomationApiParams) => {
    const query = params.query.trim();
    const offset = params.offset ?? 0;
    const maxCharacters = params.maxCharacters ?? 12_000;
    prune();
    const candidate = params.refresh ? undefined : cache.get(query);
    const result = await execute(SEARCH_AUTOMATION_API_SCRIPT, {
      query, cachedVersion: candidate?.version ?? null, cachedBuild: candidate?.build ?? null
    }, { readOnly: true });
    if (!result.success) { cache.delete(query); return { ...result, query }; }
    const declarations: string = result.cacheHit ? candidate!.declarations : normalizeApiDocumentation(result.declarations);
    const fetchedAt = result.cacheHit ? candidate!.fetchedAt : now();
    cache.delete(query);
    if (result.version && result.build) {
      cache.set(query, { version: result.version, build: result.build, declarations, fetchedAt });
      prune();
    }
    // UTF-16 offsets match JavaScript slicing. Do not split a surrogate pair at
    // a page end; nextOffset always points to the first complete unread character.
    let end = Math.min(offset + maxCharacters, declarations.length);
    if (end > offset && end < declarations.length && /[\uD800-\uDBFF]/.test(declarations[end - 1])) end--;
    const text = declarations.slice(offset, end);
    const truncated = end < declarations.length;
    return { success: true, supported: true, query, version: result.version, build: result.build,
      declarations: text, totalCharacters: declarations.length, offset, maxCharacters,
      truncated, nextOffset: truncated ? end : null,
      cache: { hit: result.cacheHit === true, scope: 'process', fetchedAt: new Date(fetchedAt).toISOString(),
        ttlMs: CACHE_TTL_MS, versionChecked: true } };
  };
}

export const searchAutomationApi = createAutomationApiSearch();
