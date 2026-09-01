import { create } from 'zustand';
import type { CapeColorId, CharacterId, SpecialWeaponId, SuperpowerId, WeaponId } from '../game/types';
import { defaultSaveData, loadSaveData, saveSaveData, type SaveData } from '../storage/saveData';
import { getUnlockedSuperpowers } from '../data/superpowers';
import { SPECIAL_WEAPONS } from '../data/specialWeapons';
import { CAPE_COLORS, CHARACTERS } from '../data/characters';

export type ScreenId =
  | 'mainMenu'
  | 'game'
  | 'equipment'
  | 'superpowers'
  | 'highscore'
  | 'options'
  | 'gameOver'
  | 'campaignComplete'
  | 'shop'
  | 'characterMenu';

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
  // Point 59: returns which superpower ids (if any) this kill newly
  // unlocked, so the caller (GameScreen) can show a real milestone
  // showcase instead of a generic victory toast.
  recordKill: (bossId?: string) => SuperpowerId[];
  setSuperpowerSlot: (slot: number, id: SuperpowerId | null) => void;
  updateSettings: (partial: Partial<SaveData['settings']>) => void;
  markTutorialSeen: () => void;
  claimBonusWeaponMilestone: (level: number) => void;
  claimStorkBonusMilestone: (level: number) => void;
  addCoins: (amount: number) => void;
  unlockSpecialWeapon: (id: SpecialWeaponId) => void;
  purchaseSpecialWeapon: (id: SpecialWeaponId) => boolean;
  setPendingSpecialWeapon: (id: SpecialWeaponId | null) => void;
  selectCharacter: (id: CharacterId) => void;
  purchaseCharacter: (id: CharacterId) => boolean;
  equipCapeColor: (id: CapeColorId) => void;
  purchaseCapeColor: (id: CapeColorId) => boolean;
  resetAllProgress: () => void;
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

  // Section 10 (3-lives quality update): reaching this screen now only
  // happens once every one of the player's 3 attempts is spent (see
  // GameEngine.handlePlayerDefeated — losing a life with attempts left
  // instead heals and retries the current level without ever touching the
  // store). So a real Game Over now resets the run's progress — unlocked
  // weapons/superpowers, the bonus-weapon milestones, kill count and
  // campaign level — back to a fresh level-1 start, while permanent
  // best-of-all-time stats (high score, best combo) are kept.
  finishRun: (summary) => {
    const save = { ...get().save };
    save.highScore = Math.max(save.highScore, summary.score);
    save.highestCombo = Math.max(save.highestCombo, summary.highestCombo);
    if (summary.chaosMode) {
      save.longestChaosRun = Math.max(save.longestChaosRun, summary.levelReached - 50);
    }
    save.highestLevelReached = 1;
    save.unlockedWeapons = ['fists'];
    save.totalKills = 0;
    save.bonusWeaponMilestonesClaimed = [];
    save.storkBonusMilestonesClaimed = [];
    // Persistent-progression pass: deliberately NOT touched here — coins
    // and unlockedSpecialWeapons are the whole point of a permanent
    // progression layer that survives a lost run (see section 15/17 of the
    // brief). Only actual shop purchases (purchaseSpecialWeapon) ever spend
    // coins. Character-system overhaul: selectedCharacter/unlockedCharacters/
    // equippedCapeColor/unlockedCapeColors are equally permanent cosmetic
    // progression — a Game Over never un-picks your hero or re-locks a
    // bought cape color. Reward-pacing pass (point 32): bossesDefeated/
    // unlockedSuperpowers/equippedSuperpowerSlots joined this permanent
    // layer too — a special ability earned from a boss is a real milestone
    // reward and must never be taken away by a later Game Over.
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
    let newlyUnlocked: SuperpowerId[] = [];
    if (bossId && !save.bossesDefeated.includes(bossId)) {
      save.bossesDefeated = [...save.bossesDefeated, bossId];
      // Reward-pacing pass (points 31/32): a new superpower is only ever
      // granted here, on an actual boss kill, and — unlike the old
      // kill-count gate — it's now permanent (see finishRun, which no
      // longer clears bossesDefeated/unlockedSuperpowers on Game Over).
      const unlocked = getUnlockedSuperpowers(save.bossesDefeated);
      newlyUnlocked = unlocked.filter((id) => !save.unlockedSuperpowers.includes(id));
      if (newlyUnlocked.length > 0) {
        save.unlockedSuperpowers = unlocked;
        const slots = [...save.equippedSuperpowerSlots];
        for (const id of newlyUnlocked) {
          const freeIdx = slots.findIndex((s) => s === null);
          if (freeIdx !== -1) slots[freeIdx] = id;
        }
        save.equippedSuperpowerSlots = slots;
      }
    }
    saveSaveData(save);
    set({ save });
    return newlyUnlocked;
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

  // Section 8 (quality update): called by GameEngine when a level with a
  // bonus-throwable-weapon milestone loads for the first time this run —
  // persisted immediately so re-entering the level (e.g. after a soft
  // life-loss respawn) doesn't grant a second one.
  claimBonusWeaponMilestone: (level) => {
    const save = { ...get().save };
    if (save.bonusWeaponMilestonesClaimed.includes(level)) return;
    save.bonusWeaponMilestonesClaimed = [...save.bonusWeaponMilestonesClaimed, level];
    saveSaveData(save);
    set({ save });
  },

  // Humorous effects pass: same one-time-grant pattern as
  // claimBonusWeaponMilestone above, for the separate "Storch & Baby"
  // diaper-bomb bonus weapon's own late-campaign milestone list.
  claimStorkBonusMilestone: (level) => {
    const save = { ...get().save };
    if (save.storkBonusMilestonesClaimed.includes(level)) return;
    save.storkBonusMilestonesClaimed = [...save.storkBonusMilestonesClaimed, level];
    saveSaveData(save);
    set({ save });
  },

  // Persistent-progression pass: the one and only way coins ever increase.
  // Called by GameEngine the instant a boss-dropped coin pickup reaches the
  // player — persisted immediately so it survives even an abrupt tab close.
  addCoins: (amount) => {
    if (amount <= 0) return;
    const save = { ...get().save, coins: get().save.coins + amount };
    saveSaveData(save);
    set({ save });
  },

  // Called by GameEngine when a level with a special-weapon-unlock
  // milestone loads for the first time — permanent, survives Game Over,
  // same one-time-grant shape as claimBonusWeaponMilestone above.
  unlockSpecialWeapon: (id) => {
    const save = { ...get().save };
    if (save.unlockedSpecialWeapons.includes(id)) return;
    save.unlockedSpecialWeapons = [...save.unlockedSpecialWeapons, id];
    saveSaveData(save);
    set({ save });
  },

  // The one and only way coins ever decrease. Returns whether the purchase
  // went through (false if too poor or not yet unlocked) so the shop UI can
  // react without duplicating the balance/unlock checks. Deliberately does
  // NOT grant the weapon itself — the caller (ShopOverlay) does that, either
  // into save.pendingSpecialWeapon (main menu, no run active yet) or
  // directly into the live engine.player.hasSpecialWeaponId (pause menu,
  // mid-run) — this store has no reference to a running GameEngine.
  purchaseSpecialWeapon: (id) => {
    const save = get().save;
    const def = SPECIAL_WEAPONS[id];
    if (!save.unlockedSpecialWeapons.includes(id)) return false;
    if (save.coins < def.price) return false;
    const next = { ...save, coins: save.coins - def.price };
    saveSaveData(next);
    set({ save: next });
    return true;
  },

  setPendingSpecialWeapon: (id) => {
    const save = { ...get().save, pendingSpecialWeapon: id };
    saveSaveData(save);
    set({ save });
  },

  // Character-system overhaul: switching only requires the character to
  // already be unlocked — no cost, freely reversible, matches "Charakter
  // wechseln" in the MEIN CHARAKTER menu.
  selectCharacter: (id) => {
    const save = get().save;
    if (!save.unlockedCharacters.includes(id)) return;
    const next = { ...save, selectedCharacter: id };
    saveSaveData(next);
    set({ save: next });
  },

  // Permanent coin unlock — same one-way shape as purchaseSpecialWeapon,
  // but for a hero rather than a consumable. Also auto-equips the newly
  // bought character so the purchase has an immediate, visible payoff.
  purchaseCharacter: (id) => {
    const save = get().save;
    if (save.unlockedCharacters.includes(id)) return false;
    const def = CHARACTERS[id];
    if (save.coins < def.unlockCost) return false;
    const next = {
      ...save,
      coins: save.coins - def.unlockCost,
      unlockedCharacters: [...save.unlockedCharacters, id],
      selectedCharacter: id,
    };
    saveSaveData(next);
    set({ save: next });
    return true;
  },

  equipCapeColor: (id) => {
    const save = get().save;
    if (!save.unlockedCapeColors.includes(id)) return;
    const next = { ...save, equippedCapeColor: id };
    saveSaveData(next);
    set({ save: next });
  },

  purchaseCapeColor: (id) => {
    const save = get().save;
    if (save.unlockedCapeColors.includes(id)) return false;
    const def = CAPE_COLORS[id];
    if (save.coins < def.price) return false;
    const next = {
      ...save,
      coins: save.coins - def.price,
      unlockedCapeColors: [...save.unlockedCapeColors, id],
      equippedCapeColor: id,
    };
    saveSaveData(next);
    set({ save: next });
    return true;
  },

  // Point 25-27: a genuine complete reset — every unlock, every piece of
  // progress, back to a brand-new save — EXCEPT the highscore, which is the
  // one thing explicitly meant to survive forever. Gated behind a
  // confirmation dialog in the UI (MainMenuScreen) since this is otherwise
  // unrecoverable.
  resetAllProgress: () => {
    const preservedHighScore = get().save.highScore;
    const fresh = { ...defaultSaveData(), highScore: preservedHighScore };
    saveSaveData(fresh);
    set({ save: fresh, screen: 'mainMenu' });
  },
}));
