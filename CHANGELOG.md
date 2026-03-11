# Changelog

All notable changes to omnifocus-mcp-plus are documented here.

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
