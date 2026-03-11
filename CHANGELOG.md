# Changelog

All notable changes to omnifocus-mcp-plus are documented here.

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
