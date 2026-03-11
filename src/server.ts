#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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
  version: "0.3.1"
});

// Register tools
server.tool(
  "dump_database",
  "Gets the current state of your OmniFocus database",
  dumpDatabaseTool.schema.shape,
  dumpDatabaseTool.handler
);

server.tool(
  "add_omnifocus_task",
  "Add a new task to OmniFocus",
  addOmniFocusTaskTool.schema.shape,
  addOmniFocusTaskTool.handler
);

server.tool(
  "add_project",
  "Add a new project to OmniFocus",
  addProjectTool.schema.shape,
  addProjectTool.handler
);

server.tool(
  "remove_item",
  "Remove a task or project from OmniFocus",
  removeItemTool.schema.shape,
  removeItemTool.handler
);

server.tool(
  "edit_item",
  "Edit a task or project in OmniFocus. Supports: rename, set/clear dates (due, defer, planned), flag/unflag, set status (complete, drop, reopen), add/remove/replace tags, set estimated minutes, move to different project/parent task/inbox.",
  editItemTool.schema.shape,
  editItemTool.handler
);

server.tool(
  "move_task",
  "Move an existing task to a project, parent task, or inbox",
  moveTaskTool.schema.shape,
  moveTaskTool.handler
);

server.tool(
  "batch_add_items",
  "Add multiple tasks or projects to OmniFocus in a single operation",
  batchAddItemsTool.schema.shape,
  batchAddItemsTool.handler
);

server.tool(
  "batch_remove_items",
  "Remove multiple tasks or projects from OmniFocus in a single operation",
  batchRemoveItemsTool.schema.shape,
  batchRemoveItemsTool.handler
);


server.tool(
  "get_task_by_id",
  "Get information about a specific task by ID or name",
  getTaskByIdTool.schema.shape,
  getTaskByIdTool.handler
);

server.tool(
  "get_today_completed_tasks",
  "Get tasks completed today - view today's accomplishments",
  getTodayCompletedTasksTool.schema.shape,
  getTodayCompletedTasksTool.handler
);

// Register perspective tools
server.tool(
  "get_inbox_tasks",
  "Get tasks from OmniFocus inbox perspective",
  getInboxTasksTool.schema.shape,
  getInboxTasksTool.handler
);

server.tool(
  "get_flagged_tasks", 
  "Get flagged tasks from OmniFocus with optional project filtering",
  getFlaggedTasksTool.schema.shape,
  getFlaggedTasksTool.handler
);

server.tool(
  "get_forecast_tasks",
  "Get tasks from OmniFocus forecast perspective (due/deferred tasks in date range)", 
  getForecastTasksTool.schema.shape,
  getForecastTasksTool.handler
);

server.tool(
  "get_tasks_by_tag",
  "Get tasks filtered by OmniFocus tags (labels like @home, @work, @urgent). Use this for tag-based filtering, NOT for custom perspective names. Tags are labels assigned to individual tasks.",
  getTasksByTagTool.schema.shape, 
  getTasksByTagTool.handler
);

// Ultimate filter tool - The most powerful task perspective engine
server.tool(
  "filter_tasks",
  "Advanced task filtering with unlimited perspective combinations - status, dates, projects, tags, search, and more",
  filterTasksTool.schema.shape,
  filterTasksTool.handler
);

// Custom perspective tools
server.tool(
  "list_custom_perspectives",
  "List all custom perspectives defined in OmniFocus",
  listCustomPerspectivesTool.schema.shape,
  listCustomPerspectivesTool.handler
);

server.tool(
  "get_custom_perspective_tasks",
  "Get tasks from a specific OmniFocus custom perspective by name. Use this when user refers to perspective names like 'Today', 'Weekly Review', 'This Week' etc. - these are custom views created in OmniFocus, NOT tags. Supports hierarchical tree display of task relationships.",
  getCustomPerspectiveTasksTool.schema.shape,
  getCustomPerspectiveTasksTool.handler
);

// --- New OmniJS-based tools ---

server.tool(
  "append_to_note",
  "Append text to a task or project's note without overwriting existing content",
  appendToNoteTool.schema.shape,
  appendToNoteTool.handler
);

server.tool(
  "uncomplete_task",
  "Mark a completed task as incomplete again",
  uncompleteTaskTool.schema.shape,
  uncompleteTaskTool.handler
);

server.tool(
  "set_task_repetition",
  "Set or clear a repeating schedule on a task using iCal RRULE syntax (e.g. FREQ=DAILY;INTERVAL=1)",
  setTaskRepetitionTool.schema.shape,
  setTaskRepetitionTool.handler
);

server.tool(
  "list_projects",
  "List and filter OmniFocus projects by folder, status, stalled state, with sorting and pagination",
  listProjectsTool.schema.shape,
  listProjectsTool.handler
);

server.tool(
  "search_projects",
  "Search OmniFocus projects by name query",
  searchProjectsTool.schema.shape,
  searchProjectsTool.handler
);

server.tool(
  "get_project_counts",
  "Get aggregate project counts by status (active, on hold, completed, dropped, stalled)",
  getProjectCountsTool.schema.shape,
  getProjectCountsTool.handler
);

server.tool(
  "get_task_counts",
  "Get aggregate task counts with optional filters (project, tag, flagged, date range). Returns total, available, completed, overdue, due soon, flagged, deferred.",
  getTaskCountsTool.schema.shape,
  getTaskCountsTool.handler
);

// Folder CRUD tools
server.tool(
  "list_folders",
  "List all OmniFocus folders with project counts",
  folderTools.listFoldersSchema.shape,
  folderTools.listFoldersHandler
);

server.tool(
  "get_folder",
  "Get details of an OmniFocus folder including its projects and subfolders",
  folderTools.getFolderSchema.shape,
  folderTools.getFolderHandler
);

server.tool(
  "create_folder",
  "Create a new folder in OmniFocus, optionally nested under a parent folder",
  folderTools.createFolderSchema.shape,
  folderTools.createFolderHandler
);

server.tool(
  "update_folder",
  "Update an OmniFocus folder's name or status",
  folderTools.updateFolderSchema.shape,
  folderTools.updateFolderHandler
);

server.tool(
  "delete_folder",
  "Delete an OmniFocus folder. WARNING: this also deletes all projects inside the folder.",
  folderTools.deleteFolderSchema.shape,
  folderTools.deleteFolderHandler
);

// Tag CRUD tools
server.tool(
  "list_tags",
  "List all OmniFocus tags with available task counts, filterable by status",
  tagTools.listTagsSchema.shape,
  tagTools.listTagsHandler
);

server.tool(
  "search_tags",
  "Search OmniFocus tags by name query",
  tagTools.searchTagsSchema.shape,
  tagTools.searchTagsHandler
);

server.tool(
  "create_tag",
  "Create a new tag in OmniFocus, optionally nested under a parent tag",
  tagTools.createTagSchema.shape,
  tagTools.createTagHandler
);

server.tool(
  "update_tag",
  "Update an OmniFocus tag's name or status",
  tagTools.updateTagSchema.shape,
  tagTools.updateTagHandler
);

server.tool(
  "delete_tag",
  "Delete an OmniFocus tag",
  tagTools.deleteTagSchema.shape,
  tagTools.deleteTagHandler
);

// New Phase 2 tools
server.tool(
  "list_subtasks",
  "List children (subtasks) of a task, optionally recursive to show full hierarchy",
  listSubtasksTool.schema.shape,
  listSubtasksTool.handler
);

server.tool(
  "duplicate_task",
  "Duplicate an existing task, optionally into a different project. Copies name, note, dates, flags, tags.",
  duplicateTaskTool.schema.shape,
  duplicateTaskTool.handler
);

server.tool(
  "batch_move_tasks",
  "Move multiple tasks to a project, parent task, or inbox in a single operation",
  batchMoveTasksTool.schema.shape,
  batchMoveTasksTool.handler
);

// Notification tools
server.tool(
  "list_notifications",
  "List all notifications (reminders) on a task",
  notificationTools.listNotificationsSchema.shape,
  notificationTools.listNotificationsHandler
);

server.tool(
  "add_notification",
  "Add a notification (reminder) to a task — absolute date or relative to due date",
  notificationTools.addNotificationSchema.shape,
  notificationTools.addNotificationHandler
);

server.tool(
  "remove_notification",
  "Remove a notification (reminder) from a task by index",
  notificationTools.removeNotificationSchema.shape,
  notificationTools.removeNotificationHandler
);

server.tool(
  "reorder_task",
  "Reorder a task within its container — move before/after a sibling, or to beginning/ending. Controls next action in sequential projects.",
  reorderTaskTool.schema.shape,
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
