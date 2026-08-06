import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../db';
import { encryptToken, decryptToken, pushVfsToGithub, pullGithubToVfs } from '../engines/github';
import { config } from '../config';
import { requireAuth } from './terminal';

export const githubRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/github/login', async (request, reply) => {
    if (!config.GITHUB_CLIENT_ID) {
      return reply.code(500).send({ error: 'GitHub OAuth is not configured on this server.' });
    }
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${config.GITHUB_CLIENT_ID}&scope=repo,read:user,user:email&redirect_uri=${encodeURIComponent(config.GITHUB_CALLBACK_URL)}`;
    return reply.redirect(githubAuthUrl);
  });

  fastify.get('/github/callback', async (request, reply) => {
    const { code } = request.query as { code?: string };
    if (!code) {
      return reply.code(400).send({ error: 'Missing code parameter' });
    }

    if (!request.session.userId) {
      return reply.code(401).send({ error: 'Unauthorized: Session lost' });
    }

    const userId = request.session.userId;

    try {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: config.GITHUB_CLIENT_ID,
          client_secret: config.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const tokenJson = (await tokenResponse.json()) as { access_token?: string; error?: string };
      if (!tokenJson.access_token) {
        return reply.code(400).send({ error: tokenJson.error || 'Failed to retrieve access token' });
      }

      const encrypted = encryptToken(tokenJson.access_token, config.ENCRYPTION_KEY);

      await prisma.githubCredential.upsert({
        where: { userId },
        update: { encryptedToken: encrypted },
        create: { userId, encryptedToken: encrypted },
      });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return reply.redirect(`${frontendUrl}?github=connected`);
    } catch (err: any) {
      return reply.code(500).send({ error: `GitHub OAuth exchange failed: ${err.message}` });
    }
  });

  fastify.post('/github/connect', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    const { repoOwner, repoName, accessToken } = request.body as {
      repoOwner?: string;
      repoName?: string;
      accessToken?: string;
    };

    const updateData: any = {};
    if (repoOwner !== undefined) updateData.repoOwner = repoOwner;
    if (repoName !== undefined) updateData.repoName = repoName;

    if (accessToken) {
      updateData.encryptedToken = encryptToken(accessToken, config.ENCRYPTION_KEY);
    }

    const cred = await prisma.githubCredential.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        encryptedToken: updateData.encryptedToken || '',
        repoOwner: repoOwner || '',
        repoName: repoName || '',
      },
    });

    return {
      connected: true,
      repoOwner: cred.repoOwner,
      repoName: cred.repoName,
    };
  });

  fastify.post('/github/disconnect', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    await prisma.githubCredential.deleteMany({
      where: { userId },
    });
    return { connected: false };
  });

  fastify.post('/github/push', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    const { branch = 'main' } = request.body as { branch?: string };

    const [dbState, dbCred] = await prisma.$transaction([
      prisma.terminalState.findUnique({ where: { userId } }),
      prisma.githubCredential.findUnique({ where: { userId } }),
    ]);

    if (!dbCred || !dbCred.encryptedToken) {
      return reply.code(400).send({ error: 'GitHub is not connected.' });
    }
    if (!dbCred.repoOwner || !dbCred.repoName) {
      return reply.code(400).send({ error: 'No repository linked. Link owner/repo first.' });
    }
    if (!dbState) {
      return reply.code(500).send({ error: 'Failed to retrieve terminal state.' });
    }

    try {
      const decrypted = decryptToken(dbCred.encryptedToken, config.ENCRYPTION_KEY);
      return await pushVfsToGithub(
        decrypted,
        dbCred.repoOwner,
        dbCred.repoName,
        branch,
        dbState.vfsJson as any
      );
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.post('/github/pull', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    const { branch = 'main' } = request.body as { branch?: string };

    const dbCred = await prisma.githubCredential.findUnique({
      where: { userId },
    });

    if (!dbCred || !dbCred.encryptedToken) {
      return reply.code(400).send({ error: 'GitHub is not connected.' });
    }
    if (!dbCred.repoOwner || !dbCred.repoName) {
      return reply.code(400).send({ error: 'No repository linked.' });
    }

    try {
      const decrypted = decryptToken(dbCred.encryptedToken, config.ENCRYPTION_KEY);
      const res = await pullGithubToVfs(decrypted, dbCred.repoOwner, dbCred.repoName, branch);

      await prisma.terminalState.update({
        where: { userId },
        data: {
          vfsJson: res.vfs as any,
          cwd: '/home/student',
        },
      });

      return {
        message: res.message,
        vfs: res.vfs,
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  fastify.get('/github/status', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    const cred = await prisma.githubCredential.findUnique({
      where: { userId },
      select: { repoOwner: true, repoName: true, connectedAt: true },
    });

    return {
      connected: !!cred,
      repoOwner: cred?.repoOwner || null,
      repoName: cred?.repoName || null,
    };
  });
};
