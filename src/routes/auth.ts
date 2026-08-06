import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { createDefaultRoot } from '../engines/vfs';

declare module 'fastify' {
  interface Session {
    userId?: string;
  }
}

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post('/auth/signup', async (request, reply) => {
    const parseResult = SignupSchema.safeParse(request.body);
    if (!parseResult.success) {
      fastify.log.warn({ error: parseResult.error.format(), body: request.body }, 'Signup validation failed');
      return reply.code(400).send({ error: 'Invalid signup data', details: parseResult.error.format() });
    }

    const { email, password, name } = parseResult.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: 'User with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const defaultVfs = createDefaultRoot();
    const defaultGit = {
      initialized: false,
      head: '',
      branches: {},
      staged: [],
      commits: {},
      remotes: {},
    };

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
      },
    });

    await prisma.terminalState.create({
      data: {
        userId: user.id,
        cwd: '/home/student',
        vfsJson: defaultVfs as any,
        gitJson: defaultGit as any,
        historyJson: [] as any,
        envJson: { USER: 'student', HOME: '/home/student', PATH: '/usr/bin:/bin' } as any,
      },
    });

    await prisma.progress.create({
      data: {
        userId: user.id,
        xp: 0,
        level: 1,
        completedLessonsJson: [] as any,
        achievementsJson: [] as any,
        commandsCount: 0,
        failuresCount: 0,
      },
    });

    request.session.userId = user.id;
    return { id: user.id, email: user.email, name: user.name };
  });

  fastify.post('/auth/login', async (request, reply) => {
    const parseResult = LoginSchema.safeParse(request.body);
    if (!parseResult.success) {
      fastify.log.warn({ error: parseResult.error.format(), body: request.body }, 'Login validation failed');
      return reply.code(400).send({ error: 'Invalid credentials' });
    }

    const { email, password } = parseResult.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    request.session.userId = user.id;
    return { id: user.id, email: user.email, name: user.name };
  });

  fastify.post('/auth/logout', async (request, reply) => {
    if (!request.session.userId) {
      return reply.code(400).send({ error: 'No active session' });
    }
    request.session.destroy();
    return { message: 'Logged out successfully' };
  });

  fastify.get('/auth/me', async (request, reply) => {
    if (!request.session.userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: request.session.userId },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return user;
  });
};
