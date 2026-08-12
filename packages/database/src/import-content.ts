/**
 * Imports the course/lesson/exercise/vocabulary content that already lives
 * in the frontend prototype (Kodo/index.html) into Postgres via Prisma.
 *
 * This does NOT re-author content: it extracts the real COURSES/LESSONS/VOCAB
 * objects from index.html by running that script in an isolated VM context
 * (same technique used to verify Phase 3 content), then maps them 1:1 onto
 * the Prisma schema. Safe to re-run: every write is an upsert keyed by the
 * frontend's own ids, so re-importing after editing index.html updates
 * existing rows instead of duplicating them.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { prisma } from './client';

const ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(ROOT, 'index.html');

interface FrontendModule {
  id: string;
  title: string;
  emoji?: string;
  lessons: string[];
}
interface FrontendCourse {
  id: string;
  cat: 'code' | 'lang';
  name: string;
  desc: string;
  diff?: string;
  color?: string;
  flag?: string;
  modules: FrontendModule[];
}
interface FrontendExercise {
  t: string;
  d?: string;
  q: string;
  e?: string;
  o?: unknown[];
  a?: number | boolean;
  [key: string]: unknown;
}
interface FrontendLesson {
  title: string;
  icon?: string;
  lang?: string;
  proj?: boolean;
  intro?: { h?: string; p?: string; code?: string; say?: string };
  ex: FrontendExercise[];
}
interface FrontendVocabEntry {
  w: string;
  es: string;
  e?: string;
}

function loadFrontendData() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const openIdx = html.indexOf('<script>');
  const openEnd = html.indexOf('\n', openIdx) + 1;
  const closeIdx = html.lastIndexOf('</script>');
  let scriptSrc = html.slice(openEnd, closeIdx);
  // `const X = ...` at the top level of a vm context creates a lexical
  // binding, not a property on the sandbox object — rewrite just the four
  // declarations we need to read back out to `var` so they attach to the
  // context's global object and are reachable after execution.
  for (const name of ['COURSES', 'LESSONS', 'VOCAB', 'VOCLANG']) {
    scriptSrc = scriptSrc.replace(`const ${name}=`, `var ${name}=`);
  }

  const stubEl = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {},
    remove() {},
    setAttribute() {},
    querySelector: () => stubEl(),
    querySelectorAll: () => [],
    innerHTML: '',
    hidden: false,
  });
  const sandbox: Record<string, unknown> = {
    window: {},
    document: {
      addEventListener() {},
      querySelector: () => stubEl(),
      querySelectorAll: () => [],
      createElement: () => stubEl(),
      getElementById: () => null,
      body: stubEl(),
      documentElement: { style: { setProperty() {} } },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    speechSynthesis: { cancel() {}, speak() {} },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance() {},
    console,
    setInterval: () => 0,
    setTimeout: () => 0,
  };
  (sandbox.window as Record<string, unknown>).addEventListener = () => {};
  (sandbox.window as Record<string, unknown>).scrollTo = () => {};
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(scriptSrc, sandbox, { filename: 'index.html#script' });

  return {
    COURSES: sandbox.COURSES as FrontendCourse[],
    LESSONS: sandbox.LESSONS as Record<string, FrontendLesson>,
    VOCAB: sandbox.VOCAB as Record<string, FrontendVocabEntry[]>,
    VOCLANG: sandbox.VOCLANG as Record<string, string>,
  };
}

const TYPE_MAP: Record<string, string> = {
  choice: 'CHOICE',
  tf: 'TRUE_FALSE',
  fill: 'FILL',
  type: 'TYPE_ANSWER',
  order: 'ORDER',
  tr: 'TRANSLATE',
  predict: 'PREDICT',
  bug: 'BUG',
  run: 'RUN',
  listen: 'LISTEN',
  match: 'MATCH',
  speak: 'SPEAK',
  convo: 'CONVO',
};
const DIFF_MAP: Record<string, string> = {
  facil: 'FACIL',
  normal: 'NORMAL',
  dificil: 'DIFICIL',
  desafio: 'DESAFIO',
};
const HAS_OPTIONS = new Set(['choice', 'predict', 'fill', 'bug', 'listen', 'convo', 'tf']);

// `d` (difficulty tag) is intentionally kept in content, not just derived into
// the `difficulty` column: some exercises in the frontend set d:'normal'
// explicitly (which renders a "Normal" badge) while most omit `d` entirely
// (no badge). The `difficulty` enum column can't distinguish those two cases
// since both map to NORMAL — content.d is what the frontend adapter reads to
// reproduce the exact original badge behavior.
function exerciseContent(ex: FrontendExercise): Record<string, unknown> {
  const { t: _t, q: _q, e: _e, o: _o, a: _a, ...rest } = ex;
  return rest;
}

async function main() {
  const { COURSES, LESSONS, VOCAB, VOCLANG } = loadFrontendData();
  console.log(`Loaded from index.html: ${COURSES.length} courses, ${Object.keys(LESSONS).length} lessons`);

  let courseCount = 0;
  let unitCount = 0;
  let lessonCount = 0;
  let exerciseCount = 0;
  let optionCount = 0;
  let projectCount = 0;

  for (let ci = 0; ci < COURSES.length; ci++) {
    const c = COURSES[ci];
    const course = await prisma.course.upsert({
      where: { slug: c.id },
      update: {
        title: c.name,
        description: c.desc,
        type: c.cat === 'code' ? 'PROGRAMMING' : 'LANGUAGE',
        language: c.id,
        level: c.diff ?? null,
        colorHex: c.color ?? null,
        flagEmoji: c.flag ?? null,
        isPublished: true,
        order: ci,
      },
      create: {
        slug: c.id,
        title: c.name,
        description: c.desc,
        type: c.cat === 'code' ? 'PROGRAMMING' : 'LANGUAGE',
        language: c.id,
        level: c.diff ?? null,
        colorHex: c.color ?? null,
        flagEmoji: c.flag ?? null,
        isPublished: true,
        order: ci,
      },
    });
    courseCount++;

    for (let mi = 0; mi < c.modules.length; mi++) {
      const m = c.modules[mi];
      const unit = await prisma.unit.upsert({
        where: { courseId_key: { courseId: course.id, key: m.id } },
        update: { title: m.title, emoji: m.emoji ?? null, order: mi },
        create: { courseId: course.id, key: m.id, title: m.title, emoji: m.emoji ?? null, order: mi },
      });
      unitCount++;

      for (let li = 0; li < m.lessons.length; li++) {
        const lessonKey = m.lessons[li];
        const L = LESSONS[lessonKey];
        if (!L) {
          console.warn(`  ! Missing LESSONS entry for "${lessonKey}" (referenced by ${c.id}/${m.id})`);
          continue;
        }
        const baseXP = L.proj ? 100 : c.cat === 'code' ? 20 : 15;
        const lesson = await prisma.lesson.upsert({
          where: { key: lessonKey },
          update: {
            unitId: unit.id,
            title: L.title,
            icon: L.icon ?? null,
            order: li,
            isProject: !!L.proj,
            introHeading: L.intro?.h ?? null,
            introBody: L.intro?.p ?? null,
            introCode: L.intro?.code ?? null,
            introCodeLang: L.lang ?? null,
            introAudioText: L.intro?.say ?? null,
            baseXP,
          },
          create: {
            key: lessonKey,
            unitId: unit.id,
            title: L.title,
            icon: L.icon ?? null,
            order: li,
            isProject: !!L.proj,
            introHeading: L.intro?.h ?? null,
            introBody: L.intro?.p ?? null,
            introCode: L.intro?.code ?? null,
            introCodeLang: L.lang ?? null,
            introAudioText: L.intro?.say ?? null,
            baseXP,
          },
        });
        lessonCount++;

        if (L.proj) {
          await prisma.project.upsert({
            where: { lessonId: lesson.id },
            update: { rewardXP: 100 },
            create: { lessonId: lesson.id, rewardXP: 100 },
          });
          projectCount++;
        }

        for (let ei = 0; ei < L.ex.length; ei++) {
          const ex = L.ex[ei];
          const exercise = await prisma.exercise.upsert({
            where: { lessonId_order: { lessonId: lesson.id, order: ei } },
            update: {
              type: TYPE_MAP[ex.t] as never,
              difficulty: DIFF_MAP[ex.d ?? 'normal'] as never,
              prompt: ex.q ?? null,
              explanation: ex.e ?? null,
              content: exerciseContent(ex) as never,
            },
            create: {
              lessonId: lesson.id,
              order: ei,
              type: TYPE_MAP[ex.t] as never,
              difficulty: DIFF_MAP[ex.d ?? 'normal'] as never,
              prompt: ex.q ?? null,
              explanation: ex.e ?? null,
              content: exerciseContent(ex) as never,
            },
          });
          exerciseCount++;

          if (HAS_OPTIONS.has(ex.t)) {
            await prisma.exerciseOption.deleteMany({ where: { exerciseId: exercise.id } });
            const opts =
              ex.t === 'tf'
                ? [
                    { label: 'Verdadero', isCorrect: ex.a === true },
                    { label: 'Falso', isCorrect: ex.a === false },
                  ]
                : ((ex.o ?? []) as unknown[]).map((label, i) => ({
                    label: String(label),
                    isCorrect: i === ex.a,
                  }));
            if (opts.length) {
              await prisma.exerciseOption.createMany({
                data: opts.map((o, i) => ({ exerciseId: exercise.id, label: o.label, isCorrect: o.isCorrect, order: i })),
              });
              optionCount += opts.length;
            }
          }
        }
      }
    }

    const deck = VOCAB[c.id] ?? [];
    for (const v of deck) {
      await prisma.vocabulary.upsert({
        where: { courseId_word: { courseId: course.id, word: v.w } },
        update: { translation: v.es, emoji: v.e ?? null, audioLang: VOCLANG?.[c.id] ?? null },
        create: { courseId: course.id, word: v.w, translation: v.es, emoji: v.e ?? null, audioLang: VOCLANG?.[c.id] ?? null },
      });
    }

    console.log(`  [${c.id}] ${c.modules.length} unidades, ${m_lessonTotal(c)} lecciones, ${deck.length} palabras`);
  }

  console.log('---');
  console.log(
    `Importado: ${courseCount} cursos, ${unitCount} unidades, ${lessonCount} lecciones, ${projectCount} proyectos, ${exerciseCount} ejercicios, ${optionCount} opciones.`,
  );
}

function m_lessonTotal(c: FrontendCourse) {
  return c.modules.reduce((n, m) => n + m.lessons.length, 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
