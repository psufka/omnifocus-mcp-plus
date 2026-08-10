import { z } from 'zod';
import { dumpDatabase } from '../dumpDatabase.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

// Container key used by omnifocusDump.js for completed tasks that live in the inbox
const INBOX_CONTAINER_KEY = '__inbox__';

export const schema = z.object({
  hideCompleted: z.boolean().optional().describe("Set to false to show completed and dropped tasks (default: true). Completed/dropped tasks are capped at the most recent 50 per project; the report notes how many were omitted."),
  hideRecurringDuplicates: z.boolean().optional().describe("When completed tasks are shown (hideCompleted: false), collapse repeated completed instances of the same recurring task — same name, same project, has a repetition rule — into the most recent instance, marked '(×N completed instances)'. Has no effect when hideCompleted is true (default: true)")
}).strict();

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra<any, any>) {
  try {
    const hideCompleted = args.hideCompleted !== false; // Default to true

    // Get raw database
    const database = await dumpDatabase({ hideCompleted });

    // Format as compact report
    const formattedReport = formatCompactReport(database, {
      hideCompleted,
      hideRecurringDuplicates: args.hideRecurringDuplicates !== false // Default to true
    });

    return {
      content: [{
        type: "text" as const,
        text: formattedReport
      }]
    };
  } catch (err: unknown) {
    return {
      content: [{
        type: "text" as const,
        text: `Error generating report. Please ensure OmniFocus is running and try again.`
      }],
      isError: true
    };
  }
}

// Function to format date in compact format (M/D)
function formatCompactDate(isoDate: string | null): string {
  if (!isoDate) return '';

  const date = new Date(isoDate);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// A task is finished when it is completed or dropped
function isFinished(task: any): boolean {
  return Boolean(task.completed) || task.taskStatus === 'Completed' || task.taskStatus === 'Dropped';
}

// Timestamp a task was finished, used to pick the most recent recurring instance
function finishedTime(task: any): number {
  const finished = task.completionDate || task.dropDate;
  if (!finished) return 0;
  const parsed = Date.parse(finished);
  return isNaN(parsed) ? 0 : parsed;
}

// Function to format the database in the compact report format
export function formatCompactReport(database: any, options: { hideCompleted: boolean, hideRecurringDuplicates: boolean }): string {
  const { hideCompleted, hideRecurringDuplicates } = options;

  // Get current date for the header — LOCAL calendar day (toISOString is UTC
  // and would show tomorrow's date after ~7pm Central).
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let output = `# OMNIFOCUS [${dateStr}]\n\n`;

  // Add legend
  output += `FORMAT LEGEND:
F: Folder | P: Project | •: Task | 🚩: Flagged
Dates: [M/D] | [DUE:M/D] [PLAN:M/D] [defer:M/D] | Duration: (30m) or (2h) | Tags: <tag1,tag2>
Status: #next #avail #block #due #over #compl #drop\n\n`;

  const allTasks: any[] = Array.isArray(database.tasks) ? database.tasks : [];

  // Cap report emitted by the dump script when completed items are included
  const completedSummary = database.completedSummary || null;
  const omittedByContainer: Record<string, number> = (completedSummary && completedSummary.omittedByContainer) || {};

  if (!hideCompleted) {
    const cap = completedSummary && completedSummary.cap;
    let note = 'NOTE: completed and dropped items included';
    if (cap) {
      note += ` (capped at the ${cap} most recent completed tasks per project)`;
    }
    note += '.';
    const totalOmitted = (completedSummary && completedSummary.totalOmitted) || 0;
    if (totalOmitted > 0) {
      note += ` ${totalOmitted} older completed tasks omitted.`;
    }
    if (hideRecurringDuplicates) {
      note += ' Repeating completed instances are collapsed.';
    }
    output += `${note}\n\n`;
  }

  // Map of folder IDs to folder objects for quick lookup
  const folderMap = new Map<string, any>();
  Object.values(database.folders || {}).forEach((folder: any) => {
    folderMap.set(folder.id, folder);
  });

  // Get all tag names to compute minimum unique prefixes
  const allTagNames = Object.values(database.tags || {}).map((tag: any) => tag.name);
  const tagPrefixMap = computeMinimumUniquePrefixes(allTagNames);

  // Precomputed indexes so projects and parent tasks do not each rescan every task
  const rootTasksByProject = new Map<string, any[]>();
  const childTasksByParent = new Map<string, any[]>();
  const rootInboxTasks: any[] = [];

  for (const task of allTasks) {
    if (task.parentId) {
      const siblings = childTasksByParent.get(task.parentId);
      if (siblings) {
        siblings.push(task);
      } else {
        childTasksByParent.set(task.parentId, [task]);
      }
    } else if (task.projectId) {
      const siblings = rootTasksByProject.get(task.projectId);
      if (siblings) {
        siblings.push(task);
      } else {
        rootTasksByProject.set(task.projectId, [task]);
      }
    } else {
      rootInboxTasks.push(task);
    }
  }

  // Collapse repeated completed instances of the same recurring task down to the most
  // recent one. Only relevant when completed tasks are being shown.
  const suppressedTaskIds = new Set<string>();
  const recurringInstanceCounts = new Map<string, number>();

  if (!hideCompleted && hideRecurringDuplicates) {
    const recurringGroups = new Map<string, any[]>();

    for (const task of allTasks) {
      if (!isFinished(task) || !task.repetitionRule) continue;
      const key = `${task.projectId || ''}\u0000${task.name}`;
      const group = recurringGroups.get(key);
      if (group) {
        group.push(task);
      } else {
        recurringGroups.set(key, [task]);
      }
    }

    recurringGroups.forEach((group) => {
      if (group.length < 2) return;

      let keeper = group[0];
      for (const task of group) {
        if (finishedTime(task) > finishedTime(keeper)) {
          keeper = task;
        }
      }

      recurringInstanceCounts.set(keeper.id, group.length);
      for (const task of group) {
        if (task.id !== keeper.id) {
          suppressedTaskIds.add(task.id);
        }
      }
    });
  }

  // Should this task be left out of the report entirely?
  function isHiddenTask(task: any): boolean {
    if (hideCompleted && isFinished(task)) return true;
    return suppressedTaskIds.has(task.id);
  }

  // Function to get folder hierarchy path
  function getFolderPath(folderId: string): string[] {
    const path = [];
    let currentId = folderId;

    while (currentId) {
      const folder = folderMap.get(currentId);
      if (!folder) break;

      path.unshift(folder.name);
      currentId = folder.parentFolderID;
    }

    return path;
  }

  // Get root folders (no parent)
  const rootFolders = Object.values(database.folders || {}).filter((folder: any) => !folder.parentFolderID);

  // Process folders recursively
  function processFolder(folder: any, level: number): string {
    const indent = '   '.repeat(level);
    let folderOutput = `${indent}F: ${folder.name}\n`;

    // Process subfolders
    if (folder.subfolders && folder.subfolders.length > 0) {
      for (const subfolderId of folder.subfolders) {
        const subfolder = database.folders[subfolderId];
        if (subfolder) {
          folderOutput += `${processFolder(subfolder, level + 1)}`;
        }
      }
    }

    // Process projects in this folder
    if (folder.projects && folder.projects.length > 0) {
      for (const projectId of folder.projects) {
        const project = database.projects[projectId];
        if (project) {
          folderOutput += processProject(project, level + 1);
        }
      }
    }

    return folderOutput;
  }

  // Process a project
  function processProject(project: any, level: number): string {
    const indent = '   '.repeat(level);

    // Skip if it's completed or dropped and we're hiding completed items
    if (hideCompleted && (project.status === 'Done' || project.status === 'Dropped')) {
      return '';
    }

    // Format project status info
    let statusInfo = '';
    if (project.status === 'OnHold') {
      statusInfo = ' [OnHold]';
    } else if (project.status === 'Dropped') {
      statusInfo = ' [Dropped]';
    } else if (project.status === 'Done') {
      statusInfo = ' [Done]';
    }

    // Add due date if present
    if (project.dueDate) {
      const dueDateStr = formatCompactDate(project.dueDate);
      statusInfo += statusInfo ? ` [DUE:${dueDateStr}]` : ` [DUE:${dueDateStr}]`;
    }

    // Add planned date if present
    if (project.plannedDate) {
      const plannedDateStr = formatCompactDate(project.plannedDate);
      statusInfo += statusInfo ? ` [PLAN:${plannedDateStr}]` : ` [PLAN:${plannedDateStr}]`;
    }

    // Add flag if present
    const flaggedSymbol = project.flagged ? ' 🚩' : '';

    let projectOutput = `${indent}P: ${project.name}${flaggedSymbol}${statusInfo}\n`;

    // Process tasks in this project
    const projectTasks = rootTasksByProject.get(project.id) || [];

    if (projectTasks.length > 0) {
      for (const task of projectTasks) {
        projectOutput += processTask(task, level + 1);
      }
    }

    // Note how many completed tasks the per-project cap left out
    const omitted = omittedByContainer[project.id];
    if (!hideCompleted && omitted) {
      projectOutput += `${'   '.repeat(level + 1)}... (+${omitted} older completed tasks omitted)\n`;
    }

    return projectOutput;
  }

  // Process a task
  function processTask(task: any, level: number): string {
    const indent = '   '.repeat(level);

    // Skip if it's hidden (completed while hiding completed, or a collapsed duplicate)
    if (isHiddenTask(task)) {
      return '';
    }

    // Flag symbol
    const flagSymbol = task.flagged ? '🚩 ' : '';

    // Format dates
    let dateInfo = '';
    if (task.dueDate) {
      const dueDateStr = formatCompactDate(task.dueDate);
      dateInfo += ` [DUE:${dueDateStr}]`;
    }
    if (task.deferDate) {
      const deferDateStr = formatCompactDate(task.deferDate);
      dateInfo += ` [defer:${deferDateStr}]`;
    }
    if (task.plannedDate) {
      const plannedDateStr = formatCompactDate(task.plannedDate);
      dateInfo += ` [PLAN:${plannedDateStr}]`;
    }

    // Format duration
    let durationStr = '';
    if (task.estimatedMinutes) {
      // Convert to hours if >= 60 minutes
      if (task.estimatedMinutes >= 60) {
        const hours = Math.floor(task.estimatedMinutes / 60);
        durationStr = ` (${hours}h)`;
      } else {
        durationStr = ` (${task.estimatedMinutes}m)`;
      }
    }

    // Format tags
    let tagsStr = '';
    if (task.tagNames && task.tagNames.length > 0) {
      // Use minimum unique prefixes for tag names
      const abbreviatedTags = task.tagNames.map((tag: string) => {
        return tagPrefixMap.get(tag) || tag;
      });

      tagsStr = ` <${abbreviatedTags.join(',')}>`;
    }

    // Format status
    let statusStr = '';
    switch (task.taskStatus) {
      case 'Next':
        statusStr = ' #next';
        break;
      case 'Available':
        statusStr = ' #avail';
        break;
      case 'Blocked':
        statusStr = ' #block';
        break;
      case 'DueSoon':
        statusStr = ' #due';
        break;
      case 'Overdue':
        statusStr = ' #over';
        break;
      case 'Completed':
        statusStr = ' #compl';
        break;
      case 'Dropped':
        statusStr = ' #drop';
        break;
    }

    // Marker for collapsed repeating instances
    const instanceCount = recurringInstanceCounts.get(task.id) || 0;
    const recurringStr = instanceCount > 1 ? ` (×${instanceCount} completed instances)` : '';

    let taskOutput = `${indent}• ${flagSymbol}${task.name}${dateInfo}${durationStr}${tagsStr}${statusStr}${recurringStr}\n`;

    // Process subtasks
    const childTasks = childTasksByParent.get(task.id);

    if (childTasks && childTasks.length > 0) {
      for (const childTask of childTasks) {
        taskOutput += processTask(childTask, level + 1);
      }
    }

    return taskOutput;
  }

  // Process all root folders
  for (const folder of rootFolders) {
    output += processFolder(folder, 0);
  }

  // Process projects not in any folder (if any)
  const rootProjects = Object.values(database.projects || {}).filter((project: any) => !project.folderID);

  for (const project of rootProjects) {
    output += processProject(project, 0);
  }

  // Process inbox tasks (tasks not assigned to any project)
  const inboxTasks = rootInboxTasks.filter((task: any) => !isHiddenTask(task));

  if (inboxTasks.length > 0) {
    output += 'INBOX:\n';
    for (const task of inboxTasks) {
      output += processTask(task, 1);
    }
  }

  // Note how many completed inbox tasks the cap left out
  const inboxOmitted = omittedByContainer[INBOX_CONTAINER_KEY];
  if (!hideCompleted && inboxOmitted) {
    if (inboxTasks.length === 0) {
      output += 'INBOX:\n';
    }
    output += `   ... (+${inboxOmitted} older completed tasks omitted)\n`;
  }

  return output;
}

// Compute minimum unique prefixes for all tags (minimum 3 characters).
// A prefix is unique when no other tag name starts with it. Since names that share a
// prefix are contiguous once sorted, only the two sorted neighbours can collide — so the
// shortest unique prefix is one character longer than the longer of the two overlaps.
// O(n log n) instead of comparing every tag against every other tag.
function computeMinimumUniquePrefixes(tagNames: string[]): Map<string, string> {
  const prefixMap = new Map<string, string>();

  // Duplicate names are the same tag as far as uniqueness goes
  const uniqueNames = Array.from(new Set(tagNames.map(name => String(name == null ? '' : name))));
  uniqueNames.sort();

  function commonPrefixLength(a: string, b: string): number {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }

  for (let i = 0; i < uniqueNames.length; i++) {
    const tagName = uniqueNames[i];
    const previousOverlap = i > 0 ? commonPrefixLength(tagName, uniqueNames[i - 1]) : 0;
    const nextOverlap = i < uniqueNames.length - 1 ? commonPrefixLength(tagName, uniqueNames[i + 1]) : 0;

    // Minimum length of 3, and long enough to clear both neighbours
    const prefixLength = Math.max(3, previousOverlap + 1, nextOverlap + 1);

    // If we couldn't find a unique prefix, use the full tag name
    prefixMap.set(tagName, prefixLength <= tagName.length ? tagName.substring(0, prefixLength) : tagName);
  }

  return prefixMap;
}
