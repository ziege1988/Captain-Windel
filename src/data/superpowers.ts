import type { SuperpowerDef, SuperpowerId } from '../game/types';

// Section 23-27: unlock thresholds are configurable balance data, not
// hardcoded logic. New "Fürze" can be added here plus one renderer entry in
// effects/superpowerEffects.ts — no engine changes required.
export const SUPERPOWERS: Record<SuperpowerId, SuperpowerDef> = {
  gasCloud: {
    id: 'gasCloud',
    name: 'Gaswolken-Furz',
    icon: '☁️',
    description: 'Große Gaswolke schwächt und verlangsamt Gegner.',
    unlockAtKills: 5,
    cooldownMs: 14000,
    damage: 12,
    effectDurationMs: 3500,
    color: '#8bc34a',
  },
  chili: {
    id: 'chili',
    name: 'Chili-Furz',
    icon: '🌶️',
    description: 'Feuerwelle verursacht Schaden über Zeit.',
    unlockAtKills: 10,
    cooldownMs: 16000,
    damage: 8,
    effectDurationMs: 4000,
    color: '#e64a19',
  },
  ice: {
    id: 'ice',
    name: 'Eis-Furz',
    icon: '🧊',
    description: 'Friert den Gegner kurz ein.',
    unlockAtKills: 20,
    cooldownMs: 18000,
    damage: 10,
    effectDurationMs: 2200,
    color: '#4fc3f7',
  },
  electro: {
    id: 'electro',
    name: 'Elektro-Furz',
    icon: '⚡',
    description: 'Lähmt den Gegner kurzzeitig.',
    unlockAtKills: 35,
    cooldownMs: 20000,
    damage: 18,
    effectDurationMs: 1800,
    color: '#ffeb3b',
  },
  tornado: {
    id: 'tornado',
    name: 'Tornado-Furz',
    icon: '🌪️',
    description: 'Schleudert den Gegner durch die Arena.',
    unlockAtKills: 50,
    cooldownMs: 22000,
    damage: 22,
    effectDurationMs: 1200,
    color: '#90a4ae',
  },
  nuclear: {
    id: 'nuclear',
    name: 'Nuklear-Furz',
    icon: '💥',
    description: 'Riesige Druckwelle, sehr hoher Schaden. Selten.',
    unlockAtKills: 100,
    cooldownMs: 40000,
    damage: 55,
    effectDurationMs: 800,
    color: '#ab47bc',
  },
};

export const SUPERPOWER_LIST = Object.values(SUPERPOWERS);

export function getUnlockedSuperpowers(totalKills: number): SuperpowerId[] {
  return SUPERPOWER_LIST.filter((s) => totalKills >= s.unlockAtKills).map((s) => s.id);
}
