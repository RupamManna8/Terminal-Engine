import { GitState, GitCommit, VNode } from '../shared/types';
import { VirtualFileSystem, crawlFiles } from './vfs';

export interface GitStatusResult {
  staged: { new: string[]; modified: string[]; deleted: string[] };
  unstaged: { modified: string[]; deleted: string[] };
  untracked: string[];
}

function generateHash(): string {
  return Math.random().toString(16).substring(2, 9) + Math.random().toString(16).substring(2, 9);
}

export class GitEngine {
  private state: GitState;

  constructor(state: GitState) {
    this.state = state;
  }

  public getState(): GitState {
    return this.state;
  }

  public init(vfs: VirtualFileSystem): string {
    if (this.state.initialized) {
      return 'Reinitialized existing Git repository';
    }

    try {
      vfs.mkdir(vfs.normalizePath('.git'), true);
      vfs.touch(vfs.normalizePath('.git/config'), '[core]\n\trepositoryformatversion = 0\n');
    } catch (e) {}

    this.state.initialized = true;
    this.state.head = 'main';
    this.state.branches = { main: '' };
    this.state.staged = [];
    this.state.commits = {};
    this.state.remotes = {};

    return 'Initialized empty Git repository';
  }

  public status(vfs: VirtualFileSystem): GitStatusResult {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository (or any of the parent directories): .git');
    }

    const currentFiles = crawlFiles(vfs.getNode('/')!, '/');
    const headCommitHash = this.state.branches[this.state.head] || '';
    const headCommit = headCommitHash ? this.state.commits[headCommitHash] : null;

    let commitFiles: Record<string, string> = {};
    if (headCommit && headCommit.treeHash) {
      try {
        const snapshotRoot = JSON.parse(headCommit.treeHash) as VNode;
        commitFiles = crawlFiles(snapshotRoot, '/');
      } catch (e) {}
    }

    const result: GitStatusResult = {
      staged: { new: [], modified: [], deleted: [] },
      unstaged: { modified: [], deleted: [] },
      untracked: [],
    };

    const stagedSet = new Set(this.state.staged);

    for (const [path, content] of Object.entries(currentFiles)) {
      const inCommit = path in commitFiles;
      const commitContent = commitFiles[path];
      const isStaged = stagedSet.has(path);

      if (!inCommit) {
        if (isStaged) {
          result.staged.new.push(path);
        } else {
          result.untracked.push(path);
        }
      } else {
        if (content !== commitContent) {
          if (isStaged) {
            result.staged.modified.push(path);
          } else {
            result.unstaged.modified.push(path);
          }
        }
      }
    }

    for (const path of Object.keys(commitFiles)) {
      if (!(path in currentFiles)) {
        const isStaged = stagedSet.has(path);
        if (isStaged) {
          result.staged.deleted.push(path);
        } else {
          result.unstaged.deleted.push(path);
        }
      }
    }

    return result;
  }

  public add(vfs: VirtualFileSystem, targetPaths: string[]): string {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository');
    }

    if (targetPaths.length === 0) {
      return 'Nothing specified, nothing added.';
    }

    const status = this.status(vfs);
    const stagedSet = new Set(this.state.staged);

    for (const target of targetPaths) {
      if (target === '.' || target === '*') {
        status.untracked.forEach((p) => stagedSet.add(p));
        status.unstaged.modified.forEach((p) => stagedSet.add(p));
        status.unstaged.deleted.forEach((p) => stagedSet.add(p));
        continue;
      }

      const absolute = vfs.normalizePath(target);
      const node = vfs.getNode(absolute);

      if (!node && !status.unstaged.deleted.includes(absolute)) {
        throw new Error(`fatal: pathspec '${target}' did not match any files`);
      }

      if (node && node.type === 'directory') {
        const dirFiles = crawlFiles(node, absolute);
        for (const fPath of Object.keys(dirFiles)) {
          stagedSet.add(fPath);
        }
      } else {
        stagedSet.add(absolute);
      }
    }

    this.state.staged = Array.from(stagedSet);
    return '';
  }

  public commit(vfs: VirtualFileSystem, message: string, author = 'Student <student@virtual.edu>'): string {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository');
    }

    if (this.state.staged.length === 0) {
      return 'On branch ' + this.state.head + '\nnothing to commit, working tree clean';
    }

    const currentHeadHash = this.state.branches[this.state.head] || '';
    const newHash = generateHash();
    const vfsSnapshot = JSON.stringify(vfs.getRoot());

    const newCommit: GitCommit = {
      hash: newHash,
      message,
      author,
      timestamp: Date.now(),
      parentHashes: currentHeadHash ? [currentHeadHash] : [],
      treeHash: vfsSnapshot,
    };

    this.state.commits[newHash] = newCommit;
    this.state.branches[this.state.head] = newHash;
    const numFiles = this.state.staged.length;
    this.state.staged = [];

    return `[${this.state.head} ${newHash.substring(0, 7)}] ${message}\n ${numFiles} file${numFiles > 1 ? 's' : ''} changed`;
  }

  public log(): string {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository');
    }

    let currentHash = this.state.branches[this.state.head] || '';
    if (!currentHash) {
      return 'fatal: your current branch \'' + this.state.head + '\' does not have any commits yet';
    }

    const logs: string[] = [];
    while (currentHash) {
      const commit = this.state.commits[currentHash];
      if (!commit) break;

      logs.push(
        `commit ${commit.hash}\nAuthor: ${commit.author}\nDate: ${new Date(commit.timestamp).toUTCString()}\n\n    ${commit.message}\n`
      );

      currentHash = commit.parentHashes[0] || '';
    }

    return logs.join('\n');
  }

  public branch(args: string[]): string {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository');
    }

    if (args.length === 0) {
      return Object.keys(this.state.branches)
        .map((b) => (b === this.state.head ? `* ${b}` : `  ${b}`))
        .join('\n');
    }

    const newBranch = args[0];
    if (this.state.branches[newBranch] !== undefined) {
      throw new Error(`fatal: A branch named '${newBranch}' already exists.`);
    }

    const headCommit = this.state.branches[this.state.head] || '';
    this.state.branches[newBranch] = headCommit;
    return `Branch '${newBranch}' created.`;
  }

  public checkout(vfs: VirtualFileSystem, target: string): string {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository');
    }

    let targetCommitHash = '';
    let isBranch = false;

    if (this.state.branches[target] !== undefined) {
      targetCommitHash = this.state.branches[target];
      isBranch = true;
    } else if (this.state.commits[target] !== undefined) {
      targetCommitHash = target;
    } else {
      throw new Error(`error: pathspec '${target}' did not match any file(s) known to git`);
    }

    if (targetCommitHash) {
      const commit = this.state.commits[targetCommitHash];
      if (commit && commit.treeHash) {
        try {
          const snapshotRoot = JSON.parse(commit.treeHash) as VNode;
          const currentRoot = vfs.getRoot();
          currentRoot.children = snapshotRoot.children;
        } catch (e) {
          throw new Error(`error: failed to restore repository tree for checkout: ${e}`);
        }
      }
    }

    if (isBranch) {
      this.state.head = target;
      return `Switched to branch '${target}'`;
    } else {
      this.state.head = targetCommitHash;
      return `Note: switching to '${targetCommitHash}'.\nYou are in 'detached HEAD' state.`;
    }
  }

  public merge(vfs: VirtualFileSystem, targetBranch: string): string {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository');
    }

    if (this.state.branches[targetBranch] === undefined) {
      throw new Error(`merge: ${targetBranch} - not something we can merge`);
    }

    const currentHeadCommit = this.state.branches[this.state.head] || '';
    const targetCommit = this.state.branches[targetBranch] || '';

    if (currentHeadCommit === targetCommit) {
      return 'Already up to date.';
    }

    if (!currentHeadCommit) {
      this.state.branches[this.state.head] = targetCommit;
      this.checkout(vfs, this.state.head);
      return `Fast-forwarded to '${targetBranch}'`;
    }

    let temp = targetCommit;
    let isAncestor = false;
    while (temp) {
      const c = this.state.commits[temp];
      if (c && c.parentHashes.includes(currentHeadCommit)) {
        isAncestor = true;
        break;
      }
      temp = c?.parentHashes[0] || '';
    }

    if (isAncestor) {
      this.state.branches[this.state.head] = targetCommit;
      this.checkout(vfs, this.state.head);
      return `Updating ${currentHeadCommit.substring(0, 7)}..${targetCommit.substring(0, 7)}\nFast-forward`;
    }

    const newHash = generateHash();
    const targetCommitObj = this.state.commits[targetCommit];
    const newCommit: GitCommit = {
      hash: newHash,
      message: `Merge branch '${targetBranch}' into ${this.state.head}`,
      author: 'Student <student@virtual.edu>',
      timestamp: Date.now(),
      parentHashes: [currentHeadCommit, targetCommit],
      treeHash: targetCommitObj.treeHash,
    };

    this.state.commits[newHash] = newCommit;
    this.state.branches[this.state.head] = newHash;
    this.checkout(vfs, this.state.head);

    return `Merge made by the 'recursive' strategy.\n`;
  }

  public remote(args: string[]): string {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository');
    }

    if (args.length === 0) {
      return Object.keys(this.state.remotes).join('\n');
    }

    if (args[0] === '-v') {
      return Object.values(this.state.remotes)
        .map((r: any) => `${r.name}\t${r.url} (fetch)\n${r.name}\t${r.url} (push)`)
        .join('\n');
    }

    if (args[0] === 'add') {
      if (args.length < 3) {
        throw new Error('usage: git remote add <name> <url>');
      }
      const name = args[1];
      const url = args[2];
      this.state.remotes[name] = { name, url };
      return '';
    }

    throw new Error(`unknown remote command: ${args[0]}`);
  }

  public clone(vfs: VirtualFileSystem, url: string): string {
    const repoName = url.split('/').pop()?.replace('.git', '') || 'my-cloned-repo';
    vfs.mkdir(repoName);
    const oldCwd = vfs.getCwd();
    vfs.cd(repoName);

    this.init(vfs);
    vfs.touch('README.md', `# ${repoName}\nCloned from ${url}\n`);
    this.add(vfs, ['README.md']);
    this.commit(vfs, 'Initial commit (cloned)');

    this.state.remotes['origin'] = { name: 'origin', url };

    vfs.cd(oldCwd);

    return `Cloning into '${repoName}'...\nremote: Enumerating objects: 3, done.\nUnpacking objects: 100% (3/3), done.`;
  }

  public reset(vfs: VirtualFileSystem, args: string[], hard = false): string {
    if (!this.state.initialized) {
      throw new Error('fatal: not a git repository');
    }

    if (hard) {
      const commitTarget = args[0] || 'HEAD';
      let targetHash = '';
      if (this.state.branches[commitTarget] !== undefined) {
        targetHash = this.state.branches[commitTarget];
      } else if (this.state.commits[commitTarget] !== undefined) {
        targetHash = commitTarget;
      } else if (commitTarget === 'HEAD') {
        targetHash = this.state.branches[this.state.head] || '';
      }

      if (!targetHash) {
        throw new Error(`fatal: Cannot do hard reset, target '${commitTarget}' is invalid.`);
      }

      this.state.branches[this.state.head] = targetHash;
      this.state.staged = [];
      this.checkout(vfs, this.state.head);
      return `HEAD is now at ${targetHash.substring(0, 7)}`;
    }

    this.state.staged = [];
    return 'Unstaged all changes';
  }
}
