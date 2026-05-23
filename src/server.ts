#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerStrictTool } from "./utils/registerStrictTool.js";

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

// Create an MCP server
const server = new McpServer({
  name: "OmniFocus MCP Plus",
  version: "0.3.2"
});

// Register tools
registerStrictTool(server,
  "dump_database",
  "Gets the current state of your OmniFocus database",
  dumpDatabaseTool.schema,
  dumpDatabaseTool.handler
);

registerStrictTool(server,
  "add_omnifocus_task",
  "Add a new task to OmniFocus",
  addOmniFocusTaskTool.schema,
  addOmniFocusTaskTool.handler
);

registerStrictTool(server,
  "add_project",
  "Add a new project to OmniFocus",
  addProjectTool.schema,
  addProjectTool.handler
);

registerStrictTool(server,
  "remove_item",
  "Remove a task or project from OmniFocus",
  removeItemTool.schema,
  removeItemTool.handler
);

registerStrictTool(server,
  "edit_item",
  "Edit a task or project in OmniFocus. Supports: rename, set/clear dates (due, defer, planned), flag/unflag, set status (complete, drop, reopen), add/remove/replace tags, set estimated minutes, move to different project/parent task/inbox.",
  editItemTool.schema,
  editItemTool.handler
);

registerStrictTool(server,
  "move_task",
  "Move an existing task to a project, parent task, or inbox",
  moveTaskTool.schema,
  moveTaskTool.handler
);

registerStrictTool(server,
  "batch_add_items",
  "Add multiple tasks or projects to OmniFocus in a single operation",
  batchAddItemsTool.schema,
  batchAddItemsTool.handler
);

registerStrictTool(server,
  "batch_remove_items",
  "Remove multiple tasks or projects from OmniFocus in a single operation",
  batchRemoveItemsTool.schema,
  batchRemoveItemsTool.handler
);


registerStrictTool(server,
  "get_task_by_id",
  "Get information about a specific task by ID or name",
  getTaskByIdTool.schema,
  getTaskByIdTool.handler
);

registerStrictTool(server,
  "get_today_completed_tasks",
  "Get tasks completed today - view today's accomplishments",
  getTodayCompletedTasksTool.schema,
  getTodayCompletedTasksTool.handler
);

// Register perspective tools
registerStrictTool(server,
  "get_inbox_tasks",
  "Get tasks from OmniFocus inbox perspective",
  getInboxTasksTool.schema,
  getInboxTasksTool.handler
);

registerStrictTool(server,
  "get_flagged_tasks", 
  "Get flagged tasks from OmniFocus with optional project filtering",
  getFlaggedTasksTool.schema,
  getFlaggedTasksTool.handler
);

registerStrictTool(server,
  "get_forecast_tasks",
  "Get tasks from OmniFocus forecast perspective (due/deferred tasks in date range)", 
  getForecastTasksTool.schema,
  getForecastTasksTool.handler
);

registerStrictTool(server,
  "get_tasks_by_tag",
  "Get tasks filtered by OmniFocus tags (labels like @home, @work, @urgent). Use this for tag-based filtering, NOT for custom perspective names. Tags are labels assigned to individual tasks.",
  getTasksByTagTool.schema, 
  getTasksByTagTool.handler
);

// Ultimate filter tool - The most powerful task perspective engine
registerStrictTool(server,
  "filter_tasks",
  "Advanced task filtering with unlimited perspective combinations - status, dates, projects, tags, search, and more",
  filterTasksTool.schema,
  filterTasksTool.handler
);

// Custom perspective tools
registerStrictTool(server,
  "list_custom_perspectives",
  "List all custom perspectives defined in OmniFocus",
  listCustomPerspectivesTool.schema,
  listCustomPerspectivesTool.handler
);

registerStrictTool(server,
  "get_custom_perspective_tasks",
  "Get tasks from a specific OmniFocus custom perspective by name. Use this when user refers to perspective names like 'Today', 'Weekly Review', 'This Week' etc. - these are custom views created in OmniFocus, NOT tags. Supports hierarchical tree display of task relationships.",
  getCustomPerspectiveTasksTool.schema,
  getCustomPerspectiveTasksTool.handler
);

// --- New OmniJS-based tools ---

registerStrictTool(server,
  "append_to_note",
  "Append text to a task or project's note without overwriting existing content",
  appendToNoteTool.schema,
  appendToNoteTool.handler
);

registerStrictTool(server,
  "uncomplete_task",
  "Mark a completed task as incomplete again",
  uncompleteTaskTool.schema,
  uncompleteTaskTool.handler
);

registerStrictTool(server,
  "complete_task",
  "Mark a task as completed (mirror of uncomplete_task). Errors if the task is already completed.",
  completeTaskTool.schema,
  completeTaskTool.handler
);

registerStrictTool(server,
  "set_task_repetition",
  "Set or clear a repeating schedule on a task using iCal RRULE syntax (e.g. FREQ=DAILY;INTERVAL=1)",
  setTaskRepetitionTool.schema,
  setTaskRepetitionTool.handler
);

registerStrictTool(server,
  "list_projects",
  "List and filter OmniFocus projects by folder, status, stalled state, with sorting and pagination",
  listProjectsTool.schema,
  listProjectsTool.handler
);

registerStrictTool(server,
  "search_projects",
  "Search OmniFocus projects by name query",
  searchProjectsTool.schema,
  searchProjectsTool.handler
);

registerStrictTool(server,
  "get_project_counts",
  "Get aggregate project counts by status (active, on hold, completed, dropped, stalled)",
  getProjectCountsTool.schema,
  getProjectCountsTool.handler
);

registerStrictTool(server,
  "get_task_counts",
  "Get aggregate task counts with optional filters (project, tag, flagged, date range). Returns total, available, completed, overdue, due soon, flagged, deferred.",
  getTaskCountsTool.schema,
  getTaskCountsTool.handler
);

// Folder CRUD tools
registerStrictTool(server,
  "list_folders",
  "List all OmniFocus folders with project counts",
  folderTools.listFoldersSchema,
  folderTools.listFoldersHandler
);

registerStrictTool(server,
  "get_folder",
  "Get details of an OmniFocus folder including its projects and subfolders",
  folderTools.getFolderSchema,
  folderTools.getFolderHandler
);

registerStrictTool(server,
  "create_folder",
  "Create a new folder in OmniFocus, optionally nested under a parent folder",
  folderTools.createFolderSchema,
  folderTools.createFolderHandler
);

registerStrictTool(server,
  "update_folder",
  "Update an OmniFocus folder's name or status",
  folderTools.updateFolderSchema,
  folderTools.updateFolderHandler
);

registerStrictTool(server,
  "delete_folder",
  "Delete an OmniFocus folder. WARNING: this also deletes all projects inside the folder.",
  folderTools.deleteFolderSchema,
  folderTools.deleteFolderHandler
);

// Tag CRUD tools
registerStrictTool(server,
  "list_tags",
  "List all OmniFocus tags with available task counts, filterable by status",
  tagTools.listTagsSchema,
  tagTools.listTagsHandler
);

registerStrictTool(server,
  "search_tags",
  "Search OmniFocus tags by name query",
  tagTools.searchTagsSchema,
  tagTools.searchTagsHandler
);

registerStrictTool(server,
  "create_tag",
  "Create a new tag in OmniFocus, optionally nested under a parent tag",
  tagTools.createTagSchema,
  tagTools.createTagHandler
);

registerStrictTool(server,
  "update_tag",
  "Update an OmniFocus tag's name or status",
  tagTools.updateTagSchema,
  tagTools.updateTagHandler
);

registerStrictTool(server,
  "delete_tag",
  "Delete an OmniFocus tag",
  tagTools.deleteTagSchema,
  tagTools.deleteTagHandler
);

// New Phase 2 tools
registerStrictTool(server,
  "list_subtasks",
  "List children (subtasks) of a task, optionally recursive to show full hierarchy",
  listSubtasksTool.schema,
  listSubtasksTool.handler
);

registerStrictTool(server,
  "duplicate_task",
  "Duplicate an existing task, optionally into a different project. Copies name, note, dates, flags, tags.",
  duplicateTaskTool.schema,
  duplicateTaskTool.handler
);

registerStrictTool(server,
  "batch_move_tasks",
  "Move multiple tasks to a project, parent task, or inbox in a single operation",
  batchMoveTasksTool.schema,
  batchMoveTasksTool.handler
);

// Notification tools
registerStrictTool(server,
  "list_notifications",
  "List all notifications (reminders) on a task",
  notificationTools.listNotificationsSchema,
  notificationTools.listNotificationsHandler
);

registerStrictTool(server,
  "add_notification",
  "Add a notification (reminder) to a task — absolute date or relative to due date",
  notificationTools.addNotificationSchema,
  notificationTools.addNotificationHandler
);

registerStrictTool(server,
  "remove_notification",
  "Remove a notification (reminder) from a task by index",
  notificationTools.removeNotificationSchema,
  notificationTools.removeNotificationHandler
);

registerStrictTool(server,
  "reorder_task",
  "Reorder a task within its container — move before/after a sibling, or to beginning/ending. Controls next action in sequential projects.",
  reorderTaskTool.schema,
  reorderTaskTool.handler
);

// Start the MCP server
const transport = new StdioServerTransport();

// Use await with server.connect to ensure proper connection
(async function() {
  try {
    await server.connect(transport);
  } catch (err) {
    console.error(`Failed to start MCP server: ${err}`);
  }
})();

// For a cleaner shutdown if the process is terminated
