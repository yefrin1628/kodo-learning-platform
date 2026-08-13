import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@kodo/database';
import { PrismaService } from '../prisma/prisma.service';
import { normalize } from '../learning/answer-validator.service';
import { SRS_INTERVAL_DAYS } from '../learning/constants';

type Tx = Prisma.TransactionClient;
type Client = PrismaService | Tx;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface VocabWordDto {
  vocabularyId: string;
  word: string;
  translation: string;
  emoji: string | null;
  audioLang: string | null;
  mastery: number;
  seen: number;
  mistakes: number;
  correctAnswers: number;
  lastReviewed: Date | null;
  nextReview: Date | null;
}

/**
 * Single source of truth for the SRS math (mastery/seen/mistakes/
 * nextReview) — used both here (the standalone review flow) and by
 * learning.service.ts (the passive update when a LISTEN/MATCH exercise in a
 * real lesson happens to touch a vocab word), so there's exactly one place
 * that computes it, not two copies that could drift apart.
 */
@Injectable()
export class VocabularyService {
  constructor(private readonly prisma: PrismaService) {}

  async listForCourse(userId: string, courseSlug: string): Promise<VocabWordDto[]> {
    const course = await this.prisma.course.findUnique({ where: { slug: courseSlug } });
    if (!course) throw new NotFoundException(`Curso "${courseSlug}" no encontrado.`);

    const words = await this.prisma.vocabulary.findMany({
      where: { courseId: course.id },
      include: { reviews: { where: { userId } } },
      orderBy: { createdAt: 'asc' },
    });

    return words.map((w) => {
      const r = w.reviews[0];
      return {
        vocabularyId: w.id,
        word: w.word,
        translation: w.translation,
        emoji: w.emoji,
        audioLang: w.audioLang,
        mastery: r?.mastery ?? 0,
        seen: r?.seen ?? 0,
        mistakes: r?.mistakes ?? 0,
        correctAnswers: r?.correctAnswers ?? 0,
        lastReviewed: r?.lastReviewed ?? null,
        nextReview: r?.nextReview ?? null,
      };
    });
  }

  /** Standalone review session (SRS practice), decoupled from any Lesson/Exercise. */
  async submitReview(userId: string, vocabularyId: string, answer: string) {
    const vocab = await this.prisma.vocabulary.findUnique({ where: { id: vocabularyId } });
    if (!vocab) throw new NotFoundException('Palabra no encontrada.');

    const correct = normalize(answer) === normalize(vocab.translation);
    const review = await this.prisma.$transaction((tx) => this.applyResult(tx, userId, vocab.id, correct));

    return {
      correct,
      mastery: review.mastery,
      seen: review.seen,
      mistakes: review.mistakes,
      correctAnswers: review.correctAnswers,
      nextReview: review.nextReview,
    };
  }

  /** The actual upsert — same formula for both callers, correctness already decided by the caller. */
  async applyResult(client: Client, userId: string, vocabularyId: string, correct: boolean) {
    const existing = await client.vocabularyReview.findUnique({
      where: { userId_vocabularyId: { userId, vocabularyId } },
    });
    const mastery = existing?.mastery ?? 0;
    const newMastery = correct ? Math.min(5, mastery + 1) : Math.max(0, mastery - 1);
    const seen = (existing?.seen ?? 0) + 1;
    const correctAnswers = (existing?.correctAnswers ?? 0) + (correct ? 1 : 0);
    const mistakes = correct ? Math.max(0, (existing?.mistakes ?? 0) - 1) : (existing?.mistakes ?? 0) + 1;
    const nextReview = correct ? new Date(Date.now() + SRS_INTERVAL_DAYS[newMastery] * DAY_MS) : new Date();

    return client.vocabularyReview.upsert({
      where: { userId_vocabularyId: { userId, vocabularyId } },
      update: { mastery: newMastery, seen, correctAnswers, mistakes, lastReviewed: new Date(), nextReview },
      create: {
        userId,
        vocabularyId,
        mastery: newMastery,
        seen,
        correctAnswers,
        mistakes,
        lastReviewed: new Date(),
        nextReview,
      },
    });
  }

  /** Looks up a word by course+text (the shape learning.service.ts already has from an Exercise's content). */
  async findByCourseAndWord(client: Client, courseId: string, word: string) {
    return client.vocabulary.findFirst({ where: { courseId, word: { equals: word, mode: 'insensitive' } } });
  }
}
