import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { prisma } from './db';
import { authRoutes } from './routes/auth';
import { terminalRoutes } from './routes/terminal';
import { progressRoutes } from './routes/progress';
import { githubRoutes } from './routes/github';

const fastify = Fastify({
  trustProxy: true,
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

async function main() {
  await fastify.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(cookie);
  await fastify.register(session, {
    secret: config.SESSION_SECRET,
    cookieName: 'sessionId',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  try {
    await prisma.$connect();
    fastify.log.info('Database connection established successfully');
  } catch (error) {
    fastify.log.error(error, 'Failed to connect to the database');
    process.exit(1);
  }

  await fastify.register(authRoutes);
  await fastify.register(terminalRoutes);
  await fastify.register(progressRoutes);
  await fastify.register(githubRoutes);

  fastify.get('/health', async () => {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  });

  const shutdown = async () => {
    fastify.log.info('Shutting down server...');
    await fastify.close();
    await prisma.$disconnect();
    fastify.log.info('Server shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await fastify.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
