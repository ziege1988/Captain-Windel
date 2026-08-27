import { create } from 'zustand';
import type { SuperpowerId, WeaponId } from '../game/types';
import { loadSaveData, saveSaveData, type SaveData } from '../storage/saveData';
import { getUnlockedSuperpowers } from '../data/superpowers';

export type ScreenId =
  | 'mainMenu'
  | 'game'
  | 'equipment'
  | 'superpowers'
  | 'highscore'
  | 'options'
  | 'gameOver'
  | 'campaignComplete';

export interface RunSummary {
  score: number;
  levelReached: number;
  enemiesDefeated: number;
  bossesDefeated: number;
  highestCombo: number;
  chaosMode: boolean;
}

interface AppState {
  screen: ScreenId;
  save: SaveData;
  lastRunSummary: RunSummary | null;
  startFromLevel: number;
  runId: number;
  setScreen: (screen: ScreenId) => void;
  startNewRun: () => void;
  continueRun: () => void;
  finishRun: (summary: RunSummary) => void;
  unlockWeapon: (id: WeaponId) => void;
  recordKill: (bossId?: string) => void;
  setSuperpowerSlot: (slot: number, id: SuperpowerId | null) => void;
  updateSettings: (partial: Partial<SaveData['settings']>) => void;
  markTutorialSeen: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'mainMenu',
  save: loadSaveData(),
  lastRunSummary: null,
  startFromLevel: 1,
  runId: 0,

  setScreen: (screen) => set({ screen }),

  startNewRun: () => set((s) => ({ screen: 'game', startFromLevel: 1, runId: s.runId + 1 })),

  continueRun: () => {
    const level = get().save.highestLevelReached;
    set((s) => ({ screen: 'game', startFromLevel: level, runId: s.runId + 1 }));
  },

  finishRun: (summary) => {
    const save = { ...get().save };
    save.highScore = Math.max(save.highScore, summary.score);
    save.highestLevelReached = Math.max(save.highestLevelReached, summary.levelReached);
    save.highestCombo = Math.max(save.highestCombo, summary.highestCombo);
    if (summary.chaosMode) {
      save.longestChaosRun = Math.max(save.longestChaosRun, summary.levelReached - 50);
    }
    saveSaveData(save);
    set({ save, lastRunSummary: summary, screen: 'gameOver' });
  },

  unlockWeapon: (id) => {
    const save = { ...get().save };
    if (!save.unlockedWeapons.includes(id)) {
      save.unlockedWeapons = [...save.unlockedWeapons, id];
      saveSaveData(save);
      set({ save });
    }
  },

  recordKill: (bossId) => {
    const save = { ...get().save };
    save.totalKills += 1;
    if (bossId && !save.bossesDefeated.includes(bossId)) {
      save.bossesDefeated = [...save.bossesDefeated, bossId];
    }
    const unlocked = getUnlockedSuperpowers(save.totalKills);
    const newlyUnlocked = unlocked.filter((id) => !save.unlockedSuperpowers.includes(id));
    if (newlyUnlocked.length > 0) {
      save.unlockedSuperpowers = unlocked;
      const slots = [...save.equippedSuperpowerSlots];
      for (const id of newlyUnlocked) {
        const freeIdx = slots.findIndex((s) => s === null);
        if (freeIdx !== -1) slots[freeIdx] = id;
      }
      save.equippedSuperpowerSlots = slots;
    }
    saveSaveData(save);
    set({ save });
  },

  setSuperpowerSlot: (slot, id) => {
    const save = { ...get().save };
    const slots = [...save.equippedSuperpowerSlots];
    slots[slot] = id;
    save.equippedSuperpowerSlots = slots;
    saveSaveData(save);
    set({ save });
  },

  updateSettings: (partial) => {
    const save = { ...get().save };
    save.settings = { ...save.settings, ...partial };
    saveSaveData(save);
    set({ save });
  },

  markTutorialSeen: () => {
    const save = { ...get().save };
    save.tutorialSeen = true;
    saveSaveData(save);
    set({ save });
  },
}));
