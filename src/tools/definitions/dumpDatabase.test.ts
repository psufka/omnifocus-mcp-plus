import assert from 'node:assert/strict';
import test from 'node:test';
import * as dumpDatabaseModule from './dumpDatabase.js';

const formatCompactReport = (dumpDatabaseModule as any).formatCompactReport;

test('formatCompactReport includes root inbox tasks in dedicated INBOX section', () => {
  assert.equal(typeof formatCompactReport, 'function');

  const output = formatCompactReport(
    {
      exportDate: '2026-02-12T00:00:00.000Z',
      tasks: [
        {
          id: 'task-inbox-1',
          name: 'Pay electricity bill',
          projectId: null,
          parentId: null,
          childIds: [],
          completed: false,
          taskStatus: 'Available',
          flagged: false,
          dueDate: null,
          deferDate: null,
          plannedDate: null,
          estimatedMinutes: null,
          tagNames: []
        }
      ],
      projects: {},
      folders: {},
      tags: {}
    },
    {
      hideCompleted: true,
      hideRecurringDuplicates: true
    }
  );

  assert.match(output, /INBOX:/);
  assert.match(output, /Pay electricity bill/);
});

test('formatCompactReport respects hideCompleted for inbox tasks', () => {
  assert.equal(typeof formatCompactReport, 'function');

  const database = {
    exportDate: '2026-02-12T00:00:00.000Z',
    tasks: [
      {
        id: 'task-inbox-completed',
        name: 'Archive notes',
        projectId: null,
        parentId: null,
        childIds: [],
        completed: true,
        taskStatus: 'Completed',
        flagged: false,
        dueDate: null,
        deferDate: null,
        plannedDate: null,
        estimatedMinutes: null,
        tagNames: []
      }
    ],
    projects: {},
    folders: {},
    tags: {}
  };

  const hiddenOutput = formatCompactReport(database, {
    hideCompleted: true,
    hideRecurringDuplicates: true
  });

  assert.doesNotMatch(hiddenOutput, /Archive notes/);

  const visibleOutput = formatCompactReport(database, {
    hideCompleted: false,
    hideRecurringDuplicates: true
  });

  assert.match(visibleOutput, /Archive notes/);
});

// Shared task fixture defaults so individual tests only state what they care about
function makeTask(overrides: Record<string, any>) {
  return {
    id: 'task-1',
    name: 'Task',
    projectId: null,
    parentId: null,
    childIds: [],
    completed: false,
    completionDate: null,
    dropDate: null,
    repetitionRule: null,
    taskStatus: 'Available',
    flagged: false,
    dueDate: null,
    deferDate: null,
    plannedDate: null,
    estimatedMinutes: null,
    tagNames: [],
    ...overrides
  };
}

test('formatCompactReport renders the default report shape unchanged', () => {
  const database = {
    exportDate: '2026-02-12T00:00:00.000Z',
    tasks: [
      makeTask({
        id: 'task-parent',
        name: 'Sort tools',
        projectId: 'project-garage',
        childIds: ['task-child'],
        taskStatus: 'Next',
        dueDate: '2026-03-04T12:00:00.000Z',
        estimatedMinutes: 30,
        tagNames: ['errands']
      }),
      makeTask({
        id: 'task-child',
        name: 'Buy bins',
        projectId: 'project-garage',
        parentId: 'task-parent'
      }),
      makeTask({ id: 'task-inbox', name: 'Pay bill' })
    ],
    projects: {
      'project-garage': {
        id: 'project-garage',
        name: 'Garage',
        status: 'Active',
        folderID: 'folder-home',
        flagged: false,
        dueDate: null,
        plannedDate: null
      }
    },
    folders: {
      'folder-home': {
        id: 'folder-home',
        name: 'Home',
        parentFolderID: null,
        projects: ['project-garage'],
        subfolders: []
      }
    },
    tags: {
      'tag-errands': { id: 'tag-errands', name: 'errands' }
    }
  };

  const output = formatCompactReport(database, {
    hideCompleted: true,
    hideRecurringDuplicates: true
  });

  const dateStr = new Date().toISOString().split('T')[0];
  const expected = `# OMNIFOCUS [${dateStr}]

FORMAT LEGEND:
F: Folder | P: Project | •: Task | 🚩: Flagged
Dates: [M/D] | [DUE:M/D] [PLAN:M/D] [defer:M/D] | Duration: (30m) or (2h) | Tags: <tag1,tag2>
Status: #next #avail #block #due #over #compl #drop

F: Home
   P: Garage
      • Sort tools [DUE:3/4] (30m) <err> #next
         • Buy bins #avail
INBOX:
   • Pay bill #avail
`;

  assert.equal(output, expected);
});

test('formatCompactReport abbreviates tags to minimum unique prefixes', () => {
  const database = {
    exportDate: '2026-02-12T00:00:00.000Z',
    tasks: [
      makeTask({ id: 'task-1', name: 'Prefix check', tagNames: ['Work', 'Workout', 'Home'] })
    ],
    projects: {},
    folders: {},
    tags: {
      'tag-work': { id: 'tag-work', name: 'Work' },
      'tag-workout': { id: 'tag-workout', name: 'Workout' },
      'tag-home': { id: 'tag-home', name: 'Home' }
    }
  };

  const output = formatCompactReport(database, {
    hideCompleted: true,
    hideRecurringDuplicates: true
  });

  // "Work" is a prefix of "Workout" so it can never be abbreviated; "Workout" needs 5
  // characters to clear it; "Home" is unique at the 3-character minimum.
  assert.match(output, /<Work,Worko,Hom>/);
});

test('formatCompactReport renders completed and dropped tasks when hideCompleted is false', () => {
  const database = {
    exportDate: '2026-02-12T00:00:00.000Z',
    tasks: [
      makeTask({
        id: 'task-active',
        name: 'Install shelving',
        projectId: 'project-garage'
      }),
      makeTask({
        id: 'task-done',
        name: 'Rent dumpster',
        projectId: 'project-garage',
        completed: true,
        taskStatus: 'Completed',
        completionDate: '2026-02-10T12:00:00.000Z'
      }),
      makeTask({
        id: 'task-dropped',
        name: 'Rebuild workbench',
        projectId: 'project-garage',
        taskStatus: 'Dropped',
        dropDate: '2026-02-09T12:00:00.000Z'
      })
    ],
    projects: {
      'project-garage': {
        id: 'project-garage',
        name: 'Garage',
        status: 'Done',
        folderID: null,
        flagged: false,
        dueDate: null,
        plannedDate: null
      }
    },
    folders: {},
    tags: {}
  };

  const hiddenOutput = formatCompactReport(database, {
    hideCompleted: true,
    hideRecurringDuplicates: true
  });

  // The whole project is Done, so nothing shows in the default view
  assert.doesNotMatch(hiddenOutput, /Garage/);
  assert.doesNotMatch(hiddenOutput, /Rent dumpster/);

  const visibleOutput = formatCompactReport(database, {
    hideCompleted: false,
    hideRecurringDuplicates: true
  });

  assert.match(visibleOutput, /P: Garage \[Done\]/);
  assert.match(visibleOutput, /• Install shelving #avail/);
  assert.match(visibleOutput, /• Rent dumpster #compl/);
  assert.match(visibleOutput, /• Rebuild workbench #drop/);
  assert.match(visibleOutput, /NOTE: completed and dropped items included/);
});

test('formatCompactReport collapses repeated completed instances of a recurring task', () => {
  const database = {
    exportDate: '2026-02-12T00:00:00.000Z',
    tasks: [
      makeTask({
        id: 'trash-1',
        name: 'Take out trash',
        projectId: 'project-chores',
        completed: true,
        taskStatus: 'Completed',
        completionDate: '2026-02-01T12:00:00.000Z',
        repetitionRule: 'FREQ=WEEKLY'
      }),
      makeTask({
        id: 'trash-3',
        name: 'Take out trash',
        projectId: 'project-chores',
        completed: true,
        taskStatus: 'Completed',
        completionDate: '2026-02-15T12:00:00.000Z',
        repetitionRule: 'FREQ=WEEKLY'
      }),
      makeTask({
        id: 'trash-2',
        name: 'Take out trash',
        projectId: 'project-chores',
        completed: true,
        taskStatus: 'Completed',
        completionDate: '2026-02-08T12:00:00.000Z',
        repetitionRule: 'FREQ=WEEKLY'
      }),
      makeTask({
        id: 'oneoff',
        name: 'Replace bin lid',
        projectId: 'project-chores',
        completed: true,
        taskStatus: 'Completed',
        completionDate: '2026-02-11T12:00:00.000Z'
      })
    ],
    projects: {
      'project-chores': {
        id: 'project-chores',
        name: 'Chores',
        status: 'Active',
        folderID: null,
        flagged: false,
        dueDate: null,
        plannedDate: null
      }
    },
    folders: {},
    tags: {}
  };

  const collapsed = formatCompactReport(database, {
    hideCompleted: false,
    hideRecurringDuplicates: true
  });

  // Only the most recent instance survives, carrying the instance count
  assert.equal(collapsed.match(/Take out trash/g)?.length, 1);
  assert.match(collapsed, /• Take out trash #compl \(×3 completed instances\)/);
  // Non-recurring completed tasks are untouched
  assert.match(collapsed, /• Replace bin lid #compl/);

  const expanded = formatCompactReport(database, {
    hideCompleted: false,
    hideRecurringDuplicates: false
  });

  assert.equal(expanded.match(/Take out trash/g)?.length, 3);
  assert.doesNotMatch(expanded, /completed instances/);

  // hideRecurringDuplicates has no effect while completed tasks are hidden
  const hidden = formatCompactReport(database, {
    hideCompleted: true,
    hideRecurringDuplicates: true
  });

  assert.doesNotMatch(hidden, /Take out trash/);
  assert.doesNotMatch(hidden, /completed instances/);
});

test('formatCompactReport reports the completed-task cap', () => {
  const database = {
    exportDate: '2026-02-12T00:00:00.000Z',
    completedSummary: {
      cap: 50,
      totalOmitted: 7,
      omittedByContainer: {
        'project-chores': 5,
        '__inbox__': 2
      }
    },
    tasks: [
      makeTask({
        id: 'chore-done',
        name: 'Wash windows',
        projectId: 'project-chores',
        completed: true,
        taskStatus: 'Completed',
        completionDate: '2026-02-11T12:00:00.000Z'
      }),
      makeTask({
        id: 'inbox-done',
        name: 'Return package',
        completed: true,
        taskStatus: 'Completed',
        completionDate: '2026-02-10T12:00:00.000Z'
      })
    ],
    projects: {
      'project-chores': {
        id: 'project-chores',
        name: 'Chores',
        status: 'Active',
        folderID: null,
        flagged: false,
        dueDate: null,
        plannedDate: null
      }
    },
    folders: {},
    tags: {}
  };

  const output = formatCompactReport(database, {
    hideCompleted: false,
    hideRecurringDuplicates: true
  });

  assert.match(output, /capped at the 50 most recent completed tasks per project/);
  assert.match(output, /7 older completed tasks omitted\./);
  assert.match(output, /• Wash windows #compl\n {3}\.\.\. \(\+5 older completed tasks omitted\)/);
  assert.match(output, /• Return package #compl\n {3}\.\.\. \(\+2 older completed tasks omitted\)/);

  // The cap note never appears in the default view
  const defaultOutput = formatCompactReport(database, {
    hideCompleted: true,
    hideRecurringDuplicates: true
  });

  assert.doesNotMatch(defaultOutput, /older completed tasks omitted/);
  assert.doesNotMatch(defaultOutput, /NOTE: completed and dropped items included/);
});

test('formatCompactReport includes planned date marker for tasks', () => {
  assert.equal(typeof formatCompactReport, 'function');

  const output = formatCompactReport(
    {
      exportDate: '2026-02-12T00:00:00.000Z',
      tasks: [
        {
          id: 'task-plan-1',
          name: 'Prepare proposal',
          projectId: null,
          parentId: null,
          childIds: [],
          completed: false,
          taskStatus: 'Available',
          flagged: false,
          dueDate: null,
          deferDate: null,
          plannedDate: '2026-02-20T09:00:00.000Z',
          estimatedMinutes: null,
          tagNames: []
        }
      ],
      projects: {},
      folders: {},
      tags: {}
    },
    {
      hideCompleted: true,
      hideRecurringDuplicates: true
    }
  );

  assert.match(output, /PLAN:2\/20/);
});
