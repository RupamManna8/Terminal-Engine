import { Lesson, LessonStep, TerminalEvent, TerminalSessionState } from '../shared/types';

export const defaultLessons: Lesson[] = [
  {
    id: 'linux-1',
    title: 'Linux Navigation Basics',
    description: 'Learn directory creation and traversal in UNIX-like filesystems.',
    category: 'linux',
    xpReward: 50,
    steps: [
      {
        id: 'linux-1-step-1',
        description: 'Create a directory named "projects" in the current path.',
        validationRule: {
          type: 'DIRECTORY_CREATED',
          expectedValue: '/home/student/projects',
        },
      },
      {
        id: 'linux-1-step-2',
        description: 'Change directory into "projects".',
        validationRule: {
          type: 'DIRECTORY_CHANGED',
          expectedValue: '/home/student/projects',
        },
      },
      {
        id: 'linux-1-step-3',
        description: 'Create an empty file named "main.js" inside projects.',
        validationRule: {
          type: 'FILE_CREATED',
          expectedValue: '/home/student/projects/main.js',
        },
      },
    ],
  },
  {
    id: 'git-1',
    title: 'Git Versioning Basics',
    description: 'Initialize a local Git repository and perform your first commit.',
    category: 'git',
    xpReward: 100,
    steps: [
      {
        id: 'git-1-step-1',
        description: 'Initialize a new Git repository.',
        validationRule: {
          type: 'GIT_INIT',
        },
      },
      {
        id: 'git-1-step-2',
        description: 'Create a "README.md" file, run "git add" to stage it, and commit it with a message.',
        validationRule: {
          type: 'GIT_COMMIT',
        },
      },
    ],
  },
  {
    id: 'npm-1',
    title: 'Node Package Manager Basics',
    description: 'Initialize a Node project and install dependencies.',
    category: 'node',
    xpReward: 80,
    steps: [
      {
        id: 'npm-1-step-1',
        description: 'Initialize a new package using npm init.',
        validationRule: {
          type: 'FILE_CREATED',
          expectedValue: '/home/student/package.json',
        },
      },
      {
        id: 'npm-1-step-2',
        description: 'Install the "express" library.',
        validationRule: {
          type: 'CUSTOM_COMMAND',
          expectedValue: 'npm install express',
        },
      },
    ],
  },
];

export function validateStep(
  step: LessonStep,
  event: TerminalEvent,
  state: TerminalSessionState
): boolean {
  const rule = step.validationRule;

  if (rule.type === 'CUSTOM_COMMAND') {
    if (event.type === 'COMMAND_EXECUTED' && event.payload.raw) {
      const rawCmd = event.payload.raw.trim().replace(/\s+/g, ' ');
      return rawCmd.toLowerCase() === rule.expectedValue?.toLowerCase();
    }
    return false;
  }

  if (event.type !== rule.type) {
    return false;
  }

  if (rule.expectedValue) {
    if (rule.type === 'DIRECTORY_CREATED' || rule.type === 'FILE_CREATED' || rule.type === 'DIRECTORY_CHANGED') {
      const payloadPath = event.payload?.path;
      return payloadPath === rule.expectedValue;
    }
  }

  return true;
}
