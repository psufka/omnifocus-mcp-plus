# OmniFocus MCP Plus

A comprehensive MCP server for OmniFocus 4 with 41 tools covering task management, project/folder/tag CRUD, custom perspectives, notifications, and advanced filtering.

Originally forked from [jqlts1/omnifocus-mcp-enhanced](https://github.com/jqlts1/omnifocus-mcp-enhanced). Additional tools inspired by [vitalyrodnenko/OmnifocusMCP](https://github.com/vitalyrodnenko/OmnifocusMCP).

## Installation

Requires macOS with OmniFocus 4 and Node.js 18+.

### From Source

```bash
git clone https://github.com/psufka/omnifocus-mcp-plus.git
cd omnifocus-mcp-plus
npm install && npm run build
npm test  # all tests should pass
claude mcp add omnifocus -- node "$(pwd)/dist/server.js"
```

Restart Claude Code to pick up the new server.

## Tools (41)

### Task Management
| Tool | Description |
|------|-------------|
| `add_omnifocus_task` | Add a new task with dates, tags, project, parent task |
| `edit_item` | Edit task/project: rename, dates, flags, status, tags, move |
| `remove_item` | Remove a task or project (duplicate-name safe) |
| `move_task` | Move task to project, parent task, or inbox |
| `duplicate_task` | Duplicate a task with note, dates, flags, tags; optionally into a different project |
| `get_task_by_id` | Get task details by ID or name |
| `list_subtasks` | List children (subtasks), optionally recursive for full hierarchy |
| `uncomplete_task` | Mark a completed task as incomplete |
| `set_task_repetition` | Set/clear repeating schedule (iCal RRULE syntax) |
| `append_to_note` | Append text to a task or project note |
| `batch_add_items` | Add multiple tasks/projects in one call |
| `batch_remove_items` | Remove multiple items in one call |
| `batch_move_tasks` | Move multiple tasks to a destination in one call |
| `reorder_task` | Reorder task within its container: before/after sibling, or beginning/ending |

### Task Queries
| Tool | Description |
|------|-------------|
| `filter_tasks` | Advanced filtering: status, dates, projects, tags (AND/OR), search |
| `get_inbox_tasks` | Get inbox tasks |
| `get_flagged_tasks` | Get flagged tasks with optional project filter |
| `get_forecast_tasks` | Get due/deferred tasks in date range |
| `get_tasks_by_tag` | Get tasks by tag name |
| `get_today_completed_tasks` | Get tasks completed today |
| `get_task_counts` | Aggregate counts: total, available, completed, overdue, due soon, flagged |
| `get_custom_perspective_tasks` | Get tasks from a custom perspective |
| `list_custom_perspectives` | List all custom perspectives |
| `dump_database` | Full database export |

### Notifications
| Tool | Description |
|------|-------------|
| `list_notifications` | List all notifications (reminders) on a task |
| `add_notification` | Add absolute or relative notification to a task |
| `remove_notification` | Remove a notification by index |

### Projects
| Tool | Description |
|------|-------------|
| `add_project` | Create a new project |
| `list_projects` | List/filter projects by folder, status, stalled state |
| `search_projects` | Search projects by name |
| `get_project_counts` | Aggregate counts by status |

### Folders
| Tool | Description |
|------|-------------|
| `list_folders` | List all folders with project counts |
| `get_folder` | Get folder details including projects and subfolders |
| `create_folder` | Create a folder, optionally nested |
| `update_folder` | Update folder name or status |
| `delete_folder` | Delete a folder (and all projects inside it) |

### Tags
| Tool | Description |
|------|-------------|
| `list_tags` | List tags with task counts, filter by status |
| `search_tags` | Search tags by name |
| `create_tag` | Create a tag, optionally nested |
| `update_tag` | Update tag name or status |
| `delete_tag` | Delete a tag |

## Usage Examples

All tools are called automatically by Claude via MCP. The examples below show the tool parameters for common operations.

### Tasks

**Add a task with a due date and tags:**
```json
{
  "name": "Review quarterly report",
  "dueDate": "2026-03-15T17:00:00-05:00",
  "tags": ["Work", "Urgent"],
  "projectName": "Q1 Review"
}
```

**Set a task to repeat every weekday:**
```json
{
  "task_id": "abc123",
  "rule_string": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "schedule_type": "regularly"
}
```

**Set a task to repeat 3 days after completion:**
```json
{
  "task_id": "abc123",
  "rule_string": "FREQ=DAILY;INTERVAL=3",
  "schedule_type": "from_completion"
}
```

**Append to a task's note (without overwriting):**
```json
{
  "object_type": "task",
  "object_id": "abc123",
  "text": "\nUpdated 2026-03-10: waiting on response"
}
```

### Projects

**List stalled projects (active but stuck):**
```json
{ "stalledOnly": true }
```

**List projects in a folder sorted by remaining tasks:**
```json
{
  "folder": "Work",
  "status": "active",
  "sortBy": "remainingTaskCount",
  "sortOrder": "desc"
}
```

### Folders & Tags

**Create a nested folder:**
```json
{ "name": "Q2 Projects", "parent": "Work" }
```

**Create a nested tag:**
```json
{ "name": "Urgent", "parent": "Priority" }
```

**Put a tag on hold:**
```json
{ "name_or_id": "Waiting", "status": "on_hold" }
```

### Filtering

**Get overdue tasks in a specific project:**
```json
{
  "overdue": true,
  "projectFilter": "Home Renovation"
}
```

**Get tasks due this week with a specific tag:**
```json
{
  "dueThisWeek": true,
  "tagFilter": "Work"
}
```

### Date Format

All dates must use full ISO 8601 with timezone offset. Bare dates like `2026-03-15` resolve to UTC midnight and display as the wrong day in local time.

```
"2026-03-15T17:00:00-05:00"   (CDT)
"2026-03-15T17:00:00-06:00"   (CST)
```

### RRULE Reference

The `set_task_repetition` tool uses [iCal RRULE](https://icalendar.org/iCalendar-RFC-5545/3-8-5-3-recurrence-rule.html) syntax:

| Pattern | RRULE |
|---------|-------|
| Daily | `FREQ=DAILY;INTERVAL=1` |
| Every 3 days | `FREQ=DAILY;INTERVAL=3` |
| Weekly on Mon/Wed/Fri | `FREQ=WEEKLY;BYDAY=MO,WE,FR` |
| Biweekly | `FREQ=WEEKLY;INTERVAL=2` |
| Monthly on the 1st | `FREQ=MONTHLY;BYMONTHDAY=1` |
| Yearly | `FREQ=YEARLY;INTERVAL=1` |

## Architecture

All tools use **OmniJS via JXA** — inline JavaScript executed inside OmniFocus via `runOmniJs()`. No AppleScript escaping issues, native access to all OmniJS APIs. Query tools use external `.js` scripts in `src/utils/omnifocusScripts/` loaded via `executeOmniFocusScript()`. The core task/project CRUD tools (add, edit, remove) were migrated from AppleScript to OmniJS in v0.3.0.

## Changelog

### v0.3.1

- **`reorder_task`** (41 total) — move tasks before/after siblings or to beginning/ending of container

### v0.3.0

- **6 new tools** (40 total): `list_subtasks`, `duplicate_task`, `batch_move_tasks`, `list_notifications`, `add_notification`, `remove_notification`
- **Tag AND filter** — `tagMatchMode: "all"` on `filter_tasks` requires all specified tags
- **Effective dates** — `effectiveDueDate`/`effectiveDeferDate` in all query results (inherited from parent)
- **AppleScript → OmniJS migration** — `addOmniFocusTask`, `addProject`, `editItem`, `removeItem` rewritten. Fixes special character crashes, timezone issues, and enables task move

### v0.2.2

- **Fix OmniJS scripts ignoring parameters** — `forecastTasks`, `flaggedTasks`, `inboxTasks` now read `injectedArgs` instead of hardcoding defaults
- **Fix `get_task_counts` deferred count** — counts future defer dates instead of blocked status
- **Fix tag replacement iteration bug** — reverse iteration prevents skipped elements
- **Fix JSON escaping in AppleScript returns** — task names with `"` or `\` no longer break JSON
- **Fix `executeJXA` temp file leak** — cleanup now in `finally` block
- **Remove unimplemented `filter_tasks` params** — `hasEstimate`, `estimateMin`, `estimateMax`, `hasNote`, `inInbox`
- **Raise perspective engine limits** — 50/15 → 500/200

### v0.2.0

- **17 new tools** using OmniJS: append_to_note, uncomplete_task, set_task_repetition, list_projects, search_projects, get_project_counts, get_task_counts, folder CRUD (5 tools), tag CRUD (5 tools)
- **New `runOmniJs()` helper** — simplified inline OmniJS execution with JSON arg injection, no external script files needed
- **Renamed** from omnifocus-mcp-enhanced-fork to omnifocus-mcp-plus

### v0.1.0

Fork of jqlts1/omnifocus-mcp-enhanced with:
- Fix task completion for inbox and repeating tasks
- Fix all due-date filters being silently ignored
- Fix dateFormatter discarding time components
- Fix multiline notes breaking AppleScript
- Fix JSON escaping in AppleScript return strings
- Fix single-quote escaping inserting unwanted backslashes
- Fix `isDateInCurrentWeek` using Monday-start weeks
- Display task IDs in all output tools
- Duplicate-name protection on `removeItem`
- Require full ISO 8601 dates with timezone
- Move task to project/parent/inbox support
- All Chinese comments translated to English
- Test suite wired up (8 unit tests via tsx)

## Known Limitations

- **Parameter injection in `executeOmniFocusScript` is fragile** — Uses regex replacement for query scripts. CRUD tools use direct JSON injection via `runOmniJs()` instead.
- **Notification API** — Relative notification offset retrieval may not work on all OmniFocus versions. Absolute notifications are fully supported.

## Contributing

PRs welcome! All tools use **OmniJS** — write inline JavaScript that runs inside OmniFocus via `runOmniJs()`. No escaping issues, full access to the OmniJS API. See `src/tools/primitives/folderTools.ts` for examples.

To add a new tool:
1. Create a primitive in `src/tools/primitives/yourTool.ts`
2. Create a definition in `src/tools/definitions/yourTool.ts` (Zod schema + handler)
3. Register in `src/server.ts`
4. `npm run build && npm test`

## Credits

- [jqlts1/omnifocus-mcp-enhanced](https://github.com/jqlts1/omnifocus-mcp-enhanced) — original MCP server with perspective support
- [vitalyrodnenko/OmnifocusMCP](https://github.com/vitalyrodnenko/OmnifocusMCP) — reference implementation for folder/tag CRUD, project listing, and OmniJS patterns

## License

MIT
