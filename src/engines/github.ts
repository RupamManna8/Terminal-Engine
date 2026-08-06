import crypto from 'crypto';
import { Octokit } from '@octokit/rest';
import { VNode } from '../shared/types';
import { crawlFiles, createDefaultMetadata } from './vfs';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptToken(token: string, secretKey: string): string {
  const key = crypto.createHash('sha256').update(secretKey).digest();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(encryptedData: string, secretKey: string): string {
  const key = crypto.createHash('sha256').update(secretKey).digest();
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encryptedText = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encryptedText) + decipher.final('utf8');
}

export async function pushVfsToGithub(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  vfsRoot: VNode
): Promise<{ message: string }> {
  const octokit = new Octokit({ auth: token });
  const localFiles = crawlFiles(vfsRoot, '/');

  try {
    let refData;
    let baseCommitSha = '';
    let baseTreeSha = '';

    try {
      refData = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      baseCommitSha = refData.data.object.sha;

      const commitInfo = await octokit.git.getCommit({
        owner,
        repo,
        commit_sha: baseCommitSha,
      });
      baseTreeSha = commitInfo.data.tree.sha;
    } catch (e) {
      const repoInfo = await octokit.repos.get({ owner, repo });
      const defaultBranch = repoInfo.data.default_branch || 'main';
      if (branch !== defaultBranch) {
        throw new Error(`Branch ${branch} does not exist on GitHub yet.`);
      }
    }

    const treeEntries: Array<{
      path: string;
      mode: '100644' | '100755' | '040000' | '160000' | '120000';
      type: 'blob' | 'tree' | 'commit';
      sha: string;
    }> = [];

    for (const [path, content] of Object.entries(localFiles) as [string, string][]) {
      const cleanPath = path.startsWith('/') ? path.substring(1) : path;
      if (cleanPath.startsWith('.git') || cleanPath.includes('node_modules')) {
        continue;
      }

      const blobRes = await octokit.git.createBlob({
        owner,
        repo,
        content,
        encoding: 'utf-8',
      });

      treeEntries.push({
        path: cleanPath,
        mode: '100644',
        type: 'blob',
        sha: blobRes.data.sha,
      });
    }

    if (treeEntries.length === 0) {
      return { message: 'Nothing to push, working tree matches remote or is empty.' };
    }

    const treeRes = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha || undefined,
      tree: treeEntries,
    });

    const commitRes = await octokit.git.createCommit({
      owner,
      repo,
      message: 'Sync from Web Virtual Terminal',
      tree: treeRes.data.sha,
      parents: baseCommitSha ? [baseCommitSha] : [],
    });

    if (baseCommitSha) {
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commitRes.data.sha,
      });
    } else {
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: commitRes.data.sha,
      });
    }

    return {
      message: `Successfully pushed virtual commit ${commitRes.data.sha.substring(0, 7)} to GitHub repository ${owner}/${repo} on branch ${branch}`,
    };
  } catch (error: any) {
    throw new Error(`GitHub Push failed: ${error.message || error}`);
  }
}

export async function pullGithubToVfs(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ vfs: VNode; message: string }> {
  const octokit = new Octokit({ auth: token });

  try {
    const refData = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const commitSha = refData.data.object.sha;

    const commitInfo = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: commitSha,
    });

    const treeData = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: commitInfo.data.tree.sha,
      recursive: 'true',
    });

    const root: VNode = {
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
      },
    };

    const studentNode = root.children!.home.children!.student;
    if (!studentNode.children) {
      studentNode.children = {};
    }

    for (const file of treeData.data.tree) {
      if (file.type !== 'blob' || !file.path) {
        continue;
      }

      const blobRes = await octokit.git.getBlob({
        owner,
        repo,
        file_sha: file.sha!,
      });

      const content = Buffer.from(blobRes.data.content, 'base64').toString('utf8');

      const parts = file.path.split('/');
      let current = studentNode;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!current.children) {
          current.children = {};
        }

        if (i === parts.length - 1) {
          current.children[part] = {
            name: part,
            type: 'file',
            content,
            metadata: createDefaultMetadata('file', content.length),
          };
        } else {
          if (!current.children[part]) {
            current.children[part] = {
              name: part,
              type: 'directory',
              metadata: createDefaultMetadata('directory'),
              children: {},
            };
          }
          current = current.children[part];
        }
      }
    }

    return {
      vfs: root,
      message: `Successfully pulled from GitHub repository ${owner}/${repo} (${branch}) at commit ${commitSha.substring(0, 7)}`,
    };
  } catch (error: any) {
    throw new Error(`GitHub Pull failed: ${error.message || error}`);
  }
}
