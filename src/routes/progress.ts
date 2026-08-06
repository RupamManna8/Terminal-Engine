import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../db';
import { defaultLessons } from '../engines/lessons';
import { achievementDefinitions } from '../engines/progress';
import { requireAuth } from './terminal';
import { Lesson } from '../shared/types';

export const progressRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/terminal/progress', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;

    const progress = await prisma.progress.findUnique({
      where: { userId },
    });

    if (!progress) {
      return reply.code(404).send({ error: 'User progress record not found' });
    }

    return {
      xp: progress.xp,
      level: progress.level,
      commandsCount: progress.commandsCount,
      failuresCount: progress.failuresCount,
      completedLessons: progress.completedLessonsJson,
      achievements: progress.achievementsJson,
      availableLessons: defaultLessons.map((l: Lesson) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        category: l.category,
        xpReward: l.xpReward,
        stepsCount: l.steps.length,
      })),
      allAchievements: achievementDefinitions,
    };
  });
};
