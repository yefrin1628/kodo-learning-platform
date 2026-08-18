import { Injectable } from '@nestjs/common';
import { Exercise, ExerciseOption } from '@kodo/database';
import { SubmitAnswerDto } from './dto/submit-answer.dto';
import { ExecutionService } from '../execution/execution.service';

export interface ValidationResult {
  correct: boolean;
  message?: string;
  // What to show the student after they've already submitted this attempt —
  // never sent anywhere before an answer exists for it. correctIndex is the
  // option `order` for the 7 option-based types (TRUE_FALSE included: 0/1
  // like any other option); correctAnswer is a human-readable string for the
  // free-text types. MATCH/RUN/SPEAK have no reveal (see callers).
  correctIndex?: number;
  correctAnswer?: string;
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type ExerciseWithOptions = Exercise & { options: ExerciseOption[] };

@Injectable()
export class AnswerValidatorService {
  constructor(private readonly execution: ExecutionService) {}

  async validate(exercise: ExerciseWithOptions, dto: SubmitAnswerDto, userId: string): Promise<ValidationResult> {
    const content = (exercise.content ?? {}) as Record<string, unknown>;

    switch (exercise.type) {
      case 'CHOICE':
      case 'TRUE_FALSE':
      case 'FILL':
      case 'BUG':
      case 'LISTEN':
      case 'PREDICT':
      case 'CONVO': {
        const correctOpt = exercise.options.find((o) => o.isCorrect);
        if (dto.selectedIndex === undefined) {
          return { correct: false, message: 'Falta seleccionar una opción.', correctIndex: correctOpt?.order };
        }
        const opt = exercise.options.find((o) => o.order === dto.selectedIndex);
        return { correct: !!opt?.isCorrect, correctIndex: correctOpt?.order };
      }

      case 'TYPE_ANSWER': {
        const acc = (content.acc as string[] | undefined) ?? [];
        const value = normalize(dto.text ?? '');
        return { correct: acc.some((a) => normalize(a) === value), correctAnswer: acc[0] };
      }

      case 'TRANSLATE': {
        const expected = String(content.ans ?? '').trim();
        return { correct: (dto.text ?? '').trim() === expected, correctAnswer: expected };
      }

      case 'ORDER': {
        const words = (content.w as string[] | undefined) ?? [];
        const expected = words.join(' ').trim();
        return { correct: (dto.text ?? '').trim() === expected, correctAnswer: expected };
      }

      case 'MATCH': {
        const pairs = (content.pairs as [string, string][] | undefined) ?? [];
        const submitted = dto.pairs ?? [];
        if (submitted.length !== pairs.length) return { correct: false };
        const ok = pairs.every(([l, r]) =>
          submitted.some(
            (s) => normalize(s.left) === normalize(l) && normalize(s.right) === normalize(r),
          ),
        );
        return { correct: ok };
      }

      case 'RUN': {
        const code = dto.code ?? '';
        if (!code.trim()) return { correct: false, message: 'Escribe algo de código primero.' };
        const result = await this.execution.run(userId, code);
        if (result.timeout) {
          return { correct: false, message: 'Tiempo agotado: revisa posibles bucles infinitos.' };
        }
        if (result.error) {
          return { correct: false, message: `Error en tu código: ${result.error}` };
        }
        const must = (content.must as string[] | undefined) ?? [];
        for (const m of must) {
          if (!code.includes(m)) return { correct: false, message: `Tu código debe incluir: ${m}` };
        }
        const expect = (content.expect as string[] | undefined) ?? [];
        const lines = result.out.map((l) => l.trim().toLowerCase());
        for (const exp of expect) {
          if (!lines.includes(String(exp).trim().toLowerCase())) {
            return { correct: false, message: `La consola debe imprimir: "${exp}"` };
          }
        }
        return { correct: true };
      }

      case 'SPEAK':
        // Practice-only by original design: pronunciation isn't graded for
        // XP, the frontend always resolved this as "correct" too.
        return { correct: true };

      default:
        return { correct: false, message: 'Tipo de ejercicio no soportado.' };
    }
  }

  /**
   * Vocabulary words this answer touches, for SRS updates (language courses
   * only). One answer teaches one word by default — `content.word` is the
   * canonical SRS-tracked word, and other fields are only used as a
   * fallback when it's absent, not stacked on top of it. (The original
   * frontend pushed both `word` and `w` for `listen` exercises, which
   * double-counted mastery per answer; the backend is now the source of
   * truth, so this is deliberately not replicated.)
   */
  vocabWordsFor(exercise: Exercise): string[] {
    const content = (exercise.content ?? {}) as Record<string, unknown>;
    const words: string[] = [];
    if (typeof content.word === 'string') {
      words.push(content.word);
    } else if (exercise.type === 'LISTEN' && typeof content.w === 'string') {
      words.push(content.w);
    }
    if (exercise.type === 'MATCH' && Array.isArray(content.pairs)) {
      for (const p of content.pairs as [string, string][]) words.push(p[0]);
    }
    return [...new Set(words.map((w) => w.toLowerCase()))];
  }
}
