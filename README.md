# OmniFocus MCP Plus

A comprehensive MCP server for OmniFocus 4 with 50 tools covering task management, project/folder/tag CRUD, GTD review workflow, analytics, custom perspectives (including rule editing), attachments, notifications, and advanced filtering — plus MCP prompts, resources, tool annotations, and a Claude Code skill.

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

## Tools (50)

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
| `complete_task` | Mark a task as completed |
| `uncomplete_task` | Mark a completed task as incomplete |
| `set_task_repetition` | Set/clear repeating schedule — structured fields ("2nd Tuesday monthly") or raw iCal RRULE |
| `append_to_note` | Append text to a task or project note |
| `batch_add_items` | Add multiple tasks/projects in one call — tempId hierarchy, dryRun, atomic rollback |
| `batch_remove_items` | Remove multiple items in one call (dryRun supported) |
| `batch_move_tasks` | Move multiple tasks to a destination in one call (dryRun supported) |
| `reorder_task` | Reorder task within its container: before/after sibling, or beginning/ending |
| `convert_task_to_project` | Promote a task (with subtasks, tags, note) into a project |
| `find_similar_tasks` | Duplicate detection before create — ranked similarity matches with ids |
| `manage_attachments` | List/read/add/remove file attachments on a task or project |

### Task Queries
| Tool | Description |
|------|-------------|
| `filter_tasks` | Advanced filtering: status, all date fields, folder tree, tags, regex, and/or/not clauses, countOnly, paging |
| `search_items` | One search across tasks, projects, folders, and tags |
| `analyze` | Evidence-only analytics: health snapshot, velocity, overdue clusters, stalled projects |
| `get_inbox_tasks` | Get inbox tasks |
| `get_flagged_tasks` | Get flagged tasks with optional project filter |
| `get_forecast_tasks` | Get due/deferred tasks in date range |
| `get_tasks_by_tag` | Get tasks by tag name |
| `get_today_completed_tasks` | Get tasks completed today |
| `get_task_counts` | Aggregate counts: total, available, completed, overdue, due soon, flagged |
| `get_custom_perspective_tasks` | Get tasks from a custom perspective |
| `list_custom_perspectives` | List all custom perspectives (includeRules returns their filter rules) |
| `update_perspective_rules` | Edit a custom perspective's filter rules — validated, read-back verified, undo-able |
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
| `manage_reviews` | GTD review workflow: list due, mark reviewed (batch-capable), set schedule |

### App Control
| Tool | Description |
|------|-------------|
| `app_control` | Sync, undo/redo (confirm-gated), window focus get/set/clear, reveal an item |

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

## MCP Surface & Environment

Beyond tools, the server exposes **4 prompts** (`weekly_review`, `inbox_processing`, `daily_planning`, `task_health_scan` — surfaced as slash commands in Claude Code), **4 resources** (`omnifocus://inbox`, `today`, `flagged`, `stats`), **tool annotations** (readOnly/destructive/idempotent hints on all 50 tools), and **handshake instructions** that steer clients toward the cheap tools. A Claude Code skill lives at `docs/skills/omnifocus/` (install: `ln -s "$(pwd)/docs/skills/omnifocus" ~/.claude/skills/omnifocus`).

Environment variables: `OMNIFOCUS_MCP_MAX_CONCURRENT` (concurrent osascript processes, default 2, range 1–8 — OmniFocus serializes Apple Events on one thread), `OMNIFOCUS_SCRIPT_TIMEOUT_MS` (default 120000), `OMNIFOCUS_SCRIPT_MAX_OUTPUT_BYTES` (default 50MB).

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

Current version: 0.5.1. See [CHANGELOG.md](CHANGELOG.md) for the full release history.

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
