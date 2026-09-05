---
name: omnifocus
description: Use when working with OmniFocus tasks, projects, folders, tags, or GTD workflows (inbox triage, daily planning, weekly review) through the omnifocus MCP tools — picks the right tool for the intent and avoids the mistakes that silently produce wrong data.
---

# OmniFocus

The `omnifocus` MCP server exposes 52 tools over a live OmniFocus 4 database on
macOS. Writes take effect immediately; there is no staging area. See
`filters.md` in this directory for the full `filter_tasks` field reference.
Read [reliability.md](reliability.md) when using the local CLI, batch edits, request
keys, fresh reads, or recovering a failed write. `server_info` verifies the loaded release.

## Pick the right tool

**Reading tasks**

| Intent | Tool |
| --- | --- |
| Anything with a condition (status, dates, tags, project, text) | `filter_tasks` |
| Free-text hunt across tasks, projects, folders *and* tags | `search_items` |
| Unprocessed inbox | `get_inbox_tasks` |
| Due/deferred over the next N days, plus overdue | `get_forecast_tasks` (`days`, today = day 1) |
| Flagged | `get_flagged_tasks` |
| One task you already have the id for | `get_task_by_id` |
| Children of a task | `list_subtasks` |
| Tasks carrying a tag (`@home`) | `get_tasks_by_tag` |
| A named OmniFocus view ("Today", "Weekly Review") | `get_custom_perspective_tasks` — these are perspectives, **not** tags |
| Finished today | `get_today_completed_tasks` |
| Just a number | `get_task_counts` / `get_project_counts` |
| Whole database snapshot | `dump_database` — enormous; last resort |

**Reading projects / folders / tags:** `list_projects` (filter by folder,
status, stalled; sorts and paginates), `search_projects`, `list_folders`,
`get_folder`, `list_tags`, `search_tags`, `list_custom_perspectives`.

**Writing:** `add_omnifocus_task`, `add_project`, `batch_add_items`,
`batch_edit_items` (up to 100 edits with preview),
`edit_item` (the workhorse: rename, dates, flag, status, tags, move, estimate),
`complete_task` / `uncomplete_task`, `move_task` / `batch_move_tasks`,
`duplicate_task`, `convert_task_to_project`, `append_to_note`, `reorder_task`,
`set_task_repetition`, `add_notification` / `remove_notification` /
`list_notifications`, `create_folder` / `update_folder`, `create_tag` /
`update_tag`.

**Destructive:** `remove_item`, `batch_remove_items`, `delete_folder`
(cascades — deletes every project inside), `delete_tag`.

**Perspectives and attachments:** `update_perspective_rules` (replaces a custom
perspective's filter rules — read them first with `list_custom_perspectives`
`includeRules: true`; it overwrites and returns the previous rules for undo),
`manage_attachments` (`operation`: `list` / `read` / `add` / `remove` file
attachments on a task or project, 10MB limit).

**0.5.0 additions**

| Tool | Key argument |
| --- | --- |
| `search_items` | free-text query across tasks, projects, folders and tags (`types` narrows it) |
| `find_similar_tasks` | `name` — the task name you are about to create; `minScore` (default 0.35) tightens or loosens matching |
| `analyze` | `analysis`: `health_snapshot` \| `velocity` \| `overdue_clusters` \| `stalled_projects` |
| `manage_reviews` | `operation`: `list_due` \| `mark_reviewed` \| `set_schedule` |
| `app_control` | `operation`: `sync` \| `undo` \| `redo` \| `get_focus` \| `set_focus` \| `clear_focus` \| `reveal` |
| `update_perspective_rules` | `perspectiveName`/`perspectiveId` + `rules` — overwrites, so read the current rules first |
| `manage_attachments` | `operation`: `list` \| `read` \| `add` \| `remove` |

## Gotchas that actually bite

1. **Bare dates mean local midnight.** Valid ISO dates and timestamps with
   offsets or `Z` are accepted; impossible dates fail. Readable output uses local
   time, while structured output may carry ISO instants or epoch milliseconds.
   Present machine dates in the user’s local time.
2. **Never invent an id.** Ids come from a list/search tool and get passed back
   verbatim. In `edit_item` and `remove_item`, an id that matches nothing is a
   hard error — it does *not* fall back to the name.
3. **"Ambiguous name" means use the id.** Name lookups error when two items
   share a name rather than guessing. Re-run the lookup, take the id from the
   error, retry. For folders you can also pass a slash path
   (`Someday/Maybe/Travel`) or `newFolderId`. Tags accept unique parent/child
   paths or explicit `tagIds` / `addTagIds` / `removeTagIds` / `replaceTagIds`.
4. **Check before you create.** Run `find_similar_tasks` first; if a match
   exists, extend it with `append_to_note`/`edit_item` instead of creating a
   near-duplicate. Use an `idempotencyKey` for the intended create to coordinate
   retries across clients; a similarity search alone does not prevent a race.
5. **`filter_tasks` truncates.** `limit` defaults to 100 and caps at 1000, and
   the output says when results were capped. Use `countOnly` when you only need
   the number, and `offset` to page through a large result set — do not raise
   `limit` and dump everything into context.
6. **Sync once, at the end.** Call `app_control` sync after the last write of a
   session, not after every write. Each sync is a round trip.
7. **Undo is not a safety net you get for free.** `app_control` `undo`/`redo`
   need `confirm: true`; without it they only *report* the undo state and change
   nothing. They also step OmniFocus's own undo stack, which may not be the step
   you meant. Verify ids before deleting rather than relying on undo.
8. **Empty string clears a date.** In `edit_item`, `newDueDate: ""` clears the
   due date; omitting the field leaves it unchanged. Same for
   `newDeferDate`/`newPlannedDate`. `replaceTags: []` clears all tags; omitting
   `replaceTags` leaves tags alone.
9. **Tags vs perspectives.** `get_tasks_by_tag` takes a tag name. A user saying
   "my Today perspective" means `get_custom_perspective_tasks`.
10. **Unknown fields are rejected.** Every schema is strict — a typo'd argument
    fails loudly rather than being ignored. Read the error; it names the field.
11. **`edit_item` always needs `itemType`.** It is required (`"task"` or
    `"project"`) and decides which fields are legal: `newStatus`,
    `newProjectId`/`newProjectName`, `newParentTaskId`/`newParentTaskName` and
    `moveToInbox` are task-only; `newProjectStatus`, `newSequential`,
    `newFolderName`/`newFolderId` are project-only.

12. **Task queries exclude project roots.** `filter_tasks`, `get_task_counts`,
    `search_items`, `analyze` and forecast accept `includeProjectRoots: true` when
    needed. `dateMode` is `direct` by default for filters/counts/analytics and
    `effective` for forecast. Every week filter now starts Sunday by default;
    pass `weekStartsOn: "monday"` for a Monday week.
13. **Check structured results.** Use `structuredContent.data` for IDs, counts,
    changes and per-item verification. `verified: false` or partial rollback
    requires inspection of the returned surviving IDs before retrying.

## Recipes

**Daily plan**

1. `get_forecast_tasks` `{days: 1}` → today plus overdue.
2. `filter_tasks` `{plannedToday: true}` and `filter_tasks`
   `{flagged: true, taskStatus: ["Available", "Next"]}`.
3. Deduplicate by task id — the same task shows up in several views.
4. Sum `estimatedMinutes`; if the must-do set overruns the day, say so.
5. `edit_item` `{id, itemType: "task", newPlannedDate: "YYYY-MM-DD"}` per
   committed task.
6. `app_control` sync, once.

**Inbox triage**

1. `get_inbox_tasks`.
2. Per item: do / defer / delegate / delete.
3. `find_similar_tasks` before creating anything new.
4. File with one `edit_item` call carrying project, tags, and dates together
   (`{id, itemType: "task", newProjectName, addTags, newDeferDate}`).
5. `complete_task` for two-minute items, `remove_item` when deletion is authorized.
6. `app_control` sync, once.

**Weekly review**

1. `manage_reviews` `list_due` → projects whose review date has arrived.
2. `analyze` `stalled_projects` → which of them have no next action.
3. Per project: confirm status, add a next action with `add_omnifocus_task` if
   it stalled (change the project itself with `edit_item`
   `{id, itemType: "project", …}`), then `manage_reviews` `mark_reviewed` for
   that project id immediately — not batched at the end.
4. `get_inbox_tasks` sweep, `get_forecast_tasks` `{days: 7}` for the week ahead.
5. `app_control` sync, once.

## Reporting results

Report what the tools returned. Do not invent health scores, completion
percentages, or counts that no tool produced — `analyze` returns real numbers,
and everything else is a guess presented as data.
