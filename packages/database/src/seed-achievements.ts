/**
 * Seeds the Achievement and Challenge catalogs.
 *
 * Achievement metadata (key/name/description/icon) is extracted straight
 * from index.html's ACHS array, same technique as import-content.ts, so the
 * catalog stays word-for-word identical to what the frontend already
 * defines. The `test()` closures in ACHS reference frontend-only state
 * (localStorage's U object) and can't run here — the actual unlock
 * conditions are reimplemented natively against Postgres in
 * achievements.service.ts. rewardXp is assigned here by tier, since the
 * frontend never granted XP for achievements (just a celebration modal).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { prisma } from './client';

const ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(ROOT, 'index.html');

interface FrontendAchievement {
  id: string;
  ic: string;
  name: string;
  desc: string;
}

function loadAchievements(): FrontendAchievement[] {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const openEnd = html.indexOf('\n', html.indexOf('<script>')) + 1;
  const closeIdx = html.lastIndexOf('</script>');
  let scriptSrc = html.slice(openEnd, closeIdx);
  for (const name of ['COURSES', 'LESSONS', 'VOCAB', 'VOCLANG', 'ACHS']) {
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
  return sandbox.ACHS as FrontendAchievement[];
}

// "First X" achievements: 50 XP. Numeric milestones: 75 XP.
// Course/language mastery: 150 XP.
const TIER: Record<string, number> = {
  'first-lesson': 50,
  'first-streak': 50,
  'first-code': 50,
  'first-unit': 50,
  'first-course': 75,
  'streak7': 75,
  'xp100': 75,
  'xp500': 75,
  'lessons10': 75,
  'words100': 75,
  'words500': 100,
  'second-lang': 75,
  'proj3': 75,
  'a1-en': 100,
  'js-master': 150,
  'html-master': 150,
  'css-master': 150,
  'fr-a1': 100,
  'fr-a2': 150,
  'pt-a1': 100,
  'pt-a2': 150,
  'fr-words500': 100,
  'pt-words500': 100,
};

const CHALLENGES = [
  { key: 'ch-lessons3', title: 'Completa 3 lecciones hoy', icon: '📚', metric: 'lessons_completed', goal: 3, rewardXp: 50, rewardGems: 0 },
  { key: 'ch-xp100', title: 'Gana 100 XP hoy', icon: '⭐', metric: 'xp_earned', goal: 100, rewardXp: 0, rewardGems: 30 },
  { key: 'ch-exercises20', title: 'Responde 20 ejercicios', icon: '🧩', metric: 'exercises_answered', goal: 20, rewardXp: 40, rewardGems: 0 },
  { key: 'ch-streak', title: 'Mantén tu racha activa', icon: '🔥', metric: 'streak_maintained', goal: 1, rewardXp: 0, rewardGems: 15 },
] as const;

async function main() {
  const achievements = loadAchievements();
  for (const a of achievements) {
    await prisma.achievement.upsert({
      where: { key: a.id },
      update: { name: a.name, description: a.desc, icon: a.ic, rewardXp: TIER[a.id] ?? 50 },
      create: { key: a.id, name: a.name, description: a.desc, icon: a.ic, rewardXp: TIER[a.id] ?? 50 },
    });
  }
  console.log(`Achievements seeded: ${achievements.length}`);

  for (const c of CHALLENGES) {
    await prisma.challenge.upsert({
      where: { key: c.key },
      update: { title: c.title, icon: c.icon, metric: c.metric, goal: c.goal, rewardXp: c.rewardXp, rewardGems: c.rewardGems },
      create: { key: c.key, title: c.title, icon: c.icon, metric: c.metric, goal: c.goal, rewardXp: c.rewardXp, rewardGems: c.rewardGems },
    });
  }
  console.log(`Challenges seeded: ${CHALLENGES.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
