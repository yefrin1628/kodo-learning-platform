// Mirrors the reward/level tables that already exist in the frontend
// (index.html LEVELS / REW / SRS_DAYS), so the server-authoritative
// engine and the current prototype agree on what things are worth.

export const LEVELS: Array<[string, number]> = [
  ['Novato', 0],
  ['Explorador', 100],
  ['Aprendiz', 250],
  ['Constructor', 450],
  ['Creador', 700],
  ['Pro', 1000],
  ['Experto', 1400],
  ['Maestro', 1900],
  ['Mentor', 2500],
  ['Kodo Master', 3200],
];

export function levelIndexForXp(xp: number): number {
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k][1]) i = k;
  return i;
}

export const REWARDS = {
  exerciseCode: 10,
  exerciseLang: 6,
  lessonCode: 20,
  lessonLang: 15,
  unit: 75, // language courses
  module: 50, // programming courses
  project: 100,
  course: 500,
  perfectGemsBonus: 2,
  baseGems: 5,
  dailyFirst: 10,
} as const;

export const SRS_INTERVAL_DAYS = [0, 1, 3, 7, 16, 30];

export const HEARTS_REFILL_COST = 30;
export const MAX_HEARTS = 5;
