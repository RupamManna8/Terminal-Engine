export interface CommandAST {
  command: string;
  subcommand?: string;
  args: string[];
  flags: string[];
  options: Record<string, string>;
}

export interface VFileMetadata {
  createdAt: number;
  updatedAt: number;
  permissions: string;
  owner: string;
  group: string;
  size: number;
}

export interface VNode {
  name: string;
  type: 'file' | 'directory';
  content?: string;
  children?: Record<string, VNode>;
  metadata: VFileMetadata;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
  parentHashes: string[];
  treeHash: string;
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface GitState {
  initialized: boolean;
  head: string;
  branches: Record<string, string>;
  staged: string[];
  commits: Record<string, GitCommit>;
  remotes: Record<string, GitRemote>;
}

export interface LessonStep {
  id: string;
  description: string;
  validationRule: {
    type: 'FILE_CREATED' | 'DIRECTORY_CREATED' | 'DIRECTORY_CHANGED' | 'GIT_INIT' | 'GIT_COMMIT' | 'GIT_PUSH' | 'CUSTOM_COMMAND';
    expectedValue?: string;
  };
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  category: 'linux' | 'windows' | 'git' | 'node' | 'docker';
  xpReward: number;
  steps: LessonStep[];
}

export interface UserProgress {
  userId: string;
  xp: number;
  level: number;
  completedLessons: string[];
  achievements: string[];
  commandsCount: number;
  failuresCount: number;
}

export interface TerminalSessionState {
  cwd: string;
  vfs: VNode;
  git: GitState;
  history: string[];
  env: Record<string, string>;
}

export type TerminalEventType =
  | 'FILE_CREATED'
  | 'DIRECTORY_CREATED'
  | 'DIRECTORY_CHANGED'
  | 'FILE_REMOVED'
  | 'GIT_INIT'
  | 'GIT_COMMIT'
  | 'GIT_PUSH'
  | 'COMMAND_EXECUTED'
  | 'COMMAND_FAILED'
  | 'MISSION_COMPLETED';

export interface TerminalEvent {
  type: TerminalEventType;
  payload: any;
  timestamp: number;
}

export interface CommandResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  events?: TerminalEvent[];
  updatedState?: Partial<TerminalSessionState>;
}
