import { Lesson, LessonStep, TerminalEvent, TerminalSessionState } from '../shared/types';

export const defaultLessons: Lesson[] = [
  {
    id: 'sv_q1',
    title: 'Hello, Terminal',
    description: 'Open the embedded interactive terminal below and execute commands in real time. Type commands manually to build muscle memory.',
    category: 'linux',
    xpReward: 50,
    steps: [
      {
        id: 'sv_q1-step-1',
        description: 'Open terminal and type `help` to see available commands',
        validationRule: {
          type: 'CUSTOM_COMMAND',
          expectedValue: 'help',
        },
      },
      {
        id: 'sv_q1-step-2',
        description: 'Use `cd Desktop` to navigate to your Desktop',
        validationRule: {
          type: 'DIRECTORY_CHANGED',
          expectedValue: '/home/student/Desktop',
        },
      },
      {
        id: 'sv_q1-step-3',
        description: 'Create a new folder with `mkdir my-first-project`',
        validationRule: {
          type: 'DIRECTORY_CREATED',
          expectedValue: '/home/student/Desktop/my-first-project',
        },
      },
      {
        id: 'sv_q1-step-4',
        description: 'List directory contents with `ls` or `dir`',
        validationRule: {
          type: 'CUSTOM_COMMAND',
          expectedValue: 'ls',
        },
      },
    ],
  },
  {
    id: 'sv_q2',
    title: 'Git Init — Your First Repository',
    description: 'Initialize a Git repository, create files, stage changes, and record your first commit in the interactive shell.',
    category: 'git',
    xpReward: 75,
    steps: [
      {
        id: 'sv_q2-step-1',
        description: 'Navigate into your project folder with `cd my-first-project`',
        validationRule: {
          type: 'DIRECTORY_CHANGED',
          expectedValue: '/home/student/Desktop/my-first-project',
        },
      },
      {
        id: 'sv_q2-step-2',
        description: 'Initialize a Git repository with `git init`',
        validationRule: {
          type: 'GIT_INIT',
        },
      },
      {
        id: 'sv_q2-step-3',
        description: 'Create a file with `touch README.md` or `echo "Hello" > README.md`',
        validationRule: {
          type: 'FILE_CREATED',
          expectedValue: '/home/student/Desktop/my-first-project/README.md',
        },
      },
      {
        id: 'sv_q2-step-4',
        description: 'Stage changes with `git add README.md` or `git add .`',
        validationRule: {
          type: 'CUSTOM_COMMAND',
          expectedValue: 'git add .',
        },
      },
      {
        id: 'sv_q2-step-5',
        description: 'Commit with `git commit -m "Initial commit"`',
        validationRule: {
          type: 'GIT_COMMIT',
        },
      },
    ],
  },
  {
    id: 'sv_q3',
    title: 'Variables & Data Types',
    description: 'Declare variables and inspect data in the terminal sandbox.',
    category: 'node',
    xpReward: 100,
    steps: [
      {
        id: 'sv_q3-step-1',
        description: 'Create a script file with `touch index.js`',
        validationRule: {
          type: 'FILE_CREATED',
          expectedValue: '/home/student/Desktop/my-first-project/index.js',
        },
      },
      {
        id: 'sv_q3-step-2',
        description: 'Write variables into file with `echo "const name = \'Dev\';" > index.js`',
        validationRule: {
          type: 'CUSTOM_COMMAND',
          expectedValue: 'echo "const name = \'Dev\';" > index.js',
        },
      },
      {
        id: 'sv_q3-step-3',
        description: 'Read back your script with `cat index.js`',
        validationRule: {
          type: 'CUSTOM_COMMAND',
          expectedValue: 'cat index.js',
        },
      },
    ],
  },
  {
    id: 'sv_q4',
    title: 'Functions & Logic Gates',
    description: 'Build reusable functions and execute logic control flow in your script.',
    category: 'node',
    xpReward: 125,
    steps: [
      {
        id: 'sv_q4-step-1',
        description: 'Append a function to index.js with `echo "function add(a,b){return a+b;}" >> index.js`',
        validationRule: {
          type: 'CUSTOM_COMMAND',
          expectedValue: 'echo "function add(a,b){return a+b;}" >> index.js',
        },
      },
      {
        id: 'sv_q4-step-2',
        description: 'Inspect file contents with `cat index.js`',
        validationRule: {
          type: 'CUSTOM_COMMAND',
          expectedValue: 'cat index.js',
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
      const rawCmd = event.payload.raw.trim().replace(/\s+/g, ' ').toLowerCase();
      const expected = rule.expectedValue?.toLowerCase() || '';

      if (expected === 'ls') {
        return rawCmd === 'ls' || rawCmd === 'dir';
      }
      if (expected === 'git add .') {
        return rawCmd.startsWith('git add');
      }
      if (expected.startsWith('echo')) {
        return rawCmd.startsWith('echo') && rawCmd.includes('index.js');
      }

      return rawCmd === expected;
    }
    return false;
  }

  if (event.type !== rule.type) {
    return false;
  }

  if (rule.expectedValue) {
    if (rule.type === 'DIRECTORY_CREATED' || rule.type === 'FILE_CREATED' || rule.type === 'DIRECTORY_CHANGED') {
      const payloadPath = event.payload?.path || '';
      const expected = rule.expectedValue || '';
      const expectedBase = expected.split('/').pop() || '';
      const payloadBase = payloadPath.split('/').pop() || '';
      return payloadBase.toLowerCase() === expectedBase.toLowerCase();
    }
  }

  return true;
}
