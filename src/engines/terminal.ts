import { parseCommand } from './parser';
import { VirtualFileSystem } from './vfs';
import { GitEngine } from './git';
import {
  TerminalSessionState,
  CommandResponse,
  TerminalEvent,
  TerminalEventType,
  CommandAST,
  VNode
} from '../shared/types';

// Helper to generate hash for simulated git actions
function generateHash(): string {
  return Math.random().toString(16).substring(2, 9) + Math.random().toString(16).substring(2, 9);
}

// Helper to create events
function createEvent(type: TerminalEventType, payload: any): TerminalEvent {
  return {
    type,
    payload,
    timestamp: Date.now(),
  };
}

export interface CommandContext {
  vfs: VirtualFileSystem;
  git: GitEngine;
  env: Record<string, string>;
  events: TerminalEvent[];
  history: string[];
  userId?: string;
  githubConnected?: boolean;
  githubApiCall?: (action: string, payload: any) => Promise<any>;
}

export interface CommandPlugin {
  name: string;
  aliases?: string[];
  description: string;
  execute(ctx: CommandContext, ast: CommandAST): Promise<CommandResponse>;
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

export class CommandRegistry {
  private commands = new Map<string, CommandPlugin>();

  public register(plugin: CommandPlugin): void {
    this.commands.set(plugin.name, plugin);
    if (plugin.aliases) {
      for (const alias of plugin.aliases) {
        this.commands.set(alias, plugin);
      }
    }
  }

  public get(name: string): CommandPlugin | undefined {
    return this.commands.get(name);
  }

  public getAll(): CommandPlugin[] {
    return Array.from(new Set(this.commands.values()));
  }

  public suggest(name: string): string | null {
    const list = Array.from(this.commands.keys());
    let bestMatch: string | null = null;
    let minDistance = 3;

    for (const cmd of list) {
      const dist = levenshteinDistance(name, cmd);
      if (dist < minDistance) {
        minDistance = dist;
        bestMatch = cmd;
      }
    }
    return bestMatch;
  }
}

// --- Plugins Implementation ---

export const pwdPlugin: CommandPlugin = {
  name: 'pwd',
  description: 'Print working directory',
  async execute(ctx) {
    return { stdout: ctx.vfs.getCwd(), stderr: '', exitCode: 0 };
  },
};

export const lsPlugin: CommandPlugin = {
  name: 'ls',
  description: 'List directory contents',
  async execute(ctx, ast) {
    const showAll = ast.flags.includes('-a') || ast.flags.includes('--all');
    const longFormat = ast.flags.includes('-l');
    const path = ast.args[0] || ctx.vfs.getCwd();

    try {
      let nodes = ctx.vfs.ls(path);

      if (!showAll) {
        nodes = nodes.filter((n: VNode) => !n.name.startsWith('.'));
      }

      if (longFormat) {
        const lines = nodes.map((n: VNode) => {
          const timeStr = new Date(n.metadata.updatedAt).toLocaleDateString();
          return `${n.metadata.permissions}  ${n.metadata.owner}  ${n.metadata.group}  ${n.metadata.size.toString().padStart(5)}  ${timeStr}  ${n.name}`;
        });
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
      } else {
        return { stdout: nodes.map((n: VNode) => n.name).join('    '), stderr: '', exitCode: 0 };
      }
    } catch (err: any) {
      return { stdout: '', stderr: err.message || 'ls: error reading directory', exitCode: 1 };
    }
  },
};

export const cdPlugin: CommandPlugin = {
  name: 'cd',
  description: 'Change directory',
  async execute(ctx, ast) {
    const target = ast.args[0] || '/home/student';
    try {
      ctx.vfs.cd(target);
      const newCwd = ctx.vfs.getCwd();
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        events: [createEvent('DIRECTORY_CHANGED', { path: newCwd })],
        updatedState: { cwd: newCwd },
      };
    } catch (err: any) {
      return { stdout: '', stderr: err.message, exitCode: 1 };
    }
  },
};

export const mkdirPlugin: CommandPlugin = {
  name: 'mkdir',
  description: 'Make directories',
  async execute(ctx, ast) {
    if (ast.args.length === 0) {
      return { stdout: '', stderr: 'mkdir: missing operand', exitCode: 1 };
    }

    const recursive = ast.flags.includes('-p') || ast.flags.includes('--parents');
    const errors: string[] = [];
    const events: TerminalEvent[] = [];

    for (const arg of ast.args) {
      try {
        ctx.vfs.mkdir(arg, recursive);
        events.push(createEvent('DIRECTORY_CREATED', { path: ctx.vfs.normalizePath(arg) }));
      } catch (err: any) {
        errors.push(err.message);
      }
    }

    return {
      stdout: '',
      stderr: errors.join('\n'),
      exitCode: errors.length > 0 ? 1 : 0,
      events,
      updatedState: { vfs: ctx.vfs.getRoot() },
    };
  },
};

export const touchPlugin: CommandPlugin = {
  name: 'touch',
  description: 'Create empty file',
  async execute(ctx, ast) {
    if (ast.args.length === 0) {
      return { stdout: '', stderr: 'touch: missing file operand', exitCode: 1 };
    }

    const errors: string[] = [];
    const events: TerminalEvent[] = [];

    for (const arg of ast.args) {
      try {
        ctx.vfs.touch(arg);
        events.push(createEvent('FILE_CREATED', { path: ctx.vfs.normalizePath(arg) }));
      } catch (err: any) {
        errors.push(err.message);
      }
    }

    return {
      stdout: '',
      stderr: errors.join('\n'),
      exitCode: errors.length > 0 ? 1 : 0,
      events,
      updatedState: { vfs: ctx.vfs.getRoot() },
    };
  },
};

export const rmPlugin: CommandPlugin = {
  name: 'rm',
  description: 'Remove files/folders',
  async execute(ctx, ast) {
    if (ast.args.length === 0) {
      return { stdout: '', stderr: 'rm: missing operand', exitCode: 1 };
    }

    const recursive = ast.flags.includes('-r') || ast.flags.includes('-R') || ast.flags.includes('--recursive');
    const force = ast.flags.includes('-f') || ast.flags.includes('--force');
    const errors: string[] = [];
    const events: TerminalEvent[] = [];

    for (const arg of ast.args) {
      try {
        const fullPath = ctx.vfs.normalizePath(arg);
        ctx.vfs.rm(arg, recursive, force);
        events.push(createEvent('FILE_REMOVED', { path: fullPath }));
      } catch (err: any) {
        if (!force) errors.push(err.message);
      }
    }

    return {
      stdout: '',
      stderr: errors.join('\n'),
      exitCode: errors.length > 0 ? 1 : 0,
      events,
      updatedState: { vfs: ctx.vfs.getRoot() },
    };
  },
};

export const mvPlugin: CommandPlugin = {
  name: 'mv',
  description: 'Move files',
  async execute(ctx, ast) {
    if (ast.args.length < 2) {
      return { stdout: '', stderr: 'mv: missing destination file operand', exitCode: 1 };
    }
    try {
      ctx.vfs.mv(ast.args[0], ast.args[1]);
      return { stdout: '', stderr: '', exitCode: 0, updatedState: { vfs: ctx.vfs.getRoot() } };
    } catch (err: any) {
      return { stdout: '', stderr: err.message, exitCode: 1 };
    }
  },
};

export const cpPlugin: CommandPlugin = {
  name: 'cp',
  description: 'Copy files',
  async execute(ctx, ast) {
    if (ast.args.length < 2) {
      return { stdout: '', stderr: 'cp: missing destination operand', exitCode: 1 };
    }
    const recursive = ast.flags.includes('-r') || ast.flags.includes('--recursive');
    try {
      ctx.vfs.cp(ast.args[0], ast.args[1], recursive);
      return { stdout: '', stderr: '', exitCode: 0, updatedState: { vfs: ctx.vfs.getRoot() } };
    } catch (err: any) {
      return { stdout: '', stderr: err.message, exitCode: 1 };
    }
  },
};

export const catPlugin: CommandPlugin = {
  name: 'cat',
  description: 'Print file contents',
  async execute(ctx, ast) {
    if (ast.args.length === 0) {
      return { stdout: '', stderr: 'cat: missing file', exitCode: 1 };
    }
    const outputs: string[] = [];
    const errors: string[] = [];
    for (const f of ast.args) {
      try {
        outputs.push(ctx.vfs.readFile(f));
      } catch (err: any) {
        errors.push(err.message);
      }
    }
    return { stdout: outputs.join('\n'), stderr: errors.join('\n'), exitCode: errors.length > 0 ? 1 : 0 };
  },
};

export const treePlugin: CommandPlugin = {
  name: 'tree',
  description: 'Folder tree view',
  async execute(ctx, ast) {
    const path = ast.args[0] || ctx.vfs.getCwd();
    try {
      return { stdout: ctx.vfs.tree(path), stderr: '', exitCode: 0 };
    } catch (err: any) {
      return { stdout: '', stderr: err.message, exitCode: 1 };
    }
  },
};

export const clearPlugin: CommandPlugin = {
  name: 'clear',
  description: 'Clear terminal screen',
  async execute() {
    return { stdout: '\x1b[2J\x1b[3J\x1b[H', stderr: '', exitCode: 0 };
  },
};

export const gitPlugin: CommandPlugin = {
  name: 'git',
  description: 'Git engine',
  async execute(ctx, ast) {
    const sub = ast.subcommand;
    if (!sub) {
      return {
        stdout: 'Usage: git <command>\nCommands: init, status, add, commit, log, branch, checkout, merge, reset, remote, push, pull, clone',
        stderr: '',
        exitCode: 0,
      };
    }

    try {
      if (sub === 'init') {
        const out = ctx.git.init(ctx.vfs);
        return {
          stdout: out,
          stderr: '',
          exitCode: 0,
          events: [createEvent('GIT_INIT', {})],
          updatedState: { git: ctx.git.getState(), vfs: ctx.vfs.getRoot() },
        };
      }

      const state = ctx.git.getState();
      if (!state.initialized && sub !== 'clone') {
        return { stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git', exitCode: 128 };
      }

      if (sub === 'status') {
        const res = ctx.git.status(ctx.vfs);
        const lines: string[] = [`On branch ${state.head}`];
        const hasStaged = res.staged.new.length > 0 || res.staged.modified.length > 0 || res.staged.deleted.length > 0;
        if (hasStaged) {
          lines.push('Changes to be committed:');
          lines.push('  (use "git reset HEAD <file>..." to unstage)');
          res.staged.new.forEach((p: string) => lines.push(`\tnew file:   ${p}`));
          res.staged.modified.forEach((p: string) => lines.push(`\tmodified:   ${p}`));
          res.staged.deleted.forEach((p: string) => lines.push(`\tdeleted:    ${p}`));
          lines.push('');
        }
        const hasUnstaged = res.unstaged.modified.length > 0 || res.unstaged.deleted.length > 0;
        if (hasUnstaged) {
          lines.push('Changes not staged for commit:');
          lines.push('  (use "git add <file>..." to update what will be committed)');
          res.unstaged.modified.forEach((p: string) => lines.push(`\tmodified:   ${p}`));
          res.unstaged.deleted.forEach((p: string) => lines.push(`\tdeleted:    ${p}`));
          lines.push('');
        }
        if (res.untracked.length > 0) {
          lines.push('Untracked files:');
          lines.push('  (use "git add <file>..." to include in what will be committed)');
          res.untracked.forEach((p: string) => lines.push(`\t${p}`));
          lines.push('');
        }
        if (!hasStaged && !hasUnstaged && res.untracked.length === 0) {
          lines.push('nothing to commit, working tree clean');
        }
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
      }

      if (sub === 'add') {
        ctx.git.add(ctx.vfs, ast.args);
        return { stdout: '', stderr: '', exitCode: 0, updatedState: { git: ctx.git.getState() } };
      }

      if (sub === 'commit') {
        const msg = ast.options['-m'] || ast.options['--message'] || ast.args[0];
        if (!msg) {
          return { stdout: '', stderr: 'error: message required', exitCode: 1 };
        }
        const out = ctx.git.commit(ctx.vfs, msg);
        return {
          stdout: out,
          stderr: '',
          exitCode: 0,
          events: [createEvent('GIT_COMMIT', { message: msg })],
          updatedState: { git: ctx.git.getState(), vfs: ctx.vfs.getRoot() },
        };
      }

      if (sub === 'log') {
        return { stdout: ctx.git.log(), stderr: '', exitCode: 0 };
      }

      if (sub === 'branch') {
        const out = ctx.git.branch(ast.args);
        return { stdout: out, stderr: '', exitCode: 0, updatedState: { git: ctx.git.getState() } };
      }

      if (sub === 'checkout') {
        if (ast.args.length === 0) {
          return { stdout: '', stderr: 'fatal: branch/commit target required', exitCode: 1 };
        }
        if (ast.args[0] === '-b') {
          if (ast.args.length < 2) return { stdout: '', stderr: 'fatal: branch name required', exitCode: 1 };
          const newB = ast.args[1];
          ctx.git.branch([newB]);
          const out = ctx.git.checkout(ctx.vfs, newB);
          return { stdout: out, stderr: '', exitCode: 0, updatedState: { git: ctx.git.getState(), vfs: ctx.vfs.getRoot() } };
        }
        const out = ctx.git.checkout(ctx.vfs, ast.args[0]);
        return { stdout: out, stderr: '', exitCode: 0, updatedState: { git: ctx.git.getState(), vfs: ctx.vfs.getRoot() } };
      }

      if (sub === 'merge') {
        if (ast.args.length === 0) return { stdout: '', stderr: 'fatal: target required', exitCode: 1 };
        const out = ctx.git.merge(ctx.vfs, ast.args[0]);
        return { stdout: out, stderr: '', exitCode: 0, updatedState: { git: ctx.git.getState(), vfs: ctx.vfs.getRoot() } };
      }

      if (sub === 'remote') {
        return { stdout: ctx.git.remote(ast.args), stderr: '', exitCode: 0, updatedState: { git: ctx.git.getState() } };
      }

      if (sub === 'clone') {
        if (ast.args.length === 0) return { stdout: '', stderr: 'fatal: URL required', exitCode: 1 };
        const out = ctx.git.clone(ctx.vfs, ast.args[0]);
        return { stdout: out, stderr: '', exitCode: 0, updatedState: { git: ctx.git.getState(), vfs: ctx.vfs.getRoot(), cwd: ctx.vfs.getCwd() } };
      }

      if (sub === 'reset') {
        const isHard = ast.flags.includes('--hard');
        const out = ctx.git.reset(ctx.vfs, ast.args, isHard);
        return { stdout: out, stderr: '', exitCode: 0, updatedState: { git: ctx.git.getState(), vfs: ctx.vfs.getRoot() } };
      }

      if (sub === 'push') {
        const remote = ast.args[0] || 'origin';
        const branch = ast.args[1] || state.head;

        if (!state.remotes[remote]) {
          return { stdout: '', stderr: `fatal: '${remote}' does not appear to be a git repository`, exitCode: 1 };
        }

        if (!ctx.githubConnected || !ctx.githubApiCall) {
          return { stdout: '', stderr: 'fatal: GitHub account not authenticated. Please link your GitHub account first in the top HUD.', exitCode: 1 };
        }

        let outputMessage = '';
        outputMessage += 'Syncing local virtual repository commits with real GitHub...\n';
        const pushResult = await ctx.githubApiCall('push', { remote, branch });
        outputMessage += pushResult.message || `Successfully pushed to github.com (${remote}/${branch})\n`;

        return {
          stdout: outputMessage,
          stderr: '',
          exitCode: 0,
          events: [createEvent('GIT_PUSH', { remote, branch })],
        };
      }

      if (sub === 'pull') {
        const remote = ast.args[0] || 'origin';
        const branch = ast.args[1] || state.head;

        if (!state.remotes[remote]) {
          return { stdout: '', stderr: `fatal: '${remote}' does not appear to be a git repository`, exitCode: 1 };
        }

        if (!ctx.githubConnected || !ctx.githubApiCall) {
          return { stdout: '', stderr: 'fatal: GitHub account not authenticated. Please link your GitHub account first in the top HUD.', exitCode: 1 };
        }

        let outputMessage = '';
        outputMessage += 'Syncing latest files from real GitHub to virtual repo...\n';
        const pullResult = await ctx.githubApiCall('pull', { remote, branch });
        outputMessage += pullResult.message || `Successfully pulled from github.com (${remote}/${branch})\n`;
        if (pullResult.vfs) {
          ctx.vfs.getRoot().children = pullResult.vfs.children;
        }

        return { stdout: outputMessage, stderr: '', exitCode: 0, updatedState: { vfs: ctx.vfs.getRoot(), git: ctx.git.getState() } };
      }

      return { stdout: '', stderr: `git: '${sub}' is not a git command.`, exitCode: 1 };
    } catch (err: any) {
      return { stdout: '', stderr: err.message || 'git execution error', exitCode: 1 };
    }
  },
};

export const npmPlugin: CommandPlugin = {
  name: 'npm',
  description: 'NPM simulation',
  async execute(ctx, ast) {
    const sub = ast.subcommand;
    if (!sub) return { stdout: 'npm init | install | run', stderr: '', exitCode: 0 };

    if (sub === 'init') {
      try {
        ctx.vfs.touch(
          'package.json',
          JSON.stringify({ name: 'virtual-project', version: '1.0.0', dependencies: {} }, null, 2)
        );
        return { stdout: 'Wrote to package.json successfully.', stderr: '', exitCode: 0, updatedState: { vfs: ctx.vfs.getRoot() } };
      } catch (e: any) {
        return { stdout: '', stderr: e.message, exitCode: 1 };
      }
    }

    if (sub === 'install' || sub === 'i') {
      const pkg = ast.args[0] || 'express';
      let pkgJsonStr = '';
      try { pkgJsonStr = ctx.vfs.readFile('package.json'); } catch (e) { pkgJsonStr = '{}'; }

      try {
        const pkgJson = JSON.parse(pkgJsonStr);
        if (!pkgJson.dependencies) pkgJson.dependencies = {};
        pkgJson.dependencies[pkg] = '^1.0.0';
        ctx.vfs.writeFile('package.json', JSON.stringify(pkgJson, null, 2));
        ctx.vfs.mkdir('node_modules/' + pkg, true);
        ctx.vfs.touch('node_modules/' + pkg + '/index.js', `module.exports = {};`);

        return { stdout: `added 1 package, and audited 2 packages in 1.43s`, stderr: '', exitCode: 0, updatedState: { vfs: ctx.vfs.getRoot() } };
      } catch (e: any) {
        return { stdout: '', stderr: 'npm ERR! ' + e.message, exitCode: 1 };
      }
    }

    if (sub === 'run') {
      const script = ast.args[0];
      if (!script) return { stdout: 'test | start', stderr: '', exitCode: 0 };
      if (script === 'test') return { stdout: 'Error: no test specified', stderr: '', exitCode: 0 };
      if (script === 'start') {
        try {
          const mainFileContent = ctx.vfs.readFile('index.js');
          return { stdout: `Output: ${mainFileContent}`, stderr: '', exitCode: 0 };
        } catch (e) {
          return { stdout: '', stderr: 'Error: Cannot find module \'/home/student/index.js\'', exitCode: 1 };
        }
      }
      return { stdout: '', stderr: `npm ERR! missing script: ${script}`, exitCode: 1 };
    }

    return { stdout: '', stderr: `npm ERR! unknown command: ${sub}`, exitCode: 1 };
  },
};

export const dockerPlugin: CommandPlugin = {
  name: 'docker',
  description: 'Docker simulator',
  async execute(ctx, ast) {
    const sub = ast.subcommand;
    if (!sub) return { stdout: 'build | run | ps | images', stderr: '', exitCode: 0 };

    if (sub === 'images') {
      return { stdout: 'REPOSITORY   TAG       IMAGE ID       SIZE\nnode         latest    5b28d6fa7c21   174MB', stderr: '', exitCode: 0 };
    }
    if (sub === 'ps') {
      return { stdout: 'CONTAINER ID   IMAGE   STATUS\n2f8c5b128522   nginx   Up 3 minutes', stderr: '', exitCode: 0 };
    }
    if (sub === 'build') {
      return { stdout: 'Successfully built image', stderr: '', exitCode: 0 };
    }
    if (sub === 'run') {
      return { stdout: 'Container started successfully.', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: `docker: '${sub}' is not a docker command.`, exitCode: 1 };
  },
};

export const helpPlugin: CommandPlugin = {
  name: 'help',
  description: 'Display list of available commands and utilities',
  async execute(ctx, ast) {
    const output = [
      'CareerVerse AI Virtual Shell - Available Commands:',
      '  help          Display this help message',
      '  clear         Clear the terminal screen',
      '  ls, dir       List directory contents',
      '  cd [dir]      Change the current directory',
      '  mkdir [dir]   Create a new directory',
      '  touch [file]  Create an empty file',
      '  cat [file]    Display file contents',
      '  rm [file]     Remove a file',
      '  cp [src] [dst]Copy a file',
      '  mv [src] [dst]Move a file',
      '  tree          Display directory structure tree',
      '  git           Simulate Git operations (init, status, add, commit, push, pull)',
      '  npm           Simulate Node Package Manager (install, run, start)',
    ].join('\n');
    return { stdout: output, stderr: '', exitCode: 0 };
  },
};

// --- Registry Setup ---

export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(pwdPlugin);
  registry.register(lsPlugin);
  registry.register(helpPlugin);
  registry.register(cdPlugin);
  registry.register(mkdirPlugin);
  registry.register(touchPlugin);
  registry.register(rmPlugin);
  registry.register(mvPlugin);
  registry.register(cpPlugin);
  registry.register(catPlugin);
  registry.register(treePlugin);
  registry.register(clearPlugin);
  registry.register(gitPlugin);
  registry.register(npmPlugin);
  registry.register(dockerPlugin);
  return registry;
}

export const defaultRegistry = createDefaultRegistry();

export interface ExecutionOptions {
  userId?: string;
  githubConnected?: boolean;
  githubApiCall?: (action: string, payload: any) => Promise<any>;
}

export async function executeCommand(
  state: TerminalSessionState,
  rawInput: string,
  options: ExecutionOptions = {},
  registry = defaultRegistry
): Promise<CommandResponse> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  const ast = parseCommand(trimmed);
  if (!ast) {
    return { stdout: '', stderr: 'syntax error: unable to parse input', exitCode: 1 };
  }

  const plugin = registry.get(ast.command);
  if (!plugin) {
    const suggestion = registry.suggest(ast.command);
    const suggestionText = suggestion ? `\nDid you mean: ${suggestion}?` : '';
    const executionEvent = {
      type: 'COMMAND_FAILED' as TerminalEventType,
      payload: { command: ast.command, raw: trimmed, error: 'Command not found' },
      timestamp: Date.now()
    };
    return {
      stdout: '',
      stderr: `bash: ${ast.command}: command not found${suggestionText}`,
      exitCode: 127,
      events: [executionEvent]
    };
  }

  const vfs = new VirtualFileSystem(state.vfs, state.cwd);
  const git = new GitEngine(state.git);

  const context: CommandContext = {
    vfs,
    git,
    env: { ...state.env },
    events: [],
    history: [...state.history],
    userId: options.userId,
    githubConnected: options.githubConnected,
    githubApiCall: options.githubApiCall,
  };

  try {
    const response = await plugin.execute(context, ast);

    const updatedState: Partial<TerminalSessionState> = {
      vfs: vfs.getRoot(),
      cwd: vfs.getCwd(),
      git: git.getState(),
      env: { ...context.env },
      ...response.updatedState,
    };

    updatedState.history = [...state.history, trimmed];

    const finalEvents: TerminalEvent[] = [
      {
        type: response.exitCode === 0 ? 'COMMAND_EXECUTED' : 'COMMAND_FAILED',
        payload: { command: ast.command, raw: trimmed, exitCode: response.exitCode },
        timestamp: Date.now(),
      },
      ...(context.events || []),
      ...(response.events || []),
    ];

    return {
      stdout: response.stdout,
      stderr: response.stderr,
      exitCode: response.exitCode,
      events: finalEvents,
      updatedState,
    };
  } catch (err: any) {
    const failedEvent = {
      type: 'COMMAND_FAILED' as TerminalEventType,
      payload: { command: ast.command, raw: trimmed, error: err.message },
      timestamp: Date.now(),
    };

    return {
      stdout: '',
      stderr: `bash: error executing ${ast.command}: ${err.message || err}`,
      exitCode: 1,
      events: [failedEvent],
    };
  }
}
