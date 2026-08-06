import { UserProgress, TerminalEvent } from '../shared/types';

export function calculateLevel(xp: number): number {
  if (xp <= 0) return 1;
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export function awardXp(
  progress: UserProgress,
  amount: number
): { progress: UserProgress; leveledUp: boolean } {
  const nextXp = progress.xp + amount;
  const oldLevel = progress.level;
  const nextLevel = calculateLevel(nextXp);

  const updatedProgress: UserProgress = {
    ...progress,
    xp: nextXp,
    level: nextLevel,
  };

  return {
    progress: updatedProgress,
    leveledUp: nextLevel > oldLevel,
  };
}

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  xpBonus: number;
}

export const achievementDefinitions: AchievementDefinition[] = [
  {
    id: 'first-dir',
    title: 'First Folder',
    description: 'Create your first simulated directory.',
    xpBonus: 20,
  },
  {
    id: 'git-init',
    title: 'Git Explorer',
    description: 'Initialize a virtual Git repository.',
    xpBonus: 30,
  },
  {
    id: 'git-commit',
    title: 'Code Committed',
    description: 'Perform a virtual commit snapshot.',
    xpBonus: 40,
  },
  {
    id: 'git-push',
    title: 'To the Cloud',
    description: 'Push your virtual repository changes to the remote origin.',
    xpBonus: 50,
  },
  {
    id: 'command-count-20',
    title: 'Typing Master',
    description: 'Run 20 terminal commands successfully.',
    xpBonus: 50,
  },
  {
    id: 'lessons-completed-3',
    title: 'Lesson Graduate',
    description: 'Complete 3 learning tracks.',
    xpBonus: 100,
  },
];

export function checkAchievements(
  progress: UserProgress,
  latestEvent: TerminalEvent
): string[] {
  const newlyUnlocked: string[] = [];
  const currentSet = new Set(progress.achievements);

  const triggerUnlock = (id: string) => {
    if (!currentSet.has(id)) {
      newlyUnlocked.push(id);
    }
  };

  if (latestEvent.type === 'DIRECTORY_CREATED') {
    triggerUnlock('first-dir');
  } else if (latestEvent.type === 'GIT_INIT') {
    triggerUnlock('git-init');
  } else if (latestEvent.type === 'GIT_COMMIT') {
    triggerUnlock('git-commit');
  } else if (latestEvent.type === 'GIT_PUSH') {
    triggerUnlock('git-push');
  }

  if (progress.commandsCount >= 20) {
    triggerUnlock('command-count-20');
  }
  if (progress.completedLessons.length >= 3) {
    triggerUnlock('lessons-completed-3');
  }

  return newlyUnlocked;
}
