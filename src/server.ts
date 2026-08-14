#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import {
  registerStrictTool,
  READ_ONLY_TOOL,
  ADDITIVE_TOOL,
  MUTATING_TOOL,
} from "./utils/registerStrictTool.js";
import { registerPrompts } from "./tools/prompts.js";
import { registerResources } from "./tools/resources.js";
import { SERVER_INSTRUCTIONS } from "./utils/instructions.js";

// Import tool definitions
import * as dumpDatabaseTool from './tools/definitions/dumpDatabase.js';
import * as addOmniFocusTaskTool from './tools/definitions/addOmniFocusTask.js';
import * as addProjectTool from './tools/definitions/addProject.js';
import * as removeItemTool from './tools/definitions/removeItem.js';
import * as editItemTool from './tools/definitions/editItem.js';
import * as moveTaskTool from './tools/definitions/moveTask.js';
import * as batchAddItemsTool from './tools/definitions/batchAddItems.js';
import * as batchRemoveItemsTool from './tools/definitions/batchRemoveItems.js';
import * as getTaskByIdTool from './tools/definitions/getTaskById.js';
import * as getTodayCompletedTasksTool from './tools/definitions/getTodayCompletedTasks.js';
// Import perspective tools
import * as getInboxTasksTool from './tools/definitions/getInboxTasks.js';
import * as getFlaggedTasksTool from './tools/definitions/getFlaggedTasks.js';
import * as getForecastTasksTool from './tools/definitions/getForecastTasks.js';
import * as getTasksByTagTool from './tools/definitions/getTasksByTag.js';
// Import ultimate filter tool
import * as filterTasksTool from './tools/definitions/filterTasks.js';
// Import custom perspective tools
import * as listCustomPerspectivesTool from './tools/definitions/listCustomPerspectives.js';
import * as getCustomPerspectiveTasksTool from './tools/definitions/getCustomPerspectiveTasks.js';
// Import new OmniJS-based tools
import * as appendToNoteTool from './tools/definitions/appendToNote.js';
import * as uncompleteTaskTool from './tools/definitions/uncompleteTask.js';
import * as completeTaskTool from './tools/definitions/completeTask.js';
import * as setTaskRepetitionTool from './tools/definitions/setTaskRepetition.js';
import * as listProjectsTool from './tools/definitions/listProjects.js';
import * as searchProjectsTool from './tools/definitions/searchProjects.js';
import * as getProjectCountsTool from './tools/definitions/getProjectCounts.js';
import * as getTaskCountsTool from './tools/definitions/getTaskCounts.js';
import * as folderTools from './tools/definitions/folderTools.js';
import * as tagTools from './tools/definitions/tagTools.js';
import * as listSubtasksTool from './tools/definitions/listSubtasks.js';
import * as duplicateTaskTool from './tools/definitions/duplicateTask.js';
import * as batchMoveTasksTool from './tools/definitions/batchMoveTasks.js';
import * as notificationTools from './tools/definitions/notificationTools.js';
import * as reorderTaskTool from './tools/definitions/reorderTask.js';
// 0.5.0 tools
import * as manageReviewsTool from './tools/definitions/manageReviews.js';
import * as convertTaskToProjectTool from './tools/definitions/convertTaskToProject.js';
import * as analyzeTool from './tools/definitions/analyze.js';
import * as updatePerspectiveRulesTool from './tools/definitions/updatePerspectiveRules.js';
import * as findSimilarTasksTool from './tools/definitions/findSimilarTasks.js';
import * as manageAttachmentsTool from './tools/definitions/manageAttachments.js';
import * as appControlTool from './tools/definitions/appControl.js';
import * as searchItemsTool from './tools/definitions/searchItems.js';

// Build the MCP server with every tool registered. Exported so tests can
// measure the real advertised tool surface without connecting a transport.
export function buildServer(): McpServer {
const server = new McpServer(
  {
    name: "OmniFocus MCP Plus",
    version: "0.5.1"
  },
  { instructions: SERVER_INSTRUCTIONS }
);

// Register tools
registerStrictTool(server,
  "dump_database",
  "Gets the current state of your OmniFocus database",
  dumpDatabaseTool.schema,
  dumpDatabaseTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Dump database" }
);

registerStrictTool(server,
  "add_omnifocus_task",
  "Add a new task to OmniFocus. Before creating a task that may already exist, call find_similar_tasks with the same name and reuse the returned id instead if a strong match comes back.",
  addOmniFocusTaskTool.schema,
  addOmniFocusTaskTool.handler,
  { annotations: ADDITIVE_TOOL, title: "Add task" }
);

registerStrictTool(server,
  "add_project",
  "Add a new project to OmniFocus",
  addProjectTool.schema,
  addProjectTool.handler,
  { annotations: ADDITIVE_TOOL, title: "Add project" }
);

registerStrictTool(server,
  "remove_item",
  "Remove a task or project from OmniFocus",
  removeItemTool.schema,
  removeItemTool.handler,
  { annotations: MUTATING_TOOL, title: "Remove item" }
);

registerStrictTool(server,
  "edit_item",
  "Edit a task or project in OmniFocus. Supports: rename, set/clear dates (due, defer, planned), flag/unflag, set status (complete, drop, reopen), add/remove/replace tags, set estimated minutes, move to different project/parent task/inbox.",
  editItemTool.schema,
  editItemTool.handler,
  { annotations: MUTATING_TOOL, title: "Edit item" }
);

registerStrictTool(server,
  "move_task",
  "Move an existing task to a project, parent task, or inbox",
  moveTaskTool.schema,
  moveTaskTool.handler,
  { annotations: MUTATING_TOOL, title: "Move task" }
);

registerStrictTool(server,
  "batch_add_items",
  "Add multiple tasks or projects to OmniFocus in a single operation. Supports tempId/parentTempId hierarchy wiring, dryRun preview, stopOnError, and atomic rollback. Before adding tasks that may already exist, call find_similar_tasks for each name and drop or replace any item with a strong match — batch creation multiplies duplicates.",
  batchAddItemsTool.schema,
  batchAddItemsTool.handler,
  { annotations: ADDITIVE_TOOL, title: "Batch add items" }
);

registerStrictTool(server,
  "batch_remove_items",
  "Remove multiple tasks or projects from OmniFocus in a single operation",
  batchRemoveItemsTool.schema,
  batchRemoveItemsTool.handler,
  { annotations: MUTATING_TOOL, title: "Batch remove items" }
);


registerStrictTool(server,
  "get_task_by_id",
  "Get information about a specific task by ID or name",
  getTaskByIdTool.schema,
  getTaskByIdTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Get task by ID" }
);

registerStrictTool(server,
  "get_today_completed_tasks",
  "Get tasks completed today - view today's accomplishments",
  getTodayCompletedTasksTool.schema,
  getTodayCompletedTasksTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Completed today" }
);

// Register perspective tools
registerStrictTool(server,
  "get_inbox_tasks",
  "Get tasks from OmniFocus inbox perspective",
  getInboxTasksTool.schema,
  getInboxTasksTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Inbox tasks" }
);

registerStrictTool(server,
  "get_flagged_tasks", 
  "Get flagged tasks from OmniFocus with optional project filtering",
  getFlaggedTasksTool.schema,
  getFlaggedTasksTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Flagged tasks" }
);

registerStrictTool(server,
  "get_forecast_tasks",
  "Get tasks from OmniFocus forecast perspective (due/deferred tasks in date range)", 
  getForecastTasksTool.schema,
  getForecastTasksTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Forecast tasks" }
);

registerStrictTool(server,
  "get_tasks_by_tag",
  "Get tasks filtered by OmniFocus tags (labels like @home, @work, @urgent). Use this for tag-based filtering, NOT for custom perspective names. Tags are labels assigned to individual tasks.",
  getTasksByTagTool.schema, 
  getTasksByTagTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Tasks by tag" }
);

// Ultimate filter tool - The most powerful task perspective engine
registerStrictTool(server,
  "filter_tasks",
  "Advanced task filtering: status, dates (due/defer/planned/completed/added/modified/dropped), project, folder tree, tags, name/regex, note, repeat, estimate — plus and/or/not clauses, countOnly, field projection, and offset paging.",
  filterTasksTool.schema,
  filterTasksTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Filter tasks" }
);

// Custom perspective tools
registerStrictTool(server,
  "list_custom_perspectives",
  "List all custom perspectives defined in OmniFocus. Pass includeRules to also get each perspective's filter rules and aggregation.",
  listCustomPerspectivesTool.schema,
  listCustomPerspectivesTool.handler,
  { annotations: READ_ONLY_TOOL, cacheable: true, title: "List custom perspectives" }
);

registerStrictTool(server,
  "get_custom_perspective_tasks",
  "Get tasks from a specific OmniFocus custom perspective by name. Use this when user refers to perspective names like 'Today', 'Weekly Review', 'This Week' etc. - these are custom views created in OmniFocus, NOT tags. Supports hierarchical tree display of task relationships.",
  getCustomPerspectiveTasksTool.schema,
  getCustomPerspectiveTasksTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Custom perspective tasks" }
);

// --- New OmniJS-based tools ---

registerStrictTool(server,
  "append_to_note",
  "Append text to a task or project's note without overwriting existing content",
  appendToNoteTool.schema,
  appendToNoteTool.handler,
  { annotations: ADDITIVE_TOOL, title: "Append to note" }
);

registerStrictTool(server,
  "uncomplete_task",
  "Mark a completed task as incomplete again",
  uncompleteTaskTool.schema,
  uncompleteTaskTool.handler,
  { annotations: { ...MUTATING_TOOL, destructiveHint: false }, title: "Uncomplete task" }
);

registerStrictTool(server,
  "complete_task",
  "Mark a task as completed (mirror of uncomplete_task). Idempotent: completing an already-completed task succeeds with a note.",
  completeTaskTool.schema,
  completeTaskTool.handler,
  { annotations: { ...MUTATING_TOOL, destructiveHint: false, idempotentHint: true }, title: "Complete task" }
);

registerStrictTool(server,
  "set_task_repetition",
  "Set or clear a repeating schedule on a task. Use the structured fields (frequency/interval/daysOfWeek/daysOfMonth/count/endDate) — e.g. 2nd Tuesday monthly — or pass a raw iCal RRULE via rule_string. Verified by read-back.",
  setTaskRepetitionTool.schema,
  setTaskRepetitionTool.handler,
  { annotations: MUTATING_TOOL, title: "Set task repetition" }
);

registerStrictTool(server,
  "list_projects",
  "List and filter OmniFocus projects by folder, status, stalled state, with sorting and pagination",
  listProjectsTool.schema,
  listProjectsTool.handler,
  { annotations: READ_ONLY_TOOL, cacheable: true, title: "List projects" }
);

registerStrictTool(server,
  "search_projects",
  "Search OmniFocus projects by name query",
  searchProjectsTool.schema,
  searchProjectsTool.handler,
  { annotations: READ_ONLY_TOOL, cacheable: true, title: "Search projects" }
);

registerStrictTool(server,
  "get_project_counts",
  "Get aggregate project counts by status (active, on hold, completed, dropped, stalled)",
  getProjectCountsTool.schema,
  getProjectCountsTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Project counts" }
);

registerStrictTool(server,
  "get_task_counts",
  "Get aggregate task counts with optional filters (project, tag, flagged, date range). Returns total, available, completed, overdue, due soon, flagged, deferred.",
  getTaskCountsTool.schema,
  getTaskCountsTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Task counts" }
);

// Folder CRUD tools
registerStrictTool(server,
  "list_folders",
  "List all OmniFocus folders with project counts",
  folderTools.listFoldersSchema,
  folderTools.listFoldersHandler,
  { annotations: READ_ONLY_TOOL, cacheable: true, title: "List folders" }
);

registerStrictTool(server,
  "get_folder",
  "Get details of an OmniFocus folder including its projects and subfolders",
  folderTools.getFolderSchema,
  folderTools.getFolderHandler,
  { annotations: READ_ONLY_TOOL, title: "Get folder" }
);

registerStrictTool(server,
  "create_folder",
  "Create a new folder in OmniFocus, optionally nested under a parent folder",
  folderTools.createFolderSchema,
  folderTools.createFolderHandler,
  { annotations: ADDITIVE_TOOL, title: "Create folder" }
);

registerStrictTool(server,
  "update_folder",
  "Update an OmniFocus folder's name or status",
  folderTools.updateFolderSchema,
  folderTools.updateFolderHandler,
  { annotations: MUTATING_TOOL, title: "Update folder" }
);

registerStrictTool(server,
  "delete_folder",
  "Delete an OmniFocus folder. WARNING: this also deletes all projects inside the folder.",
  folderTools.deleteFolderSchema,
  folderTools.deleteFolderHandler,
  { annotations: MUTATING_TOOL, title: "Delete folder" }
);

// Tag CRUD tools
registerStrictTool(server,
  "list_tags",
  "List all OmniFocus tags with available task counts, filterable by status",
  tagTools.listTagsSchema,
  tagTools.listTagsHandler,
  { annotations: READ_ONLY_TOOL, cacheable: true, title: "List tags" }
);

registerStrictTool(server,
  "search_tags",
  "Search OmniFocus tags by name query",
  tagTools.searchTagsSchema,
  tagTools.searchTagsHandler,
  { annotations: READ_ONLY_TOOL, cacheable: true, title: "Search tags" }
);

registerStrictTool(server,
  "create_tag",
  "Create a new tag in OmniFocus, optionally nested under a parent tag",
  tagTools.createTagSchema,
  tagTools.createTagHandler,
  { annotations: ADDITIVE_TOOL, title: "Create tag" }
);

registerStrictTool(server,
  "update_tag",
  "Update an OmniFocus tag's name or status",
  tagTools.updateTagSchema,
  tagTools.updateTagHandler,
  { annotations: MUTATING_TOOL, title: "Update tag" }
);

registerStrictTool(server,
  "delete_tag",
  "Delete an OmniFocus tag",
  tagTools.deleteTagSchema,
  tagTools.deleteTagHandler,
  { annotations: MUTATING_TOOL, title: "Delete tag" }
);

// New Phase 2 tools
registerStrictTool(server,
  "list_subtasks",
  "List children (subtasks) of a task, optionally recursive to show full hierarchy",
  listSubtasksTool.schema,
  listSubtasksTool.handler,
  { annotations: READ_ONLY_TOOL, title: "List subtasks" }
);

registerStrictTool(server,
  "duplicate_task",
  "Duplicate an existing task, optionally into a different project. Copies name, note, dates, flags, tags.",
  duplicateTaskTool.schema,
  duplicateTaskTool.handler,
  { annotations: ADDITIVE_TOOL, title: "Duplicate task" }
);

registerStrictTool(server,
  "batch_move_tasks",
  "Move multiple tasks to a project, parent task, or inbox in a single operation",
  batchMoveTasksTool.schema,
  batchMoveTasksTool.handler,
  { annotations: MUTATING_TOOL, title: "Batch move tasks" }
);

// Notification tools
registerStrictTool(server,
  "list_notifications",
  "List all notifications (reminders) on a task",
  notificationTools.listNotificationsSchema,
  notificationTools.listNotificationsHandler,
  { annotations: READ_ONLY_TOOL, title: "List notifications" }
);

registerStrictTool(server,
  "add_notification",
  "Add a notification (reminder) to a task — absolute date or relative to due date",
  notificationTools.addNotificationSchema,
  notificationTools.addNotificationHandler,
  { annotations: ADDITIVE_TOOL, title: "Add notification" }
);

registerStrictTool(server,
  "remove_notification",
  "Remove a notification (reminder) from a task by index",
  notificationTools.removeNotificationSchema,
  notificationTools.removeNotificationHandler,
  { annotations: MUTATING_TOOL, title: "Remove notification" }
);

registerStrictTool(server,
  "reorder_task",
  "Reorder a task within its container — move before/after a sibling, or to beginning/ending. Controls next action in sequential projects.",
  reorderTaskTool.schema,
  reorderTaskTool.handler,
  { annotations: { ...MUTATING_TOOL, destructiveHint: false }, title: "Reorder task" }
);

// --- 0.5.0 tools ---

registerStrictTool(server,
  "manage_reviews",
  "Project review workflow. 'list_due' lists projects whose review date has arrived (all: true = every scheduled project); 'mark_reviewed' stamps one project or up to 100 via projectIds and advances each next review date by its own interval; 'set_schedule' sets the review interval (unit + steps).",
  manageReviewsTool.schema,
  manageReviewsTool.handler,
  { annotations: MUTATING_TOOL, title: "Manage project reviews" }
);

registerStrictTool(server,
  "convert_task_to_project",
  "Promote an existing task into a full project, keeping its subtasks, tags, and note. Optionally file it into a folder; without one the new project lands at the top level of the library.",
  convertTaskToProjectTool.schema,
  convertTaskToProjectTool.handler,
  { annotations: { ...MUTATING_TOOL, destructiveHint: false }, title: "Convert task to project" }
);

registerStrictTool(server,
  "analyze",
  "Read-only analytics over the OmniFocus database: health_snapshot, velocity, overdue_clusters, or stalled_projects. Returns counts, rates, lists and dates as markdown — no scores and no recommendations — so the caller does the interpreting.",
  analyzeTool.schema,
  analyzeTool.handler,
  { annotations: READ_ONLY_TOOL, cacheable: true, cacheTtlMs: 60_000, title: "Analyze database" }
);

registerStrictTool(server,
  "update_perspective_rules",
  "Replace a custom perspective's filter rules (and optionally its aggregation). Overwrites — read current rules first via list_custom_perspectives includeRules. Keys are validated before writing (OmniFocus silently accepts invalid rules), the write is read-back verified with rollback, and the previous rules are returned for undo.",
  updatePerspectiveRulesTool.schema,
  updatePerspectiveRulesTool.handler,
  { annotations: MUTATING_TOOL, title: "Update perspective rules" }
);

registerStrictTool(server,
  "find_similar_tasks",
  "Find existing OmniFocus tasks whose names are similar to a proposed new task name. Run this BEFORE creating a task that might already exist — it returns ranked matches with similarity scores and task IDs so you can reuse an existing task instead of creating a duplicate. Tolerant of typos, word reordering, and partial names.",
  findSimilarTasksTool.schema,
  findSimilarTasksTool.handler,
  { annotations: READ_ONLY_TOOL, cacheable: true, title: "Find similar tasks" }
);

registerStrictTool(server,
  "manage_attachments",
  "List, read, add, or remove file attachments on a task or project. 'read' returns small files inline as base64 and writes larger ones to an absolute savePath; 'add' takes either base64 content or an absolute filePath. 10MB limit either way.",
  manageAttachmentsTool.schema,
  manageAttachmentsTool.handler,
  { annotations: MUTATING_TOOL, title: "Manage attachments" }
);

registerStrictTool(server,
  "app_control",
  "Application-level OmniFocus control: start a sync, step the undo/redo stack, read/set/clear the sidebar focus of the front window, or reveal (select) a task or project. Undo and redo are destructive and require confirm: true — the top of the undo stack is often the user's own manual edit.",
  appControlTool.schema,
  appControlTool.handler,
  { annotations: MUTATING_TOOL, title: "OmniFocus app control" }
);

registerStrictTool(server,
  "search_items",
  "Search tasks, projects, folders, and tags in one pass by name (optionally notes). Case-insensitive substring match; returns ids grouped by type with honest per-type totals.",
  searchItemsTool.schema,
  searchItemsTool.handler,
  { annotations: READ_ONLY_TOOL, title: "Search items" }
);

// MCP prompts, resources, and handshake instructions
registerPrompts(server);
registerResources(server);

return server;
}

// Connect the stdio transport only when run as the entry point (MCP clients
// invoke `node dist/server.js`); importing buildServer never starts I/O.
function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  (async function () {
    try {
      await server.connect(transport);
    } catch (err) {
      console.error(`Failed to start MCP server: ${err}`);
    }
  })();
}
