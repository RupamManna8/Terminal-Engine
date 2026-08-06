import { describe, expect, it } from 'vitest';
import { GitEngine } from '../git';
import { VirtualFileSystem } from '../vfs';
import { GitState } from '../../shared/types';

describe('Simulated Git Engine', () => {
  it('should initialize repository metadata', () => {
    const vfs = new VirtualFileSystem();
    const gitState: GitState = {
      initialized: false,
      head: '',
      branches: {},
      staged: [],
      commits: {},
      remotes: {},
    };
    const git = new GitEngine(gitState);
    git.init(vfs);
    expect(gitState.initialized).toBe(true);
    expect(gitState.head).toBe('main');
  });

  it('should stage, commit, log, and checkout VFS versions', () => {
    const vfs = new VirtualFileSystem();
    const gitState: GitState = {
      initialized: false,
      head: '',
      branches: {},
      staged: [],
      commits: {},
      remotes: {},
    };
    const git = new GitEngine(gitState);
    git.init(vfs);

    vfs.touch('main.go', 'package main');
    git.add(vfs, ['main.go']);
    expect(gitState.staged).toContain('/home/student/main.go');

    const commitMsg = 'init main.go';
    git.commit(vfs, commitMsg);
    expect(gitState.staged.length).toBe(0);

    const activeCommitHash = gitState.branches[gitState.head];
    expect(activeCommitHash).toBeDefined();
    expect(gitState.commits[activeCommitHash].message).toBe(commitMsg);

    git.branch(['feature']);
    git.checkout(vfs, 'feature');
    vfs.touch('feature.txt', 'experimental feature content');
    git.add(vfs, ['feature.txt']);
    git.commit(vfs, 'feature commits');

    git.checkout(vfs, 'main');
    expect(vfs.getNode('feature.txt')).toBeNull();

    git.checkout(vfs, 'feature');
    expect(vfs.getNode('feature.txt')).not.toBeNull();
  });
});
