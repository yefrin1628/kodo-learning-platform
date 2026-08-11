import { Injectable } from '@nestjs/common';
import type { Prisma } from '@kodo/database';

type Tx = Prisma.TransactionClient;

export interface UnlockedAchievement {
  key: string;
  name: string;
  icon: string;
  xp: number;
}

type Check = (tx: Tx, userId: string) => Promise<boolean>;

// Small reusable predicates so the 25 achievement conditions stay readable
// instead of 25 near-duplicate hand-rolled queries.
const lessonsCompletedAtLeast =
  (n: number): Check =>
  async (tx, userId) =>
    (await tx.lessonProgress.count({ where: { userId, completed: true } })) >= n;

const streakAtLeast =
  (n: number): Check =>
  async (tx, userId) =>
    ((await tx.streak.findUnique({ where: { userId } }))?.current ?? 0) >= n;

const xpAtLeast =
  (n: number): Check =>
  async (tx, userId) =>
    ((await tx.userStats.findUnique({ where: { userId } }))?.xp ?? 0) >= n;

const anyCourseComplete: Check = async (tx, userId) =>
  (await tx.userCourseProgress.count({ where: { userId, percentComplete: 100 } })) > 0;

const coursePercentAtLeast =
  (slug: string, pct: number): Check =>
  async (tx, userId) => {
    const course = await tx.course.findUnique({ where: { slug } });
    if (!course) return false;
    const progress = await tx.userCourseProgress.findUnique({
      where: { userId_courseId: { userId, courseId: course.id } },
    });
    return (progress?.percentComplete ?? 0) >= pct;
  };

const ranAnyCode: Check = async (tx, userId) =>
  (await tx.exerciseProgress.count({ where: { userId, attempts: { gt: 0 }, exercise: { type: 'RUN' } } })) > 0;

const anyUnitComplete: Check = async (tx, userId) => {
  const units = await tx.unit.findMany({ select: { id: true, lessons: { select: { id: true } } } });
  for (const u of units) {
    if (u.lessons.length === 0) continue;
    const done = await tx.lessonProgress.count({
      where: { userId, completed: true, lessonId: { in: u.lessons.map((l) => l.id) } },
    });
    if (done === u.lessons.length) return true;
  }
  return false;
};

const projectsCompletedAtLeast =
  (n: number): Check =>
  async (tx, userId) =>
    (await tx.lessonProgress.count({ where: { userId, completed: true, lesson: { isProject: true } } })) >= n;

const vocabWordsAtLeast =
  (n: number, courseSlug?: string): Check =>
  async (tx, userId) => {
    if (!courseSlug) {
      return (await tx.vocabularyReview.count({ where: { userId } })) >= n;
    }
    const course = await tx.course.findUnique({ where: { slug: courseSlug } });
    if (!course) return false;
    return (await tx.vocabularyReview.count({ where: { userId, vocabulary: { courseId: course.id } } })) >= n;
  };

const distinctLanguageCoursesAtLeast =
  (n: number): Check =>
  async (tx, userId) => {
    const rows = await tx.lessonProgress.findMany({
      where: { userId, completed: true, lesson: { unit: { course: { type: 'LANGUAGE' } } } },
      select: { lesson: { select: { unit: { select: { courseId: true } } } } },
    });
    const distinct = new Set(rows.map((r) => r.lesson.unit.courseId));
    return distinct.size >= n;
  };

const CHECKS: Record<string, Check> = {
  'first-lesson': lessonsCompletedAtLeast(1),
  'first-streak': streakAtLeast(2),
  'streak7': streakAtLeast(7),
  'xp100': xpAtLeast(100),
  'xp500': xpAtLeast(500),
  'first-course': anyCourseComplete,
  'first-code': ranAnyCode,
  'lessons10': lessonsCompletedAtLeast(10),
  'first-unit': anyUnitComplete,
  'first-proj': projectsCompletedAtLeast(1),
  'proj3': projectsCompletedAtLeast(3),
  'a1-en': coursePercentAtLeast('en', 17),
  'words50': vocabWordsAtLeast(50),
  'words100': vocabWordsAtLeast(100),
  'words500': vocabWordsAtLeast(500),
  'second-lang': distinctLanguageCoursesAtLeast(2),
  'js-master': coursePercentAtLeast('js', 100),
  'html-master': coursePercentAtLeast('html', 100),
  'css-master': coursePercentAtLeast('css', 100),
  'fr-a1': coursePercentAtLeast('fr', 17),
  'fr-a2': coursePercentAtLeast('fr', 34),
  'pt-a1': coursePercentAtLeast('pt', 17),
  'pt-a2': coursePercentAtLeast('pt', 34),
  'fr-words500': vocabWordsAtLeast(500, 'fr'),
  'pt-words500': vocabWordsAtLeast(500, 'pt'),
};

@Injectable()
export class AchievementsService {
  /** Evaluates every achievement not yet unlocked by this user and unlocks any newly earned ones. */
  async checkAndUnlock(tx: Tx, userId: string): Promise<UnlockedAchievement[]> {
    const catalog = await tx.achievement.findMany({ where: { isActive: true } });
    const already = await tx.userAchievement.findMany({ where: { userId }, select: { achievementId: true } });
    const unlockedIds = new Set(already.map((a) => a.achievementId));

    const unlocked: UnlockedAchievement[] = [];
    for (const achievement of catalog) {
      if (unlockedIds.has(achievement.id)) continue;
      const check = CHECKS[achievement.key];
      if (!check) continue;
      if (await check(tx, userId)) {
        await tx.userAchievement.create({
          data: { userId, achievementId: achievement.id, xpAwarded: achievement.rewardXp },
        });
        if (achievement.rewardXp > 0) {
          await tx.xPTransaction.create({
            data: {
              userId,
              amount: achievement.rewardXp,
              reason: 'ACHIEVEMENT',
              metadata: { achievementKey: achievement.key },
            },
          });
          await tx.userStats.update({ where: { userId }, data: { xp: { increment: achievement.rewardXp } } });
        }
        unlocked.push({ key: achievement.key, name: achievement.name, icon: achievement.icon, xp: achievement.rewardXp });
      }
    }
    return unlocked;
  }
}
