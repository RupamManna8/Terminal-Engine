import { describe, expect, it } from 'vitest';
import { VirtualFileSystem } from '../vfs';

describe('Virtual Filesystem Engine', () => {
  it('should navigate pathways using absolute and relative references', () => {
    const vfs = new VirtualFileSystem();
    expect(vfs.getCwd()).toBe('/home/student');

    vfs.mkdir('workspace/projects', true);
    vfs.cd('workspace/projects');
    expect(vfs.getCwd()).toBe('/home/student/workspace/projects');

    vfs.cd('../..');
    expect(vfs.getCwd()).toBe('/home/student');
  });

  it('should create and verify content updates', () => {
    const vfs = new VirtualFileSystem();
    vfs.touch('script.py', 'print("hello world")');
    expect(vfs.readFile('script.py')).toBe('print("hello world")');
  });

  it('should fail CDing to non-existing paths', () => {
    const vfs = new VirtualFileSystem();
    expect(() => vfs.cd('non_existent_folder')).toThrow();
  });
});
