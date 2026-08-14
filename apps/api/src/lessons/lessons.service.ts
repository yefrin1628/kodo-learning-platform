import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Strips whatever would let a client answer without doing the exercise:
 * ExerciseOption.isCorrect, and the type-specific "expected answer" field in
 * `content` (acc/ans for TYPE_ANSWER/TRANSLATE, w for ORDER — replaced with
 * a pre-shuffled `bank` so the word list is still there to build sentences
 * from, just not in the correct order). Everything else in `content` (code,
 * pairs, must/expect, word, extra, …) is render/SRS data, not an answer key,
 * and stays as-is. The real answer only ever reaches the client afterward,
 * in the answer-attempt response (see AnswerValidatorService).
 */
function sanitizeExercise<
  T extends { type: string; content: unknown; options: Array<{ isCorrect: boolean } & Record<string, unknown>> },
>(exercise: T) {
  const { options, content, ...rest } = exercise;
  const safeOptions = options.map(({ isCorrect: _isCorrect, ...o }) => o);

  let safeContent = (content ?? {}) as Record<string, unknown>;
  if (exercise.type === 'TYPE_ANSWER') {
    const { acc: _acc, ...restContent } = safeContent;
    safeContent = restContent;
  } else if (exercise.type === 'TRANSLATE' || exercise.type === 'ORDER') {
    // Both types drive the same tap-to-build word bank in the frontend
    // (LS.bank/LS.picks), built client-side from `w` + `extra`. `w` in its
    // stored order IS the answer (TRANSLATE's `w.join(' ')` is exactly
    // `ans`; ORDER has no separate `ans` at all) — stripping `ans` alone
    // isn't enough, the bank itself has to arrive pre-shuffled so the
    // correct order never touches the client.
    const { ans: _ans, w, extra, ...restContent } = safeContent;
    const bank = shuffle([...((w as string[]) ?? []), ...((extra as string[]) ?? [])]);
    safeContent = { ...restContent, bank };
  }

  return { ...rest, content: safeContent, options: safeOptions };
}

@Injectable()
export class LessonsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(key: string) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { key },
      include: {
        unit: { include: { course: { select: { slug: true, title: true, type: true, language: true } } } },
        project: true,
        exercises: {
          orderBy: { order: 'asc' },
          include: { options: { orderBy: { order: 'asc' } } },
        },
      },
    });
    if (!lesson) {
      throw new NotFoundException(`Lección "${key}" no encontrada.`);
    }
    return { ...lesson, exercises: lesson.exercises.map(sanitizeExercise) };
  }
}
