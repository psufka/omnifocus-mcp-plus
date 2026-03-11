# OmniFocus MCP Plus

A comprehensive MCP server for OmniFocus 4 with 34 tools covering task management, project/folder/tag CRUD, custom perspectives, and advanced filtering.

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

## Tools (34)

### Task Management
| Tool | Description |
|------|-------------|
| `add_omnifocus_task` | Add a new task with dates, tags, project, parent task |
| `edit_item` | Edit task/project: rename, dates, flags, status, tags, move |
| `remove_item` | Remove a task or project (duplicate-name safe) |
| `move_task` | Move task to project, parent task, or inbox |
| `get_task_by_id` | Get task details by ID or name |
| `uncomplete_task` | Mark a completed task as incomplete |
| `set_task_repetition` | Set/clear repeating schedule (iCal RRULE syntax) |
| `append_to_note` | Append text to a task or project note |
| `batch_add_items` | Add multiple tasks/projects in one call |
| `batch_remove_items` | Remove multiple items in one call |

### Task Queries
| Tool | Description |
|------|-------------|
| `filter_tasks` | Advanced filtering: status, dates, projects, tags, search |
| `get_inbox_tasks` | Get inbox tasks |
| `get_flagged_tasks` | Get flagged tasks with optional project filter |
| `get_forecast_tasks` | Get due/deferred tasks in date range |
| `get_tasks_by_tag` | Get tasks by tag name |
| `get_today_completed_tasks` | Get tasks completed today |
| `get_task_counts` | Aggregate counts: total, available, completed, overdue, due soon, flagged |
| `get_custom_perspective_tasks` | Get tasks from a custom perspective |
| `list_custom_perspectives` | List all custom perspectives |
| `dump_database` | Full database export |

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

## Architecture

The server uses two execution patterns:

- **AppleScript** (original tools) — task creation, editing, removal via `osascript`
- **OmniJS via JXA** (v0.2.0+ tools) — inline JavaScript executed inside OmniFocus via `runOmniJs()`. No AppleScript escaping issues, native access to `appendStringToNote()`, `markIncomplete()`, `Task.RepetitionRule`, folder/tag CRUD, etc.

## Changelog

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

- **JSON injection in AppleScript return strings** — Task names containing `"` or `\` may produce malformed JSON from AppleScript-based tools. OmniJS-based tools (v0.2.0+) are not affected.
- **`appleScriptDateCode` ignores timezone offset** — Works correctly when machine timezone matches the ISO string offset.
- **Parameter injection in `executeOmniFocusScript` is fragile** — Uses regex replacement. OmniJS-based tools use direct JSON injection instead.

## Credits

- [jqlts1/omnifocus-mcp-enhanced](https://github.com/jqlts1/omnifocus-mcp-enhanced) — original MCP server with perspective support
- [vitalyrodnenko/OmnifocusMCP](https://github.com/vitalyrodnenko/OmnifocusMCP) — reference implementation for folder/tag CRUD, project listing, and OmniJS patterns

## License

MIT
