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

  fastify.post('/terminal/complete-quest', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    const { questId, xpReward } = request.body as { questId: string; xpReward: number };

    if (!questId) {
      return reply.code(400).send({ error: 'Quest ID is required' });
    }

    const dbProgress = await prisma.progress.findUnique({ where: { userId } });
    if (!dbProgress) {
      return reply.code(404).send({ error: 'Progress record not found' });
    }

    const completedLessons = dbProgress.completedLessonsJson as string[];
    if (!completedLessons.includes(questId)) {
      completedLessons.push(questId);

      const progressState = {
        userId,
        xp: dbProgress.xp,
        level: dbProgress.level,
        completedLessons,
        achievements: dbProgress.achievementsJson as string[],
        commandsCount: dbProgress.commandsCount,
        failuresCount: dbProgress.failuresCount,
      };

      const { awardXp } = await import('../engines/progress');
      const xpRes = awardXp(progressState, xpReward);

      await prisma.progress.update({
        where: { userId },
        data: {
          xp: xpRes.progress.xp,
          level: xpRes.progress.level,
          completedLessonsJson: completedLessons as any,
        },
      });
    }

    return { success: true };
  });
};
