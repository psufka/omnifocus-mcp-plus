# v0.5.0 Implementation Conventions

Shared contracts for the v0.5.0 feature batch. Every new tool and every
modified primitive follows these rules; the Phase-3 verifier checks them.

## Tool registration

`registerStrictTool(server, name, description, schema, handler, options?)` —
the new 6th param:

```ts
{
  annotations?: ToolAnnotations;   // REQUIRED for every tool in 0.5.0
  title?: string;
  cacheable?: boolean;             // read-only list-shaped tools only
  cacheTtlMs?: number;
}
```

Annotation presets (import from `../utils/registerStrictTool.js`):
- `READ_ONLY_TOOL` — pure reads.
- `ADDITIVE_TOOL` — creates data, destroys nothing (add task/project, append note).
- `MUTATING_TOOL` — edits or deletes existing data.
- Spread + override for nuance, e.g. idempotent complete:
  `{ ...MUTATING_TOOL, destructiveHint: false, idempotentHint: true }`.

Caching is wired centrally in registerStrictTool — **never add caching code to
a primitive**. Any non-read-only tool call clears the whole cache
automatically.

## Zod schemas

- Top-level objects get `.strict()` from registerStrictTool automatically, but
  **every NESTED object must call `.strict()` itself** — a non-strict nested
  clause object silently ignores typo'd keys, which for filter clauses means
  matching everything.
- Bare-date inputs (`YYYY-MM-DD`) go through `optionalIsoDate` /
  `toLocalDateTimeString` (`src/utils/localDate.ts`) like every existing date
  field.
- No recursive schemas (`z.lazy`) — clause bodies are one flat condition
  object.

## OmniJS scripts

- **Injection safety:** user data reaches scripts ONLY via the args-injection
  mechanism (`runOmniJs(script, args)` → `const args = {...}` or
  `executeOmniFocusScript`'s `injectedArgs`). NEVER template-interpolate user
  strings into script source. Regexes: build with `new RegExp(args.pattern)`,
  never as a literal.
- **Reserved const names** — `executeOmniFocusScript`'s parameter injection
  declares these at IIFE top; a packaged script (`omnifocusScripts/*.js`) run
  with args must NOT re-declare them at top level: `injectedArgs`,
  `perspectiveName`, `perspectiveId`, `hideCompleted`, `limit`,
  `includeBuiltIn`, `includeSidebar`, `format`, `tagName`, `exactMatch`.
  Injection also only happens if the script begins exactly with `(() => {`.
- **Single-script rule:** each operation is ONE OmniJS evaluation. Background
  sync mutates the DB between calls (observed live) — never read-modify-write
  across two script invocations. Rollback logic lives INSIDE the script.
- **Lookups:** always prepend `OMNIJS_LOOKUP_HELPERS`
  (`src/utils/omniJsHelpers.ts`) and use `__resolveByIdOrName` /
  `__resolveByNameOrId` / `__findById`. Never write ad-hoc name/id scans.
- **Verified API facts (probed live on OmniFocus 4.8.13 — do not "fix" these):**
  - `Task/Project/Tag/Folder.byIdentifier(id)` → object or `null` (no throw).
  - No `markReviewed` anywhere; set `lastReviewDate` / `nextReviewDate`.
  - No `Project.drop()`; assign `project.status = Project.Status.Dropped`.
  - No `numberOf*` / `availableTaskCount` properties (JXA-only); use `.length`
    on `tag.availableTasks`, `project.flattenedTasks`, etc.
  - No `task.next` / `task.blocked`; compare
    `task.taskStatus === Task.Status.X` (strict equality works).
  - `Object.keys()` returns `[]` on every OmniJS object/enum — use
    `Object.getOwnPropertyNames()` or explicit field lists. `JSON.stringify`
    on OmniJS objects yields `{}`.
  - Project has no `.added`/`.modified` — read `project.task.added` (root
    task shares the project's primaryKey). `Folder.parent` exists /
    `Project.parentFolder` exists (the inverse properties do not).
  - Sync is `document.sync()`; `undo`/`redo`/`canUndo`/`canRedo` are globals;
    `convertTasksToProjects` is a global; focus is `document.windows[0].focus`
    (settable SectionArray; empty = no focus).
  - Repetition rule fields: `{ruleString (bare ICS RRULE), method,
    scheduleType, anchorDateKey, catchUpAutomatically}`; enums
    `Task.RepetitionMethod {None, Fixed, DeferUntilDate, DueDate}`,
    `Task.RepetitionScheduleType {None, Regularly, FromCompletion}`,
    `Task.AnchorDateKey {DeferDate, PlannedDate, DueDate}`.

## Dates in output

**No new UTC leak:** never surface a raw `Date#toISOString()` (`…Z`) string to
the caller. OmniJS scripts may serialize dates as ISO (that's the wire
format); the Node-side definition must re-render them local
(`toLocaleDateString`/`toLocaleString`, or the compact formatters already in
use). "Today" comparisons use `src/utils/localDate.ts`.

## Result shapes

- `dryRun` (batch tools): same result structure as the real run with
  `dryRun: true` at top level and per-item `wouldCreate`/`wouldRemove`/
  `wouldMove` entries; NOTHING is written.
- Post-write verification: mutation results include `verified: boolean`
  (read-back inside the same script confirmed the write landed). A failed
  verification is reported as a failure, not silently as success.
- Batch per-item results keep the existing `coerceBatchResults` conventions
  (`src/utils/batchResults.ts`).

## Tests

- Every new OmniJS script (packaged or inline) gets syntax coverage following
  the existing script test pattern — unit tests that mock `runOmniJs` do NOT
  catch const-collisions or injection breakage.
- Runner: `npm test` (node:test via tsx). Type gate: `npx tsc --noEmit`.
- Do not weaken or delete existing tests to make new code pass.

## Executor options

`runOmniJs(script, args?, options?)` and
`executeOmniFocusScript(path, args?, options?)` take
`{ readOnly?: boolean }`. Pass `{ readOnly: true }` from every primitive whose
script performs no mutations; omit it for anything that writes. The
concurrency layer uses this to decide retry eligibility.
