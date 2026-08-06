import { VNode, VFileMetadata } from '../shared/types';

export function createDefaultMetadata(type: 'file' | 'directory', size = 0): VFileMetadata {
  return {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    permissions: type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
    owner: 'student',
    group: 'student',
    size,
  };
}

export function createDefaultRoot(): VNode {
  return {
    name: '/',
    type: 'directory',
    metadata: createDefaultMetadata('directory'),
    children: {
      home: {
        name: 'home',
        type: 'directory',
        metadata: createDefaultMetadata('directory'),
        children: {
          student: {
            name: 'student',
            type: 'directory',
            metadata: createDefaultMetadata('directory'),
            children: {},
          },
        },
      },
      tmp: {
        name: 'tmp',
        type: 'directory',
        metadata: createDefaultMetadata('directory'),
        children: {},
      },
    },
  };
}

export class VirtualFileSystem {
  private root: VNode;
  private cwd: string;

  constructor(rootState?: VNode, initialCwd = '/home/student') {
    this.root = rootState || createDefaultRoot();
    this.cwd = initialCwd;
  }

  public getRoot(): VNode {
    return this.root;
  }

  public getCwd(): string {
    return this.cwd;
  }

  public normalizePath(targetPath: string): string {
    if (!targetPath) return this.cwd;

    let absolute = targetPath.startsWith('/');
    const pathParts = absolute ? targetPath.split('/') : `${this.cwd}/${targetPath}`.split('/');

    const resolvedParts: string[] = [];
    for (const part of pathParts) {
      if (part === '' || part === '.') {
        continue;
      }
      if (part === '..') {
        resolvedParts.pop();
      } else {
        resolvedParts.push(part);
      }
    }

    return '/' + resolvedParts.join('/');
  }

  public getNode(targetPath: string): VNode | null {
    const normPath = this.normalizePath(targetPath);
    if (normPath === '/') {
      return this.root;
    }

    const parts = normPath.split('/').filter(Boolean);
    let current: VNode = this.root;

    for (const part of parts) {
      if (current.type !== 'directory' || !current.children) {
        return null;
      }
      const child = current.children[part];
      if (!child) {
        return null;
      }
      current = child;
    }

    return current;
  }

  public cd(targetPath: string): void {
    const normPath = this.normalizePath(targetPath);
    const node = this.getNode(normPath);
    if (!node) {
      throw new Error(`cd: no such file or directory: ${targetPath}`);
    }
    if (node.type !== 'directory') {
      throw new Error(`cd: not a directory: ${targetPath}`);
    }
    this.cwd = normPath;
  }

  public ls(targetPath?: string): VNode[] {
    const path = targetPath ? targetPath : this.cwd;
    const node = this.getNode(path);
    if (!node) {
      throw new Error(`ls: no such file or directory: ${path}`);
    }
    if (node.type !== 'directory' || !node.children) {
      throw new Error(`ls: not a directory: ${path}`);
    }
    return Object.values(node.children);
  }

  public mkdir(targetPath: string, recursive = false): void {
    const normPath = this.normalizePath(targetPath);
    const parts = normPath.split('/').filter(Boolean);
    let current = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children) {
        current.children = {};
      }

      let child = current.children[part];
      if (!child) {
        if (i < parts.length - 1 && !recursive) {
          throw new Error(`mkdir: cannot create directory '${targetPath}': No such file or directory`);
        }
        child = {
          name: part,
          type: 'directory',
          metadata: createDefaultMetadata('directory'),
          children: {},
        };
        current.children[part] = child;
      } else if (child.type !== 'directory' && i < parts.length - 1) {
        throw new Error(`mkdir: '${child.name}' is not a directory`);
      }
      current = child;
    }
  }

  public touch(targetPath: string, content = ''): void {
    const normPath = this.normalizePath(targetPath);
    const parts = normPath.split('/').filter(Boolean);
    if (parts.length === 0) {
      throw new Error("touch: cannot touch '/': Is a directory");
    }

    const fileName = parts.pop()!;
    const parentPath = '/' + parts.join('/');
    const parentNode = this.getNode(parentPath);

    if (!parentNode) {
      throw new Error(`touch: cannot touch '${targetPath}': No such file or directory`);
    }
    if (parentNode.type !== 'directory' || !parentNode.children) {
      throw new Error(`touch: parent path is not a directory`);
    }

    const existingFile = parentNode.children[fileName];
    if (existingFile) {
      if (existingFile.type === 'directory') {
        existingFile.metadata.updatedAt = Date.now();
      } else {
        existingFile.metadata.updatedAt = Date.now();
        if (content) {
          existingFile.content = content;
          existingFile.metadata.size = content.length;
        }
      }
    } else {
      parentNode.children[fileName] = {
        name: fileName,
        type: 'file',
        content,
        metadata: createDefaultMetadata('file', content.length),
      };
    }
  }

  public writeFile(targetPath: string, content: string): void {
    this.touch(targetPath, content);
  }

  public readFile(targetPath: string): string {
    const node = this.getNode(targetPath);
    if (!node) {
      throw new Error(`cat: ${targetPath}: No such file or directory`);
    }
    if (node.type !== 'file') {
      throw new Error(`cat: ${targetPath}: Is a directory`);
    }
    return node.content || '';
  }

  public rm(targetPath: string, recursive = false, force = false): void {
    const normPath = this.normalizePath(targetPath);
    const parts = normPath.split('/').filter(Boolean);
    if (parts.length === 0) {
      if (force) return;
      throw new Error("rm: cannot remove root directory '/'");
    }

    const targetName = parts.pop()!;
    const parentPath = '/' + parts.join('/');
    const parentNode = this.getNode(parentPath);

    if (!parentNode || parentNode.type !== 'directory' || !parentNode.children) {
      if (force) return;
      throw new Error(`rm: cannot remove '${targetPath}': No such file or directory`);
    }

    const targetNode = parentNode.children[targetName];
    if (!targetNode) {
      if (force) return;
      throw new Error(`rm: cannot remove '${targetPath}': No such file or directory`);
    }

    if (targetNode.type === 'directory' && !recursive) {
      throw new Error(`rm: cannot remove '${targetPath}': Is a directory`);
    }

    delete parentNode.children[targetName];
  }

  public mv(srcPath: string, destPath: string): void {
    const srcNode = this.getNode(srcPath);
    if (!srcNode) {
      throw new Error(`mv: cannot stat '${srcPath}': No such file or directory`);
    }

    const normDest = this.normalizePath(destPath);
    let destNode = this.getNode(normDest);

    if (destNode && destNode.type === 'directory') {
      if (!destNode.children) destNode.children = {};
      destNode.children[srcNode.name] = JSON.parse(JSON.stringify(srcNode));
      this.rm(srcPath, true, true);
      return;
    }

    const destParts = normDest.split('/').filter(Boolean);
    if (destParts.length === 0) {
      throw new Error("mv: cannot overwrite root '/'");
    }

    const destName = destParts.pop()!;
    const destParentPath = '/' + destParts.join('/');
    const destParentNode = this.getNode(destParentPath);

    if (!destParentNode || destParentNode.type !== 'directory' || !destParentNode.children) {
      throw new Error(`mv: cannot move to '${destPath}': Parent directory does not exist`);
    }

    const cloned = JSON.parse(JSON.stringify(srcNode)) as VNode;
    cloned.name = destName;
    destParentNode.children[destName] = cloned;

    this.rm(srcPath, true, true);
  }

  public cp(srcPath: string, destPath: string, recursive = false): void {
    const srcNode = this.getNode(srcPath);
    if (!srcNode) {
      throw new Error(`cp: cannot stat '${srcPath}': No such file or directory`);
    }
    if (srcNode.type === 'directory' && !recursive) {
      throw new Error(`cp: -r not specified; omitting directory '${srcPath}'`);
    }

    const normDest = this.normalizePath(destPath);
    let destNode = this.getNode(normDest);

    if (destNode && destNode.type === 'directory') {
      if (!destNode.children) destNode.children = {};
      destNode.children[srcNode.name] = JSON.parse(JSON.stringify(srcNode));
      return;
    }

    const destParts = normDest.split('/').filter(Boolean);
    const destName = destParts.pop()!;
    const destParentPath = '/' + destParts.join('/');
    const destParentNode = this.getNode(destParentPath);

    if (!destParentNode || destParentNode.type !== 'directory' || !destParentNode.children) {
      throw new Error(`cp: cannot copy to '${destPath}': Parent directory does not exist`);
    }

    const cloned = JSON.parse(JSON.stringify(srcNode)) as VNode;
    cloned.name = destName;
    destParentNode.children[destName] = cloned;
  }

  public tree(targetPath?: string): string {
    const startPath = targetPath ? targetPath : this.cwd;
    const startNode = this.getNode(startPath);
    if (!startNode) {
      throw new Error(`tree: [error opening dir] ${startPath}`);
    }

    let output = startNode.name === '/' ? '/' : startNode.name;
    output += '\n';

    const buildTree = (node: VNode, prefix: string): string => {
      let result = '';
      if (node.type !== 'directory' || !node.children) return result;

      const keys = Object.keys(node.children);
      keys.forEach((key, index) => {
        const isLast = index === keys.length - 1;
        const child = node.children![key];
        const lineConnector = isLast ? '└── ' : '├── ';
        result += `${prefix}${lineConnector}${child.name}\n`;

        if (child.type === 'directory') {
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');
          result += buildTree(child, nextPrefix);
        }
      });
      return result;
    };

    output += buildTree(startNode, '');
    return output.trim();
  }

  public serialize(): VNode {
    return this.root;
  }
}

export function crawlFiles(node: VNode, currentPath: string): Record<string, string> {
  const files: Record<string, string> = {};

  const traverse = (n: VNode, path: string) => {
    if (n.name.startsWith('.')) return;
    if (n.type === 'file') {
      files[path] = n.content || '';
    } else if (n.type === 'directory' && n.children) {
      for (const name of Object.keys(n.children)) {
        traverse(n.children[name], path === '/' ? `/${name}` : `${path}/${name}`);
      }
    }
  };

  traverse(node, currentPath);
  return files;
}
