import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '../db';
import { executeCommand } from '../engines/terminal';
import { defaultLessons, validateStep } from '../engines/lessons';
import { awardXp, checkAchievements, AchievementDefinition } from '../engines/progress';
import { TerminalSessionState, UserProgress, Lesson } from '../shared/types';
import { createDefaultRoot } from '../engines/vfs';
import { decryptToken } from '../engines/github';
import { config } from '../config';

declare module 'fastify' {
  interface Session {
    activeStepIndex?: number;
  }
}

export const requireAuth = async (request: any, reply: any) => {
  if (!request.session.userId) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
};

export const terminalRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/terminal/session', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;

    const state = await prisma.terminalState.findUnique({
      where: { userId },
    });

    if (!state) {
      return reply.code(404).send({ error: 'Terminal session state not found' });
    }

    return {
      cwd: state.cwd,
      vfs: state.vfsJson,
      git: state.gitJson,
      history: state.historyJson,
      env: state.envJson,
    };
  });

  fastify.post('/terminal/execute', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    const { command } = request.body as { command: string };

    if (!command) {
      return reply.code(400).send({ error: 'Command input is required' });
    }

    const dbState = await prisma.terminalState.findUnique({ where: { userId } });
    const dbProgress = await prisma.progress.findUnique({ where: { userId } });
    const dbCred = await prisma.githubCredential.findUnique({ where: { userId } });

    if (!dbState || !dbProgress) {
      return reply.code(500).send({ error: 'Failed to retrieve terminal session context' });
    }

    const sessionState: TerminalSessionState = {
      cwd: dbState.cwd,
      vfs: dbState.vfsJson as any,
      git: dbState.gitJson as any,
      history: dbState.historyJson as any,
      env: dbState.envJson as any,
    };

    const progressState: UserProgress = {
      userId,
      xp: dbProgress.xp,
      level: dbProgress.level,
      completedLessons: dbProgress.completedLessonsJson as string[],
      achievements: dbProgress.achievementsJson as string[],
      commandsCount: dbProgress.commandsCount,
      failuresCount: dbProgress.failuresCount,
    };

    const completedSet = new Set(progressState.completedLessons);
    const activeLesson = defaultLessons.find((l: Lesson) => !completedSet.has(l.id));
    
    if (request.session.activeStepIndex === undefined) {
      request.session.activeStepIndex = 0;
    }

    let activeStep = activeLesson ? activeLesson.steps[request.session.activeStepIndex] : null;

    let githubConnected = false;
    let decryptedToken = '';
    if (dbCred && dbCred.encryptedToken) {
      try {
        decryptedToken = decryptToken(dbCred.encryptedToken, config.ENCRYPTION_KEY);
        githubConnected = true;
      } catch (e) {}
    }

    const githubApiCall = async (action: string, payload: any) => {
      const { pushVfsToGithub, pullGithubToVfs } = await import('../engines/github');
      
      const repoOwner = dbCred?.repoOwner || '';
      const repoName = dbCred?.repoName || '';

      if (!repoOwner || !repoName) {
        throw new Error('No linked repository. Link one via GitHub connected settings panel.');
      }

      if (action === 'push') {
        return await pushVfsToGithub(decryptedToken, repoOwner, repoName, payload.branch, sessionState.vfs);
      } else if (action === 'pull') {
        const res = await pullGithubToVfs(decryptedToken, repoOwner, repoName, payload.branch);
        sessionState.vfs = res.vfs;
        return res;
      }
      throw new Error(`Invalid GitHub action: ${action}`);
    };

    const response = await executeCommand(sessionState, command, {
      userId,
      githubConnected,
      githubApiCall: githubConnected ? githubApiCall : undefined,
    });

    if (response.exitCode === 0) {
      progressState.commandsCount += 1;
    } else {
      progressState.failuresCount += 1;
    }

    const feedbackMessages: string[] = [];

    if (activeStep && response.events && response.events.length > 0) {
      let stepValid = false;
      const updatedTempState = {
        ...sessionState,
        ...response.updatedState,
      };

      for (const event of response.events) {
        if (validateStep(activeStep, event, updatedTempState)) {
          stepValid = true;
          break;
        }
      }

      if (stepValid) {
        request.session.activeStepIndex += 1;
        feedbackMessages.push(`🎉 Step complete: ${activeStep.description}`);

        if (request.session.activeStepIndex >= activeLesson!.steps.length) {
          progressState.completedLessons.push(activeLesson!.id);
          request.session.activeStepIndex = 0;

          const xpAwarded = activeLesson!.xpReward;
          const xpRes = awardXp(progressState, xpAwarded);
          Object.assign(progressState, xpRes.progress);

          feedbackMessages.push(`🏆 Lesson Completed: ${activeLesson!.title}! +${xpAwarded} XP`);
          if (xpRes.leveledUp) {
            feedbackMessages.push(`✨ LEVEL UP! You are now Level ${progressState.level}!`);
          }
        }
      }
    }

    if (response.events) {
      for (const event of response.events) {
        const newUnlocks = checkAchievements(progressState, event);
        if (newUnlocks.length > 0) {
          for (const achId of newUnlocks) {
            progressState.achievements.push(achId);
            const { achievementDefinitions } = await import('../engines/progress');
            const def = achievementDefinitions.find((a: AchievementDefinition) => a.id === achId);
            if (def) {
              const xpRes = awardXp(progressState, def.xpBonus);
              Object.assign(progressState, xpRes.progress);
              feedbackMessages.push(`🏅 Achievement Unlocked: ${def.title} - ${def.description} (+${def.xpBonus} XP)`);
              if (xpRes.leveledUp) {
                feedbackMessages.push(`✨ LEVEL UP! You are now Level ${progressState.level}!`);
              }
            }
          }
        }
      }
    }

    const finalState = {
      ...sessionState,
      ...response.updatedState,
    };

    await prisma.terminalState.update({
      where: { userId },
      data: {
        cwd: finalState.cwd,
        vfsJson: finalState.vfs as any,
        gitJson: finalState.git as any,
        historyJson: finalState.history as any,
        envJson: finalState.env as any,
      },
    });

    await prisma.progress.update({
      where: { userId },
      data: {
        xp: progressState.xp,
        level: progressState.level,
        completedLessonsJson: progressState.completedLessons as any,
        achievementsJson: progressState.achievements as any,
        commandsCount: progressState.commandsCount,
        failuresCount: progressState.failuresCount,
      },
    });

    const nextCompletedSet = new Set(progressState.completedLessons);
    const nextActiveLesson = defaultLessons.find((l: Lesson) => !nextCompletedSet.has(l.id));
    const nextStep = nextActiveLesson ? nextActiveLesson.steps[request.session.activeStepIndex] : null;

    return {
      stdout: response.stdout,
      stderr: response.stderr,
      exitCode: response.exitCode,
      feedback: feedbackMessages,
      cwd: finalState.cwd,
      history: finalState.history,
      progress: {
        xp: progressState.xp,
        level: progressState.level,
        completedLessons: progressState.completedLessons,
        achievements: progressState.achievements,
      },
      activeLesson: nextActiveLesson ? {
        id: nextActiveLesson.id,
        title: nextActiveLesson.title,
        description: nextActiveLesson.description,
        category: nextActiveLesson.category,
        totalSteps: nextActiveLesson.steps.length,
        activeStepIndex: request.session.activeStepIndex,
        activeStepDescription: nextStep ? nextStep.description : '',
      } : null,
    };
  });

  fastify.delete('/terminal/session', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    const defaultVfs = createDefaultRoot();
    const defaultGit = {
      initialized: false,
      head: '',
      branches: {},
      staged: [],
      commits: {},
      remotes: {},
    };

    await prisma.terminalState.update({
      where: { userId },
      data: {
        cwd: '/home/student',
        vfsJson: defaultVfs as any,
        gitJson: defaultGit as any,
        historyJson: [] as any,
        envJson: { USER: 'student', HOME: '/home/student', PATH: '/usr/bin:/bin' } as any,
      },
    });

    request.session.activeStepIndex = 0;
    return { message: 'Terminal session state reset successfully.' };
  });

  fastify.get('/terminal/history', { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.session.userId!;
    const state = await prisma.terminalState.findUnique({
      where: { userId },
      select: { historyJson: true },
    });
    return state?.historyJson || [];
  });
};
