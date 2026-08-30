import type { SuperpowerId, WeaponId } from '../game/types';
import { storageGet, storageSet } from './storage';

const SAVE_KEY = 'captainWindel.save.v1';

export interface SaveData {
  highScore: number;
  highestLevelReached: number; // highest unlocked/beaten level, campaign
  highestCombo: number;
  bossesDefeated: string[];
  totalKills: number;
  unlockedWeapons: WeaponId[];
  unlockedSuperpowers: SuperpowerId[];
  equippedSuperpowerSlots: (SuperpowerId | null)[];
  longestChaosRun: number;
  // Section 10 (3-lives quality update): which bonus-throwable-weapon
  // milestone levels have already been granted this run, so re-entering a
  // level doesn't re-grant it. Reset alongside the rest of a run's
  // progress on a full Game Over (see appStore.finishRun).
  bonusWeaponMilestonesClaimed: number[];
  // Humorous effects pass: separate one-time milestone tracking for the
  // "Storch & Baby" diaper-bomb bonus weapon — its own late-campaign
  // milestone list, independent of the bonus-bomb one above. Also reset on
  // a full Game Over.
  storkBonusMilestonesClaimed: number[];
  settings: {
    soundOn: boolean;
    musicOn: boolean;
    vibrationOn: boolean;
    reducedEffects: boolean;
  };
  tutorialSeen: boolean;
}

export function defaultSaveData(): SaveData {
  return {
    highScore: 0,
    highestLevelReached: 1,
    highestCombo: 0,
    bossesDefeated: [],
    totalKills: 0,
    unlockedWeapons: ['fists'],
    unlockedSuperpowers: [],
    equippedSuperpowerSlots: [null, null, null],
    longestChaosRun: 0,
    bonusWeaponMilestonesClaimed: [],
    storkBonusMilestonesClaimed: [],
    settings: {
      soundOn: true,
      musicOn: true,
      vibrationOn: true,
      reducedEffects: false,
    },
    tutorialSeen: false,
  };
}

export function loadSaveData(): SaveData {
  const raw = storageGet(SAVE_KEY);
  if (!raw) return defaultSaveData();
  try {
    const parsed = JSON.parse(raw);
    return { ...defaultSaveData(), ...parsed, settings: { ...defaultSaveData().settings, ...parsed.settings } };
  } catch {
    return defaultSaveData();
  }
}

export function saveSaveData(data: SaveData): void {
  try {
    storageSet(SAVE_KEY, JSON.stringify(data));
  } catch {
    // storage layer already falls back to memory; nothing else to do
  }
}
