# Changelog

All notable changes to omnifocus-mcp-plus are documented here.

## [0.4.0] - 2026-08-09

Full-codebase audit release: three independent reviews (query tools, mutation tools, infrastructure) surfaced 40 issues; all were fixed. 42 tools, no tool names changed.

### Fixed — silent wrong behavior
- **`set_task_repetition` "from_completion" silently created a FIXED repetition.** `Task.RepetitionMethod.DueAfterCompletion` does not exist in OmniJS (verified live: members are None/Fixed/DeferUntilDate/DueDate), and `new Task.RepetitionRule(rule, undefined)` silently falls back to Fixed — so "repeat 3 days after completion" chores repeated on a fixed calendar schedule. Now maps to `DueDate` ("Due Again"), with new `defer_from_completion` → `DeferUntilDate` ("Defer Another"). Regression test pins the mapping.
- **Deleting a tag/folder by name destroyed an arbitrary match.** All `name_or_id` lookups in tag/folder tools took `filter(...)[0]` with no ambiguity check — two folders named "Archive" meant `delete_folder` cascade-deleted whichever came first. All lookups now go through a shared resolver that errors on ambiguity, listing the matches with IDs.
- **A stale ID silently fell back to name lookup in `remove_item`/`edit_item`.** A provided ID that matched nothing degraded to name matching, so a stale ID + a name matching a different task deleted/edited the wrong item with a ✅ message. An explicit ID that misses is now an error and the name is never tried.
- **`filter_tasks` `completedThisWeek`/`completedThisMonth` returned all-time completions.** The flags selected completed tasks but never applied a date range (first N of all time, alphabetical), while the summary printed "Completed: This Week". Both ranges now implemented (Monday-anchored week; 1st-of-month).
- **`dump_database` `hideCompleted:false` and `hideRecurringDuplicates` were no-ops.** The script hard-filtered to active tasks before the options could apply. `hideCompleted:false` now really includes completed/dropped tasks (capped at the 50 most recent per project, cap noted in output); `hideRecurringDuplicates` now collapses completed instances of repeating tasks with an `(×N completed instances)` marker.
- **Bare `YYYY-MM-DD` dates landed on the wrong day.** `new Date("2026-08-12")` is UTC midnight — Aug 11, 7:00 PM in US Central — in both Node and OmniJS. Every tool now normalizes bare dates to local midnight via a shared helper (`src/utils/localDate.ts`), and all schema descriptions agree the bare form is safe (previously `batch_add_items` recommended the format `add_omnifocus_task` warned against).
- **`edit_item` half-applied project edits.** Property writes ran before folder resolution, so a bad `newFolderName` renamed the project and then errored. All destination lookups (project, parent task, folder) now resolve and validate before any write.
- **Batch tools reported `Failed to process batch operation: undefined`.** When every item failed, per-item errors were discarded. Handlers now render per-item ✅/❌ lines in partial and all-failed cases.
- **`get_custom_perspective_tasks` hijacked the OmniFocus window.** A read tool switched the front window to the queried perspective and never restored it (and threw opaquely with no window open). The previous perspective is saved and restored in a finally block; the no-window case errors clearly. `limit` also now applies in the tree display modes (previously flat-only), with a "(showing N of M)" note.
- **`get_forecast_tasks` `includeDeferredOnly` was a no-op** — the due-date branch ran unconditionally. Also fixed the days+1 off-by-one (days=7 now means today through today+6, documented), and TOMORROW headers on daylight-saving transition days.
- **`get_task_counts` disagreed with OmniFocus.** `available` excluded Next/DueSoon/Overdue (all actionable); `dueSoon` used a hardcoded 3-day window instead of `Task.Status.DueSoon` (which respects the user's Due Soon setting). Both now match app semantics.
- **`reorder_task` could silently move a task to another project** when the before/after reference wasn't actually a sibling — siblingship is now verified.
- **`duplicate_task` was a shallow copy** dropping repetition rules, subtasks, and notifications. Now uses the native `duplicateTasks()` API (verified signature live) — full deep copy; the result reports subtask/repetition/notification carryover.
- **`edit_item` silently ignored schema-legal fields that didn't match the itemType** (e.g. `addTags` on a project → "✅ updated" with nothing changed). Wrong-type fields are now rejected with pointers to the right field — and tags on projects are actually supported now (the OmniJS Project API takes the same tag calls as tasks).
- **`replaceTags: []` was a silent no-op** — an empty array now clears all tags via `clearTags()`; omitting the field still means "no change".
- **Dropping a repeating task killed all occurrences.** `item.drop(true)` was hardcoded; new `dropAllOccurrences` flag defaults to false (current occurrence only). Also fixed: `Project` has no `drop()` method at all — the old project-dropped branch would have thrown; it now sets `Project.Status.Dropped`.
- **`planned date` failures were swallowed** by empty catch blocks in four tools while reporting success — now surfaced as ⚠️ warnings.
- **`complete_task`/`uncomplete_task` were non-idempotent** — completing an already-completed task errored (bad for retries); both now return success with an "already" note. Also fixed a latent `task.taskStatus.name` (undefined in OmniJS) in uncomplete's status message.
- **Notification tool gaps**: absolute `date` accepted any string ("tomorrow" → Invalid Date deep in OmniJS; now schema-validated), negative `minutesBefore` allowed (now min 0), relative notifications on tasks with no due date now error clearly, and `remove_notification` returns the remaining list so stale indices are visible.
- **`get_task_by_id` couldn't show Dropped** — dropped tasks looked Available. Now returns `taskStatus` + `dropped`.
- **`filter_tasks` truncated before filtering on large databases** — the script sorted by name and capped at max(limit×20, 1000) before date/tag filters ran, silently dropping late-alphabet matches. All filters (and the sort) now run in-script before truncation; output warns when results are capped. Name sort now uses localeCompare (was case-sensitive raw comparison).

### Fixed — infrastructure
- **MCP stdio protocol pollution**: `list_custom_perspectives` wrote six console.log lines to stdout — the JSON-RPC channel — on every call. All server-side diagnostics now go to stderr (console.log inside the OmniJS scripts runs in OmniFocus's runtime and never touched stdio).
- **osascript calls could hang forever** (OmniFocus modal/permission dialog) and died at 1MB of output (`exec` default maxBuffer, fatal for `dump_database` on large databases). All calls now run with a 120s timeout and 50MB buffer, with actionable error messages for both failure modes.
- **Temp-file race**: script temp files used millisecond timestamps — two concurrent tool calls in the same millisecond could swap results. Names now use randomUUID.
- **`String.replace` injection**: user args reached the replacement-string position of `String.replace`, where `$'`-style sequences splice file content — a search text containing `$'` corrupted the generated script (proven with a live repro). Replacement is now a function.
- **Unparseable script output produced `Error: undefined`** — `runOmniJs` returned a raw string on JSON parse failure that callers read `.success` off. Now returns a structured error including the raw output excerpt, which tool errors surface.
- **Temp-file leak** on the error path of `executeOmniFocusScript` (cleanup now in finally, matching the v0.2.2 fix that missed this function).
- **Batch performance**: batch tools ran one osascript round-trip per item (50 items = 50 sequential OmniFocus launches). Each batch is now a single generated script with per-item try/catch — same per-item error reporting, one round-trip. `dump_database`'s compact report also dropped its O(n²) per-project/per-parent scans (precomputed maps; tag-prefix computation now O(n log n), verified byte-identical over 20k randomized inputs).

### Changed
- **MCP SDK 1.8.0 → 1.30.0** (clears the DNS-rebinding/ReDoS advisories in ≤1.25.1; `npm audit` now clean). `registerStrictTool` no longer reaches into SDK private internals — the strict schemas go through the official `registerTool()` API, with refine/transform schemas re-validated in a handler wrapper so tools/list still advertises full JSON Schemas. Verified end-to-end with in-memory client/server round-trip tests.
- **Forecast now honors inherited (effective) dates** — tasks inheriting a due date from their project/parent appear in `get_forecast_tasks`, matching OmniFocus's own Forecast perspective, and all read tools (`flagged`/`inbox`/`by_tag`/`forecast`) render effective dates with the same `(eff)` marker `filter_tasks` already used.
- **Packaging**: version 0.4.0; author/description/keywords updated (fork residue removed); broken `bin` entry removed; `files` allowlist added; MIT LICENSE file added; tsx pinned in devDependencies (was fetched unpinned at test time); `tsconfig` moved to nodenext resolution; test files no longer compile into dist (tsconfig.build.json); logo compressed 1.97MB → 447KB; README's stale embedded changelog now points here.

### Removed
- **Dead code**: `perspectiveEngine.ts` (682 lines — unregistered, and the only injection-unsafe string interpolation in the repo), the unreachable `get_perspective_tasks_v2` tool, `dateFormatter.ts`, `executeAppleScript`/`executeJXA`, the legacy regex-patch block in `scriptExecution.ts`, 7 unreferenced debug scripts in `omnifocusScripts/`, and `filter_tasks`' dead `perspective:'custom'` options.

### Internal
- Shared OmniJS lookup helpers (`src/utils/omniJsHelpers.ts`) — single implementation of strict ID/name resolution used by every mutation tool. Shared local-date helpers (`src/utils/localDate.ts`). Test suite: 106 → 266 tests, including scriptExecution coverage (escaping round-trips, injection regression, temp-name uniqueness) and generated-script syntax checks.

## [0.3.3] - 2026-05-23

### Fixed
- **`get_task_by_id` silently returned the wrong task on ambiguous names.** Every other name-fallback tool (`edit_item`, `remove_item`, `list_subtasks`, `duplicate_task`, `reorder_task`) errors when multiple items share a name; `get_task_by_id` did not — it returned the first match. Now errors with a clear "Ambiguous task name" message pointing to `taskId`.
- **Invalid date strings were silently dropped.** `edit_item`, `add_omnifocus_task`, `add_project`, and `batch_add_items` all did `new Date(args.dueDate)` against user input with no validation. `new Date("tomorrow")` returns an `Invalid Date` object (NaN timestamp) and OmniFocus silently no-ops the assignment, so the caller got "✅ updated successfully" while nothing changed. New `optionalIsoDate` schema helper rejects unparseable strings at the schema boundary; empty strings still accepted as the "clear date" sentinel in edit contexts.
- **`edit_item` with a typo'd `newFolderName` silently created a new folder.** The script previously did `destFolder = new Folder(args.newFolderName)` when lookup failed. `edit_item({newFolderName:"Wokr"})` would create a "Wokr" folder instead of erroring. Now errors with "Folder not found: ... Create it first with create_folder." Also handles ambiguous folder names with a clear error.

### Added
- **`edit_item.newFolderId` and slash-paths in `newFolderName`.** Two folders can legitimately share a name at different paths (e.g. `🦆Loon` top-level vs nested under `Personal Areas`; `Travel` top-level vs under `Someday/Maybe`). The ambiguity error above correctly refuses to guess but didn't give a good way to disambiguate. Now: pass `newFolderId` for an exact reference (use `list_folders` to find IDs), or use a slash-separated path in `newFolderName` like `Someday/Maybe/Travel`. Literal-name lookup still wins first, so folder names containing a literal `/` (like `📀Resources/Archives `) continue to work. `validateEditItemParams` rejects passing both `newFolderId` and `newFolderName` together.

## [0.3.2] - 2026-05-23

### Fixed
- **Silent strip of unknown fields across every tool** — Zod's default "strip" mode was discarding unknown keys before MCP handlers saw them. Concrete consequence: `edit_item({id:"X", itemType:"task", completed:true})` returned `✅ Task updated successfully` while the task stayed open (caller meant `newStatus:"completed"`). Root cause was shared across every tool: schemas were vanilla `z.object({...})`, and the MCP SDK reconstructs schemas via `z.object(shape)` at registration so chaining `.strict()` on the exported schema alone would not propagate. Fix: every schema (including nested item shapes in batch tools) now chains `.strict()`, and a new `registerStrictTool()` helper overwrites the SDK's internal `inputSchema` with the strict version after registration. Unknown fields now return `Invalid arguments for tool X: Unrecognized key(s) ...`. Advertised JSON Schemas also tighten with `additionalProperties: false` so MCP clients know the contract.
- **`npm test` only ran first-level globs** — `src/**/*.test.ts` was unquoted, so the shell expanded `**` to `*` (zsh default; sh/bash without globstar). All tests under `src/tools/**` were silently skipped. Quoted the glob; test count went from 10 to 84.

### Added
- **`complete_task`** (42 total) — convenience tool mirroring `uncomplete_task`. Marks a task complete by ID; errors if already completed. Existing `edit_item({newStatus:"completed"})` pathway is unchanged.

### Changed
- **Field-name unification with backward-compat aliasing** — `batch_add_items` now prefers `items[].itemType` (matches `edit_item` / `remove_item` / `batch_remove_items`); the legacy `items[].type` still works. `append_to_note` now prefers `itemType` and `id`; legacy `object_type` and `object_id` still work. Either spelling is accepted on input; deprecated forms will be removed in a future major release.

### Notes for callers
- `filter_tasks` substring search of names+notes has always lived on `searchText`. Callers passing `taskName` or `search` previously silently fell back to the default sorted list; with strict validation, those calls now error clearly.
- Other field-name patterns are intentionally untouched: `add_notification`'s `type` is the notification kind (absolute/relative), and `set_task_repetition`'s `schedule_type` is the repetition mode — neither is an item-type field.

## [0.3.1] - 2026-03-11

### Added
- **`reorder_task`** (41 total) — reorder a task within its container: move before/after a sibling, or to beginning/ending. Controls next action in sequential projects.

## [0.3.0] - 2026-03-11

### Added
- **6 new tools** (40 total):
  - `list_subtasks` — list children (subtasks) of a task, optionally recursive for full hierarchy
  - `duplicate_task` — duplicate a task with name, note, dates, flags, tags; optionally into a different project
  - `batch_move_tasks` — move multiple tasks to a project, parent task, or inbox in one call
  - `list_notifications` — list all notifications (reminders) on a task
  - `add_notification` — add absolute or relative (before due date) notifications
  - `remove_notification` — remove a notification by index
- **`tagMatchMode` parameter** on `filter_tasks` — `"all"` requires ALL specified tags (AND mode), `"any"` (default) matches any tag (OR mode)
- **Effective due/defer dates** in all query tools — `effectiveDueDate` and `effectiveDeferDate` show dates inherited from parent tasks/projects. Displayed as "(eff)" when they differ from direct dates.

### Changed
- **AppleScript → OmniJS migration** — `addOmniFocusTask`, `addProject`, `editItem`, and `removeItem` rewritten from AppleScript to OmniJS via `runOmniJs()`. Eliminates:
  - JSON injection bugs from special characters in task/project names
  - AppleScript parse errors from `()` and `/` in names
  - Timezone offset issues with `appleScriptDateCode`
  - ~500 lines of fragile AppleScript generation code
- **Task move via OmniJS** — `moveTasks()` API used instead of AppleScript `move` command. Now actually works for task-to-project and task-to-parent moves.
- **Tag operations via OmniJS** — `item.clearTags()`, `item.addTag()`, `item.removeTag()` replace AppleScript reverse-iteration workaround
- **`editItem` task status** — uses `item.markComplete()`, `item.markIncomplete()`, `item.drop()` instead of AppleScript `mark complete`/`set dropped`

## [0.2.2] - 2026-03-11

### Fixed
- **OmniJS scripts now read injectedArgs** — `forecastTasks.js`, `flaggedTasks.js`, `inboxTasks.js` hardcoded params with `const` instead of reading `injectedArgs`. The `days`, `hideCompleted`, `projectFilter`, and `includeDeferredOnly` params passed by callers were silently ignored.
- **`get_task_counts` deferred count** — was counting `Task.Status.Blocked` (sequential dependency) as "deferred". Now correctly counts tasks with a future defer date.
- **`edit_item` tag replacement iteration bug** — forward iteration through `existingTags` while removing caused AppleScript to skip elements. Now iterates in reverse.
- **JSON escaping in `editItem` and `removeItem`** — task names containing `"` or `\` produced malformed JSON. Now escaped via AppleScript text item delimiters before embedding in return strings.
- **`executeJXA` temp file leak** — `unlinkSync` was not in a `finally` block, so temp files leaked when `JSON.parse` threw. Now matches `executeAppleScript`'s pattern.

### Changed
- **Removed unimplemented `filter_tasks` params** — `hasEstimate`, `estimateMin`, `estimateMax`, `hasNote`, `inInbox` were in the schema but never implemented. Removed for honest API surface.
- **Perspective engine task limits raised** — `perspectiveEngine.ts` limits increased from 50/15 to 500/200 to avoid truncating perspectives with many tasks.

## [0.2.1] - 2026-03-11

### Fixed
- **get_task_by_id rewritten as OmniJS** — was 219 lines of AppleScript with pipe-delimited parsing, now 65 lines of OmniJS. Dates use native `toISOString()` instead of locale-formatted AppleScript strings that produced "Invalid Date" in JS.

## [0.2.0] - 2026-03-10

### Added
- **17 new OmniJS-based tools** (34 total):
  - `append_to_note` — append text to task/project notes without overwriting
  - `uncomplete_task` — mark a completed task as incomplete
  - `set_task_repetition` — set/clear repeating schedules (iCal RRULE syntax)
  - `list_projects` — list/filter projects by folder, status, stalled state, with sorting
  - `search_projects` — search projects by name
  - `get_project_counts` — aggregate counts by status (active, on hold, completed, dropped, stalled)
  - `get_task_counts` — aggregate task counts with filters (project, tag, flagged, date range)
  - `list_folders` — list all folders with project counts
  - `get_folder` — get folder details including projects and subfolders
  - `create_folder` — create a folder, optionally nested
  - `update_folder` — update folder name or status
  - `delete_folder` — delete a folder (and all projects inside it)
  - `list_tags` — list tags with task counts, filter by status
  - `search_tags` — search tags by name
  - `create_tag` — create a tag, optionally nested
  - `update_tag` — update tag name or status
  - `delete_tag` — delete a tag
- **`runOmniJs()` helper** in `scriptExecution.ts` — inline OmniJS execution with JSON arg injection, no external script files needed

### Changed
- Renamed from `omnifocus-mcp-enhanced-fork` to `omnifocus-mcp-plus`
- Server name updated to "OmniFocus MCP Plus"
- Repository URLs updated throughout

## [0.1.0] - 2026-03-09

Initial fork of [jqlts1/omnifocus-mcp-enhanced](https://github.com/jqlts1/omnifocus-mcp-enhanced) with 17 tools.

### Fixed
- Task completion for inbox and repeating tasks (`mark complete` instead of `set completed to true`)
- All due-date filters (`dueToday`, `dueThisWeek`, `dueThisMonth`, `overdue`, `dueBefore`, `dueAfter`) were silently ignored — wired up via client-side filtering
- `dateFormatter` discarding time components — `appleScriptDateCode()` was hardcoding h/m/s to 0
- Multiline notes breaking AppleScript — newlines converted to `" & return & "` concatenation
- JSON escaping in AppleScript return strings — user input now double-escaped
- Single-quote escaping inserting unwanted backslashes
- `isDateInCurrentWeek` using Monday-start weeks — changed to Sunday-start (US convention)

### Added
- Task IDs displayed in all output tools (e.g. `Task Name [abc123]`)
- Duplicate-name protection on `removeItem` — ambiguous matches return error
- Full ISO 8601 date requirement with timezone offset
- `edit_item` tool description expanded to list all capabilities
- Move task to project/parent/inbox via `edit_item` and standalone `move_task`
- Test suite (8 unit tests via tsx)

### Changed
- All Chinese comments/messages translated to English (22+ files)
- Temp file paths quoted in `osascript` calls
