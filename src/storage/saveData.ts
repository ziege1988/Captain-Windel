import type { CapeColorId, CharacterId, SpecialWeaponId, SuperpowerId, WeaponId } from '../game/types';
import { storageGet, storageSet } from './storage';
import { WEAPONS, WEAPON_MAX_LEVEL } from '../data/weapons';
import { SPECIAL_WEAPONS } from '../data/specialWeapons';

const SAVE_KEY = 'captainWindel.save.v1';

export interface SaveData {
  highScore: number;
  highestLevelReached: number; // highest unlocked/beaten level, campaign
  // Where a Game Over drops you back to: the level right after the last
  // boss you beat. Losing used to send you all the way back to level 1,
  // which threw away up to five levels of progress and every boss fight
  // leading up to them; bosses are the campaign's checkpoints, so that is
  // what a lost run rewinds to.
  checkpointLevel: number;
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
  // Persistent-progression pass: coins and shop unlocks survive Game Over
  // (only shop purchases ever spend coins — see appStore.finishRun, which
  // deliberately does NOT touch any of these fields).
  coins: number;
  unlockedSpecialWeapons: SpecialWeaponId[];
  // How far each weapon has been sharpened with coins, 0 = as found. Part
  // of the permanent layer: an upgrade is never lost to a Game Over, which
  // is the whole reason it is worth saving up for.
  weaponLevels: Partial<Record<WeaponId, number>>;
  // What is actually owned and how many of each. Replaces the old single
  // "one weapon, held until used" slot: a weapon can now be bought over
  // and over, and the count is what gets spent one at a time. At most
  // SPECIAL_WEAPON_SLOTS distinct kinds are held at once (the shop
  // enforces that) — the count per kind is unlimited. Bought stock is
  // yours until you use it: a Game Over never takes it away, matching the
  // rest of the permanent progression layer.
  specialWeaponStock: Partial<Record<SpecialWeaponId, number>>;
  // Character-system overhaul: which hero is currently played, which are
  // permanently unlocked (coin purchase, see appStore.purchaseCharacter),
  // and the cosmetic-only cape recolor system (never affects stats).
  // Windelmann and the "red" cape are always implicitly unlocked/free.
  selectedCharacter: CharacterId;
  unlockedCharacters: CharacterId[];
  equippedCapeColor: CapeColorId;
  unlockedCapeColors: CapeColorId[];
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
    checkpointLevel: 1,
    highestCombo: 0,
    bossesDefeated: [],
    totalKills: 0,
    unlockedWeapons: ['fists'],
    unlockedSuperpowers: ['gasCloud'],
    equippedSuperpowerSlots: ['gasCloud', null, null],
    longestChaosRun: 0,
    bonusWeaponMilestonesClaimed: [],
    storkBonusMilestonesClaimed: [],
    coins: 0,
    unlockedSpecialWeapons: [],
    specialWeaponStock: {},
    weaponLevels: {},
    selectedCharacter: 'windelmann',
    unlockedCharacters: ['windelmann'],
    equippedCapeColor: 'red',
    unlockedCapeColors: ['red'],
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
    const merged: SaveData = {
      ...defaultSaveData(), ...parsed, settings: { ...defaultSaveData().settings, ...parsed.settings },
    };
    merged.unlockedWeapons = migrateUnlockedWeapons(merged.unlockedWeapons);
    merged.specialWeaponStock = migrateSpecialWeaponStock(parsed);
    merged.weaponLevels = migrateWeaponLevels(parsed);
    return merged;
  } catch {
    return defaultSaveData();
  }
}

/** Keeps an older save's weapon list valid against the current roster.
 * Two things can go stale: a weapon that no longer exists at all (the old
 * frypan), which would make WEAPONS[id] undefined and break the HUD the
 * moment it was cycled to, and the club, which was replaced in the player's
 * arsenal by the toilet paper (it lives on as an enemy weapon). Anyone who
 * already earned the club gets its replacement rather than losing a slot. */
function migrateUnlockedWeapons(ids: unknown): WeaponId[] {
  const list = Array.isArray(ids) ? ids : [];
  const out: WeaponId[] = ['fists'];
  for (const raw of list) {
    const id = raw === 'club' ? 'toiletPaper' : raw;
    if (typeof id !== 'string') continue;
    if (!(id in WEAPONS)) continue;
    if (!out.includes(id as WeaponId)) out.push(id as WeaponId);
  }
  return out;
}

/** Brings a save forward to the counted stock. Older saves held at most
 * one special weapon in `pendingSpecialWeapon`; that becomes a stock of
 * one, so nobody loses something they paid for. Also drops entries for
 * weapons that no longer exist and any count that is not a positive whole
 * number, since a corrupted count would otherwise render as "NaNx" on the
 * combat button. */
function migrateSpecialWeaponStock(parsed: Record<string, unknown>): Partial<Record<SpecialWeaponId, number>> {
  const out: Partial<Record<SpecialWeaponId, number>> = {};
  const raw = parsed.specialWeaponStock;
  if (raw && typeof raw === 'object') {
    for (const [id, count] of Object.entries(raw as Record<string, unknown>)) {
      if (!(id in SPECIAL_WEAPONS)) continue;
      const n = Math.floor(Number(count));
      if (Number.isFinite(n) && n > 0) out[id as SpecialWeaponId] = n;
    }
  }
  const legacy = parsed.pendingSpecialWeapon;
  if (typeof legacy === 'string' && legacy in SPECIAL_WEAPONS && !out[legacy as SpecialWeaponId]) {
    out[legacy as SpecialWeaponId] = 1;
  }
  return out;
}

/** Keeps upgrade levels sane across versions: unknown weapon ids are
 * dropped, and anything that is not a whole number in range is discarded
 * rather than being fed into a damage multiplier. */
function migrateWeaponLevels(parsed: Record<string, unknown>): Partial<Record<WeaponId, number>> {
  const out: Partial<Record<WeaponId, number>> = {};
  const raw = parsed.weaponLevels;
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, level] of Object.entries(raw as Record<string, unknown>)) {
    if (!(id in WEAPONS)) continue;
    const n = Math.floor(Number(level));
    if (Number.isFinite(n) && n > 0) out[id as WeaponId] = Math.min(WEAPON_MAX_LEVEL, n);
  }
  return out;
}

export function saveSaveData(data: SaveData): void {
  try {
    storageSet(SAVE_KEY, JSON.stringify(data));
  } catch {
    // storage layer already falls back to memory; nothing else to do
  }
}
