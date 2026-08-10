# `filter_tasks` reference

Every field is optional and they combine as AND. Unknown fields are rejected —
the schema is strict.

## Status and scope

| Field | Type | Notes |
| --- | --- | --- |
| `taskStatus` | array of `Available` \| `Next` \| `Blocked` \| `DueSoon` \| `Overdue` \| `Completed` \| `Dropped` | Multiple values OR together. `Available` alone misses next actions and overdue work — actionable really means `["Available","Next","DueSoon","Overdue"]`. |
| `perspective` | `inbox` \| `flagged` \| `all` | Built-in scopes only. Named user perspectives go to `get_custom_perspective_tasks`. |
| `flagged` | boolean | |
| `searchText` | string | Matches task names and notes. |
| `nameContains` | string | Case-insensitive substring, name only. |
| `nameMatches` | string | Case-insensitive regex against the name. Invalid patterns are rejected. |
| `hasNote` | boolean | true = only tasks with a non-empty note; false = only tasks without one. |
| `isRepeating` | boolean | true = repeating tasks only; false = non-repeating only. |
| `estimatedMinutes` | object | `{lessThan, greaterThan, equals, between:[a,b]}`. All supplied comparators must hold; a task with no estimate never matches. Top level only — **not** a clause condition. |

## Project and tag

| Field | Type | Notes |
| --- | --- | --- |
| `projectFilter` | string | Partial name match. |
| `folderName` | string | Only tasks whose project sits in this folder or any folder nested inside it. Inbox tasks never match. |
| `folderId` | string | Same, by id. An id matching nothing is an error — it never falls back to the name. |
| `tagFilter` | string or array of strings | |
| `exactTagMatch` | boolean | Default false (partial match). Set true to avoid `work` matching `homework`. Top level only — inside a clause, tag matching is always substring. |
| `tagMatchMode` | `any` \| `all` | Default `any` (OR). `all` requires every tag. |

## Dates

Four independent date axes, each with a `Before`/`After` pair plus convenience
booleans:

- **Due** — `dueBefore`, `dueAfter`, `dueToday`, `dueThisWeek`, `dueThisMonth`,
  `overdue`
- **Defer** — `deferBefore`, `deferAfter`, `deferToday`, `deferThisWeek`,
  `deferAvailable` (defer date has passed, so the task is live now)
- **Planned** — `plannedBefore`, `plannedAfter`, `plannedToday`,
  `plannedThisWeek`, `plannedThisMonth`
- **Completed** — `completedBefore`, `completedAfter`, `completedToday`,
  `completedYesterday`, `completedThisWeek`, `completedThisMonth`

Three more `Before`/`After` pairs cover metadata, with no convenience booleans:
`addedBefore`/`addedAfter` (creation), `modifiedBefore`/`modifiedAfter`, and
`droppedBefore`/`droppedAfter` (which implies dropped tasks).

Rules that matter:

- A bare `YYYY-MM-DD` is local midnight that day. Full ISO 8601 with an offset
  is also accepted. Never pass a `…Z` string.
- Week boundaries are **not** uniform: `dueThisWeek` / `deferThisWeek` /
  `plannedThisWeek` run Sunday through Saturday; `completedThisWeek` runs from
  the most recent Monday. `completedThisMonth` starts at the 1st.
- Completion filters only make sense with `taskStatus: ["Completed"]`.

## Output controls

| Field | Type | Notes |
| --- | --- | --- |
| `limit` | integer 1–1000 | Default 100. Applied *after* filtering and sorting; the output says when results were capped. |
| `sortBy` | `name` \| `dueDate` \| `deferDate` \| `plannedDate` \| `completedDate` \| `flagged` \| `project` | |
| `sortOrder` | `asc` \| `desc` | Default `asc`. |
| `countOnly` | boolean | *0.5.0.* Returns the matching count without the task bodies — use this whenever the answer is a number. |
| `offset` | integer >= 0 | *0.5.0.* Skip this many results; page with `limit` instead of raising `limit`. A capped page prints the next `offset` to use. |
| `fields` | array of `dates` \| `status` \| `estimate` \| `note` \| `tags` \| `project` | *0.5.0.* Which optional detail components to render (`project` = per-project headings). Id and name always render; omit the field for all of them. |

## Boolean clauses (0.5.0)

`and` and `or` take arrays of condition objects, `not` takes one. They are one
level deep — conditions never nest inside conditions — and they AND with the
top-level filters.

A clause condition accepts exactly these keys, and nothing else (an unknown key
is rejected, never ignored):

`taskStatus`, `flagged`, `hasNote`, `isRepeating`, `projectFilter`, `tagFilter`,
`tagMatchMode`, `nameContains`, `nameMatches`, `searchText`, and the
`Before`/`After` pairs `due`, `defer`, `planned`, `completed`, `added`,
`modified`, `dropped`.

What is **top level only**, i.e. not usable inside a clause: `estimatedMinutes`,
`folderName`/`folderId`, `exactTagMatch` (clause tags always match by
substring), `perspective`, and every convenience boolean (`dueToday`,
`overdue`, `completedThisWeek`, …).

A clause date predicate requires the date to EXIST: a task that was never
completed does not satisfy `completedBefore`. A `not` clause only ever removes
tasks — `not: {taskStatus: ["Dropped"]}` does not widen the search to completed
work.

Check the live tool schema for exact argument shapes before using these — the
tool description is authoritative, this file is orientation.

## Reading the output

- `[id]` after each task name is the id to pass to `edit_item`,
  `complete_task`, `remove_item`, and friends.
- `(eff)` on a date means the task inherited it from its project or parent
  rather than carrying its own.
- Dates render in local format. If you ever see a trailing `Z`, that is a bug —
  report it rather than reinterpreting the value.
