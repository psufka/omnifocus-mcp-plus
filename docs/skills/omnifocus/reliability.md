# Reliable calls and local CLI (0.6)

Use the configured MCP tools when available. For local callers without a connector,
run the installed `omnifocus-mcp` binary or `node /path/to/omnifocus-mcp-plus/dist/cli.js`.
Do not import definition handlers directly: that skips MCP input validation and coercion.

```sh
omnifocus-mcp doctor
omnifocus-mcp doctor --no-probe
omnifocus-mcp list
omnifocus-mcp call filter_tasks '{"countOnly":true,"dateMode":"effective"}'
omnifocus-mcp call batch_edit_items --stdin < edits.json
```

`list` returns current input/output schemas. `doctor` reports package version,
commit, build hash, whether the build came from a dirty checkout, resolved Node and
server paths, OmniFocus user/build versions, automation connectivity and capabilities.
`--no-probe` reads local information without contacting OmniFocus. JSON results go to
stdout; diagnostics go to stderr. A tool error or invalid command exits with status 1.

## Results

MCP and CLI calls preserve readable `content` and also return
`structuredContent: {success, tool, data, meta?}`. Use the object for IDs, counts,
verification, per-item errors and paging rather than extracting them from Markdown.
Tool-specific payloads are in `data`; invalid arguments may be rejected by the MCP
SDK before the handler runs. `success: false`/`isError: true` require inspection.
`verified: false` means the requested write did not read back correctly; absence of
`verified` is not proof of verification. A repeating completion may intentionally
return an active next occurrence with a warning.

`filter_tasks` has `count` for count-only queries, and `matchedCount`, `filteredCount`,
`offsetApplied`, `limitApplied`, `truncated` for pages. Task IDs and names are always
included; `fields` selects optional components in both readable and structured output.
`find_similar_tasks` returns scored `matches`, not its intermediate candidate list.
Attachment reads saved to disk expose `savedPath`, with no inline base64 payload.
Machine dates use ISO instants or epoch milliseconds; present them in local time.

## Creates and uncertain outcomes

Creation tools accept `idempotencyKey`: add task, add project, batch add, create
folder/tag, duplicate task and add notification. Choose one key for a single intended
operation and reuse it with identical arguments if the response is lost. Different
arguments under the same key fail. Simultaneous clients with the same key coordinate;
once completed, the stored result (including errors) is replayed. `meta.idempotency`
says whether it was replayed and identifies the record.

Records persist under `~/.omnifocus-mcp/requests` and do not expire automatically.
An interrupted process may leave a pending record. In that case the create is blocked
as uncertain: inspect the actual objects before deciding whether a new request is
appropriate. A stored result describes the original call; it does not prove the
object still exists now. Omit request keys for previews. A fuzzy similarity search
helps identify existing work, but cannot coordinate concurrent creates.

## Tags and batch edits

Use `tagIds` for creates, and `addTagIds`, `removeTagIds`, `replaceTagIds` for edits.
Names also accept a unique parent/child path; literal names are checked first. Bare
names that resolve to several eligible tags fail. Missing plain names in create/add/
replace operations create tags; missing paths and unknown IDs fail. Removing a
nonexistent name is a no-op. Replacement cannot be mixed with add/remove operations.
The complete tag plan is resolved before edits, and the resulting ID set is verified.

`edit_item` and `batch_edit_items` support `dryRun: true`. Batch edits take up to 100
`items` using the edit_item fields and return an ID, status, changes, warnings and
verification per item. `stopOnError` skips later items. Earlier successful edits
remain; there is no atomic edit rollback.

Atomic **creation** batches report `rollbackStatus: not_needed|complete|partial`.
Only `complete` means every created object was verified absent. A partial rollback
returns `survivingItems` and their IDs for recovery; do not recreate the batch blindly.

## Freshness and coordination

Cacheable reads accept `fresh: true`. The default cache is process-local, bounded to
128 entries and 8 MB; TTL is normally 30 seconds, or 60 seconds for analytics. Cache
metadata records observation time, TTL and hits. Writes invalidate before and after
the call; older concurrent reads cannot refill the cache. GUI changes and other
clients' writes do not invalidate another process's cache, so request fresh data when
it matters.

All updated MCP/CLI processes share two execution slots for the macOS user. Local
`OMNIFOCUS_MCP_MAX_CONCURRENT` can further limit one process; it cannot exceed the two
shared slots. Live holders are never evicted by age. Dead holders are recovered when
any recorded child process is also gone. Queue waits are bounded to 120 seconds.
`OMNIFOCUS_MCP_STATE_DIR` overrides the shared state directory for isolated tests;
production clients must use the same directory to coordinate.

Pure reads retry once on Apple Event timeout -1712, including errors caught by the
JXA wrapper. Writes never automatically retry. Permission denial -1743 includes the
macOS Automation setting to fix. The custom-perspective reader temporarily switches
and restores a window perspective; it deliberately does not retry that UI operation.
Reconnect each client's MCP server after a release so older processes also use the
coordinator, schemas and implementation. Confirm `server_info` in the client.
