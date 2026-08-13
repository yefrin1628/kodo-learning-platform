import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@kodo/database';
import { PrismaService } from '../prisma/prisma.service';
import { AnswerValidatorService } from './answer-validator.service';
import { AchievementsService } from './achievements.service';
import { ChallengesService } from './challenges.service';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { levelIndexForXp, REWARDS } from './constants';
import { VocabularyService } from '../vocabulary/vocabulary.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

type Tx = Prisma.TransactionClient;
const DAY_MS = 24 * 60 * 60 * 1000;
const today = () => new Date().toLocaleDateString('en-CA');
const yesterday = () => new Date(Date.now() - DAY_MS).toLocaleDateString('en-CA');

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: AnswerValidatorService,
    private readonly achievements: AchievementsService,
    private readonly challenges: ChallengesService,
    private readonly vocabulary: VocabularyService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async answerExercise(userId: string, exerciseId: string, dto: SubmitAnswerDto) {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { options: true, lesson: { include: { unit: { include: { course: true } } } } },
    });
    if (!exercise) throw new NotFoundException('Ejercicio no encontrado.');

    const course = exercise.lesson.unit.course;
    const mode = dto.mode ?? 'lesson';
    const result = this.validator.validate(exercise, dto);
    const isPro = await this.subscriptions.isPro(userId);

    return this.prisma.$transaction(async (tx) => {
      await this.getOrCreateStats(tx, userId);

      const existingEp = await tx.exerciseProgress.findUnique({
        where: { userId_exerciseId: { userId, exerciseId } },
      });
      await tx.exerciseProgress.upsert({
        where: { userId_exerciseId: { userId, exerciseId } },
        update: {
          attempts: (existingEp?.attempts ?? 0) + 1,
          correctAnswers: (existingEp?.correctAnswers ?? 0) + (result.correct ? 1 : 0),
          mistakes: (existingEp?.mistakes ?? 0) + (result.correct ? 0 : 1),
          completed: (existingEp?.completed ?? false) || result.correct,
          lastAttemptAt: new Date(),
        },
        create: {
          userId,
          exerciseId,
          attempts: 1,
          correctAnswers: result.correct ? 1 : 0,
          mistakes: result.correct ? 0 : 1,
          completed: result.correct,
        },
      });

      let xpAwarded = 0;
      let hearts: number;

      if (result.correct) {
        const base = course.type === 'PROGRAMMING' ? REWARDS.exerciseCode : REWARDS.exerciseLang;
        const amount = isPro ? base * 2 : base;
        const awarded = await this.awardXp(tx, userId, amount, 'EXERCISE_CORRECT', exercise.lessonId);
        xpAwarded = amount;
        hearts = awarded.hearts;
      } else if (mode === 'lesson' && !isPro) {
        const stats = await tx.userStats.findUniqueOrThrow({ where: { userId } });
        if (stats.hearts > 0) {
          const updated = await tx.userStats.update({ where: { userId }, data: { hearts: { decrement: 1 } } });
          hearts = updated.hearts;
        } else {
          hearts = 0;
        }
      } else {
        hearts = (await tx.userStats.findUniqueOrThrow({ where: { userId } })).hearts;
      }

      if (course.type === 'LANGUAGE') {
        for (const word of this.validator.vocabWordsFor(exercise)) {
          await this.updateVocabReview(tx, userId, course.id, word, result.correct);
        }
      }

      return {
        correct: result.correct,
        message: result.message ?? exercise.explanation ?? null,
        xpAwarded,
        hearts,
      };
    });
  }

  async completeLesson(userId: string, lessonKey: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { key: lessonKey },
      include: { exercises: true, unit: { include: { course: true } } },
    });
    if (!lesson) throw new NotFoundException(`Lección "${lessonKey}" no encontrada.`);
    if (lesson.exercises.length === 0) {
      throw new BadRequestException('Esta lección no tiene ejercicios.');
    }
    const course = lesson.unit.course;

    const orderedLessonIds = await this.getOrderedLessonIds(course.id);
    const idx = orderedLessonIds.indexOf(lesson.id);
    if (idx > 0) {
      const prev = await this.prisma.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId: orderedLessonIds[idx - 1] } },
      });
      if (!prev?.completed) {
        throw new ForbiddenException('Completa la lección anterior primero.');
      }
    }

    const progressRows = await this.prisma.exerciseProgress.findMany({
      where: { userId, exerciseId: { in: lesson.exercises.map((e) => e.id) } },
    });
    if (progressRows.length < lesson.exercises.length) {
      throw new BadRequestException('Debes responder todos los ejercicios de la lección antes de completarla.');
    }
    const sumAttempts = progressRows.reduce((n, p) => n + p.attempts, 0);
    const sumCorrect = progressRows.reduce((n, p) => n + p.correctAnswers, 0);
    const accuracy = sumAttempts > 0 ? Math.round((100 * sumCorrect) / sumAttempts) : 0;
    const perfect = progressRows.every((p) => p.mistakes === 0);

    return this.prisma.$transaction(async (tx) => {
      await this.getOrCreateStats(tx, userId);
      const existingLp = await tx.lessonProgress.findUnique({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
      });
      const alreadyCompleted = existingLp?.completed ?? false;

      const bonusXp = lesson.isProject
        ? REWARDS.project
        : course.type === 'PROGRAMMING'
          ? REWARDS.lessonCode
          : REWARDS.lessonLang;
      let gemsAwarded = alreadyCompleted ? 0 : REWARDS.baseGems + (perfect ? REWARDS.perfectGemsBonus : 0);
      let totalXp = 0;

      if (!alreadyCompleted) {
        await this.awardXp(tx, userId, bonusXp, lesson.isProject ? 'PROJECT_COMPLETE' : 'LESSON_COMPLETE', lesson.id);
        totalXp += bonusXp;
        if (gemsAwarded > 0) {
          await tx.userStats.update({ where: { userId }, data: { gems: { increment: gemsAwarded } } });
        }
      }

      await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
        update: {
          completed: true,
          accuracy,
          perfect,
          attemptsCount: { increment: 1 },
          xpEarned: { increment: alreadyCompleted ? 0 : bonusXp },
          completedAt: existingLp?.completedAt ?? new Date(),
          lastAttemptAt: new Date(),
        },
        create: {
          userId,
          lessonId: lesson.id,
          completed: true,
          accuracy,
          perfect,
          attemptsCount: 1,
          xpEarned: bonusXp,
          completedAt: new Date(),
          lastAttemptAt: new Date(),
        },
      });

      if (!alreadyCompleted) {
        const unitLessons = await tx.lesson.findMany({ where: { unitId: lesson.unitId }, select: { id: true } });
        const unitDone = await tx.lessonProgress.count({
          where: { userId, lessonId: { in: unitLessons.map((l) => l.id) }, completed: true },
        });
        if (unitDone === unitLessons.length) {
          const unitBonus = course.type === 'LANGUAGE' ? REWARDS.unit : REWARDS.module;
          await this.awardXp(tx, userId, unitBonus, 'MODULE_COMPLETE', lesson.id);
          totalXp += unitBonus;
        }

        const courseLessons = await tx.lesson.findMany({
          where: { unit: { courseId: course.id } },
          select: { id: true },
        });
        const courseDone = await tx.lessonProgress.count({
          where: { userId, lessonId: { in: courseLessons.map((l) => l.id) }, completed: true },
        });
        if (courseDone === courseLessons.length) {
          await this.awardXp(tx, userId, REWARDS.course, 'COURSE_COMPLETE', lesson.id);
          totalXp += REWARDS.course;
        }

        const percentComplete = Math.round((100 * courseDone) / courseLessons.length);
        const existingCp = await tx.userCourseProgress.findUnique({
          where: { userId_courseId: { userId, courseId: course.id } },
        });
        await tx.userCourseProgress.upsert({
          where: { userId_courseId: { userId, courseId: course.id } },
          update: {
            percentComplete,
            lessonsCompleted: courseDone,
            lastActivityAt: new Date(),
            completedAt: percentComplete === 100 ? (existingCp?.completedAt ?? new Date()) : null,
          },
          create: {
            userId,
            courseId: course.id,
            percentComplete,
            lessonsCompleted: courseDone,
            lastActivityAt: new Date(),
            completedAt: percentComplete === 100 ? new Date() : null,
          },
        });

        const { dailyFirstAwarded } = await this.updateStreak(tx, userId);
        if (dailyFirstAwarded) {
          await this.awardXp(tx, userId, REWARDS.dailyFirst, 'DAILY_FIRST', lesson.id);
          totalXp += REWARDS.dailyFirst;
        }
      }

      // Achievements and daily challenges are checked every time a lesson
      // is completed (never trusting a client-reported unlock), inside the
      // same transaction so they see the just-updated progress/XP/streak.
      const achievementsUnlocked = await this.achievements.checkAndUnlock(tx, userId);
      for (const a of achievementsUnlocked) totalXp += a.xp;

      const challengesCompleted = await this.challenges.checkAndClaim(tx, userId);
      for (const c of challengesCompleted) {
        totalXp += c.xp;
        gemsAwarded += c.gems;
      }

      const finalStats = await tx.userStats.findUniqueOrThrow({ where: { userId } });
      const finalStreak = await tx.streak.findUnique({ where: { userId } });
      const finalCp = await tx.userCourseProgress.findUnique({
        where: { userId_courseId: { userId, courseId: course.id } },
      });

      return {
        success: true,
        lesson: { key: lesson.key, completed: true },
        rewards: { xp: totalXp, gems: gemsAwarded },
        stats: { xp: finalStats.xp, level: finalStats.level, streak: finalStreak?.current ?? 0 },
        courseProgress: { progressPct: finalCp?.percentComplete ?? 0 },
        achievementsUnlocked,
        challengesCompleted,
      };
    });
  }

  private async getOrCreateStats(tx: Tx, userId: string) {
    const existing = await tx.userStats.findUnique({ where: { userId } });
    if (existing) return existing;
    return tx.userStats.create({ data: { userId } });
  }

  /** Creates the XP ledger entry, bumps UserStats.xp/level, returns the fresh totals. */
  private async awardXp(tx: Tx, userId: string, amount: number, reason: string, lessonId?: string) {
    if (amount > 0) {
      await tx.xPTransaction.create({
        data: { userId, amount, reason: reason as never, lessonId },
      });
    }
    const stats = await tx.userStats.update({
      where: { userId },
      data: amount > 0 ? { xp: { increment: amount } } : {},
    });
    const level = levelIndexForXp(stats.xp) + 1;
    if (level !== stats.level) {
      await tx.userStats.update({ where: { userId }, data: { level } });
    }
    return { xp: stats.xp, level, hearts: stats.hearts };
  }

  private async getOrderedLessonIds(courseId: string): Promise<string[]> {
    const units = await this.prisma.unit.findMany({
      where: { courseId },
      orderBy: { order: 'asc' },
      include: { lessons: { orderBy: { order: 'asc' }, select: { id: true } } },
    });
    return units.flatMap((u) => u.lessons.map((l) => l.id));
  }

  private async updateStreak(tx: Tx, userId: string): Promise<{ dailyFirstAwarded: boolean }> {
    const streak = await tx.streak.upsert({ where: { userId }, update: {}, create: { userId } });
    const t = today();
    if (streak.lastActiveDate === t) return { dailyFirstAwarded: false };

    const newCurrent = streak.lastActiveDate === yesterday() ? streak.current + 1 : 1;
    const dailyFirstAwarded = streak.lastActiveDate !== null;
    await tx.streak.update({
      where: { userId },
      data: { current: newCurrent, best: Math.max(streak.best, newCurrent), lastActiveDate: t },
    });
    return { dailyFirstAwarded };
  }

  // The actual SRS math lives in VocabularyService.applyResult — shared with
  // the standalone review flow (POST /vocabulary/:id/review) so there's one
  // formula, not two that could quietly drift apart. This just finds the
  // vocab row by course+word, the shape an Exercise's content gives us.
  private async updateVocabReview(tx: Tx, userId: string, courseId: string, word: string, correct: boolean) {
    const vocab = await this.vocabulary.findByCourseAndWord(tx, courseId, word);
    if (!vocab) return;
    await this.vocabulary.applyResult(tx, userId, vocab.id, correct);
  }
}
