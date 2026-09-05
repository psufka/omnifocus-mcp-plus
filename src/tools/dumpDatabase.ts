import { OmnifocusDatabase, OmnifocusTask, OmnifocusProject, OmnifocusFolder, OmnifocusTag } from '../types.js';
import { executeOmniFocusScript } from '../utils/scriptExecution.js';

import fs from 'fs';
// Define interfaces for the data returned from the script
interface OmnifocusDumpTask {
  id: string;
  name: string;
  note?: string;
  taskStatus: string;
  flagged: boolean;
  dueDate: string | null;
  deferDate: string | null;
  plannedDate: string | null;
  effectiveDueDate: string | null;
  effectiveDeferDate: string | null;
  effectivePlannedDate: string | null;
  completionDate?: string | null;
  dropDate?: string | null;
  repetitionRule?: string | null;
  estimatedMinutes: number | null;
  completedByChildren: boolean;
  sequential: boolean;
  tags: string[];
  projectID: string | null;
  parentTaskID: string | null;
  children: string[];
  inInbox: boolean;
}

interface OmnifocusDumpProject {
  id: string;
  name: string;
  status: string;
  folderID: string | null;
  sequential: boolean;
  effectiveDueDate: string | null;
  effectiveDeferDate: string | null;
  effectivePlannedDate: string | null;
  dueDate: string | null;
  deferDate: string | null;
  plannedDate: string | null;
  completedByChildren: boolean;
  containsSingletonActions: boolean;
  note: string;
  tasks: string[];
}

interface OmnifocusDumpFolder {
  id: string;
  name: string;
  parentFolderID: string | null;
  status: string;
  projects: string[];
  subfolders: string[];
}

interface OmnifocusDumpTag {
  id: string;
  name: string;
  parentTagID: string | null;
  active: boolean;
  allowsNextAction: boolean;
  tasks: string[];
}

// Reported by the dump script when completed/dropped tasks are included: the per-project
// cap that was applied and how many older completed tasks were left out.
export interface CompletedTaskSummary {
  cap: number;
  totalOmitted: number;
  omittedByContainer: Record<string, number>;
}

// The database plus the (optional) completed-task cap report
export interface OmnifocusDumpDatabase extends OmnifocusDatabase {
  completedSummary?: CompletedTaskSummary;
}

interface OmnifocusDumpData {
  exportDate: string;
  tasks: OmnifocusDumpTask[];
  projects: Record<string, OmnifocusDumpProject>;
  folders: Record<string, OmnifocusDumpFolder>;
  tags: Record<string, OmnifocusDumpTag>;
  completedSummary?: CompletedTaskSummary;
}

export interface DumpDatabaseOptions {
  // When false, completed and dropped items are included in the dump (capped per project)
  hideCompleted?: boolean;
}

// Main function to dump the database
export async function dumpDatabase(options: DumpDatabaseOptions = {}): Promise<OmnifocusDumpDatabase> {

  try {
    const hideCompleted = options.hideCompleted !== false; // Default to true

    // Execute the OmniFocus script
    const data = await executeOmniFocusScript('@omnifocusDump.js', { hideCompleted }, { readOnly: true }) as OmnifocusDumpData;
    // wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));

    // A failed or unparseable dump must error, not render an empty report
    if (data && (data as any).error) {
      throw new Error((data as any).error);
    }

    // Create an empty database if no data returned
    if (!data) {
      return {
        exportDate: new Date().toISOString(),
        tasks: [],
        projects: {},
        folders: {},
        tags: {}
      };
    }

    // Initialize the database object
    const database: OmnifocusDumpDatabase = {
      exportDate: data.exportDate,
      tasks: [],
      projects: {},
      folders: {},
      tags: {}
    };

    // Carry the completed-task cap report through so the report can note it
    if (data.completedSummary) {
      database.completedSummary = data.completedSummary;
    }

    // Process tasks
    if (data.tasks && Array.isArray(data.tasks)) {
      // Convert the tasks to our OmnifocusTask format
      database.tasks = data.tasks.map((task: OmnifocusDumpTask) => {
        // Get tag names from the tag IDs
        const tagNames = (task.tags || []).map(tagId => {
          return data.tags[tagId]?.name || 'Unknown Tag';
        });
        
        return {
          id: String(task.id),
          name: String(task.name),
          note: String(task.note || ""),
          flagged: Boolean(task.flagged),
          completed: task.taskStatus === "Completed",
          completionDate: task.completionDate || null,
          dropDate: task.dropDate || null,
          taskStatus: String(task.taskStatus),
          active: task.taskStatus !== "Completed" && task.taskStatus !== "Dropped",
          dueDate: task.dueDate,
          deferDate: task.deferDate,
          plannedDate: task.plannedDate,
          estimatedMinutes: task.estimatedMinutes ? Number(task.estimatedMinutes) : null,
          tags: task.tags || [],
          tagNames: tagNames,
          parentId: task.parentTaskID || null,
          containingProjectId: task.projectID || null,
          projectId: task.projectID || null,
          childIds: task.children || [],
          hasChildren: (task.children && task.children.length > 0) || false,
          sequential: Boolean(task.sequential),
          completedByChildren: Boolean(task.completedByChildren),
          isRepeating: Boolean(task.repetitionRule),
          repetitionMethod: null, // Not available in the new format
          repetitionRule: task.repetitionRule || null,
          attachments: [], // Default empty array
          linkedFileURLs: [], // Default empty array
          notifications: [], // Default empty array
          shouldUseFloatingTimeZone: false // Default value
        };
      });
    }
    
    // Process projects
    if (data.projects) {
      for (const [id, project] of Object.entries(data.projects)) {
        database.projects[id] = {
          id: String(project.id),
          name: String(project.name),
          status: String(project.status),
          folderID: project.folderID || null,
          sequential: Boolean(project.sequential),
          effectiveDueDate: project.effectiveDueDate,
          effectiveDeferDate: project.effectiveDeferDate,
          effectivePlannedDate: project.effectivePlannedDate,
          dueDate: project.dueDate,
          deferDate: project.deferDate,
          plannedDate: project.plannedDate,
          completedByChildren: Boolean(project.completedByChildren),
          containsSingletonActions: Boolean(project.containsSingletonActions),
          note: String(project.note || ""),
          tasks: project.tasks || [],
          flagged: false, // Default value
          estimatedMinutes: null // Default value
        };
      }
    }
    
    // Process folders
    if (data.folders) {
      for (const [id, folder] of Object.entries(data.folders)) {
        database.folders[id] = {
          id: String(folder.id),
          name: String(folder.name),
          parentFolderID: folder.parentFolderID || null,
          status: String(folder.status),
          projects: folder.projects || [],
          subfolders: folder.subfolders || []
        };
      }
    }
    
    // Process tags
    if (data.tags) {
      for (const [id, tag] of Object.entries(data.tags)) {
        database.tags[id] = {
          id: String(tag.id),
          name: String(tag.name),
          parentTagID: tag.parentTagID || null,
          active: Boolean(tag.active),
          allowsNextAction: Boolean(tag.allowsNextAction),
          tasks: tag.tasks || []
        };
      }
    }
    
    return database;
  } catch (error) {
    console.error("Error in dumpDatabase:", error);
    throw error;
  }
}

