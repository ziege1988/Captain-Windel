import type { SuperpowerDef, SuperpowerId } from '../game/types';
import { BOSS_ORDER } from './bosses';

// Reward-pacing pass (points 30-34): special abilities are now a curated,
// PERMANENT progression layer — a handful of genuinely distinct "Fürze"
// gated behind real boss-defeat milestones instead of a run-scoped kill
// counter, so a boss fight itself is the moment that earns the reward (see
// appStore.recordKill/finishRun and SuperpowerDef.unlockAfterBossIndex).
// Damage rebalance pass (point 6): a special ability must clearly read as
// "that did real damage" — noticeably more than a normal hit or even a
// strong weapon swing — while still leaving a normal enemy able to keep
// fighting afterward (never a one-shot kill).
export const SUPERPOWERS: Record<SuperpowerId, SuperpowerDef> = {
  gasCloud: {
    id: 'gasCloud',
    name: 'Gaswolken-Furz',
    icon: '☁️',
    description: 'Große Stinkwolke schwächt und verlangsamt den Gegner.',
    unlockAfterBossIndex: -1,
    cooldownMs: 14000,
    damage: 22,
    effectDurationMs: 3500,
    color: '#8bc34a',
  },
  tornado: {
    id: 'tornado',
    name: 'Wirbelwind-Furz',
    icon: '🌪️',
    description: 'Ein kleiner Tornado packt den Gegner, wirbelt ihn durch die Luft und wirft ihn zu Boden.',
    unlockAfterBossIndex: 0,
    // Follow-up balance pass: noticeably more impactful than the other
    // Fürze (full-field sweep + real lift/spin/fall), so it earns a longer
    // charge time to match — clearly above electro/ice/chili/gasCloud, just
    // short of nuclear's even longer, even-higher-damage cooldown.
    cooldownMs: 30000,
    damage: 30,
    effectDurationMs: 1400,
    color: '#90a4ae',
  },
  chili: {
    id: 'chili',
    name: 'Chili-Furz',
    icon: '🌶️',
    description: 'Feuerstoß verursacht hohen Schaden über Zeit.',
    unlockAfterBossIndex: 1,
    cooldownMs: 16000,
    damage: 26,
    effectDurationMs: 4000,
    color: '#e64a19',
  },
  ice: {
    id: 'ice',
    name: 'Schnee-Kanonen-Furz',
    icon: '❄️',
    description: 'Begräbt den Gegner unter einem Schneehaufen und friert ihn kurz ein.',
    unlockAfterBossIndex: 2,
    cooldownMs: 18000,
    damage: 20,
    effectDurationMs: 2600,
    color: '#4fc3f7',
  },
  electro: {
    id: 'electro',
    name: 'Blitz-Furz',
    icon: '⚡',
    description: 'Lähmt den Gegner kurzzeitig mit einem Stromschlag.',
    unlockAfterBossIndex: 3,
    cooldownMs: 20000,
    damage: 32,
    effectDurationMs: 1800,
    color: '#ffeb3b',
  },
  poop: {
    id: 'poop',
    name: 'Kacken',
    icon: '💩',
    // Unlike every other power this one deals no direct damage at all: it
    // leaves a trap on the ground and pays off when the enemy walks into
    // it, so it rewards positioning rather than aim.
    description: 'Windelmann dreht sich um, geht in die Hocke und legt einen Haufen ab. Wer reintritt, rutscht aus.',
    unlockAfterBossIndex: 1,
    cooldownMs: 18000,
    damage: 12,
    effectDurationMs: 16000,
    color: '#795548',
  },
  nuclear: {
    id: 'nuclear',
    name: 'Druckwellen-Furz',
    icon: '💥',
    description: 'Gewaltige Druckwelle, sehr hoher Schaden. Selten einsetzbar.',
    unlockAfterBossIndex: 4,
    cooldownMs: 40000,
    damage: 48,
    effectDurationMs: 800,
    color: '#ab47bc',
  },
};

export const SUPERPOWER_LIST = Object.values(SUPERPOWERS);

/** Which boss (by name) unlocks a given ability, for display purposes —
 * null for the always-available starter ability. */
export function unlockBossName(def: SuperpowerDef): string | null {
  if (def.unlockAfterBossIndex < 0) return null;
  return BOSS_ORDER[def.unlockAfterBossIndex] ?? null;
}

/** Permanent unlock set derived from every boss ever defeated (lifetime,
 * never reset by a Game Over — see appStore) rather than from run-scoped
 * kill counts. */
export function getUnlockedSuperpowers(bossesDefeated: string[]): SuperpowerId[] {
  const defeatedIndices = new Set(
    bossesDefeated.map((id) => BOSS_ORDER.indexOf(id)).filter((i) => i >= 0),
  );
  return SUPERPOWER_LIST
    .filter((s) => s.unlockAfterBossIndex < 0 || defeatedIndices.has(s.unlockAfterBossIndex))
    .map((s) => s.id);
}
