import type { SpecialWeaponDef, SpecialWeaponId } from '../game/types';

// Persistent-progression pass: the "Waffenkammer" shop's catalog. Each
// entry unlocks (becomes purchasable) at a specific campaign boss level —
// see SPECIAL_WEAPON_UNLOCK_LEVELS below — and stays unlocked forever once
// reached, independent of later Game Overs (see appStore.unlockSpecialWeapon).
// Priced roughly by how spectacular/powerful the effect is, per the brief's
// 30-50 / 75-100 / 150+ tiers, with a mix of offensive/defensive/support/
// distraction/AoE so a run's single held slot is a real tactical choice.
export const SPECIAL_WEAPONS: Record<SpecialWeaponId, SpecialWeaponDef> = {
  chickenAttack: {
    id: 'chickenAttack', name: 'Hühner-Angriff', icon: '🐔',
    tagline: 'Bagawk of war.', price: 30, category: 'offensive',
  },
  poopCatapult: {
    id: 'poopCatapult', name: 'Kot-Katapult', icon: '💩',
    tagline: 'Geschmacklos, aber effektiv.', price: 40, category: 'distraction',
  },
  bigBoomerang: {
    id: 'bigBoomerang', name: 'Riesen-Bumerang', icon: '🪃',
    tagline: 'Kommt garantiert zurück.', price: 50, category: 'offensive',
  },
  beeSwarm: {
    id: 'beeSwarm', name: 'Bienenschwarm', icon: '🐝',
    tagline: 'Stich für Stich.', price: 60, category: 'aoe',
  },
  explodingDuck: {
    id: 'explodingDuck', name: 'Explodierende Ente', icon: '🦆',
    tagline: 'Quak. Bumm.', price: 75, category: 'aoe',
  },
  raven: {
    id: 'raven', name: 'Raben-Assistent', icon: '🐦',
    tagline: 'Der pickt das schon.', price: 80, category: 'support',
  },
  eggBomber: {
    id: 'eggBomber', name: 'Eier-Bomber', icon: '🥚',
    tagline: 'Vorsicht, zerbrechlich... für den Gegner.', price: 90, category: 'aoe',
  },
  iceCannon: {
    id: 'iceCannon', name: 'Eis-Kanone', icon: '🧊',
    tagline: 'Cool bleiben.', price: 100, category: 'defensive',
  },
  tornadoStrike: {
    id: 'tornadoStrike', name: 'Mini-Tornado', icon: '🌀',
    tagline: 'Ein bisschen Wind gefällig?', price: 120, category: 'distraction',
  },
  laser: {
    id: 'laser', name: 'Laserkanone', icon: '🔴',
    tagline: 'Warum kompliziert kämpfen?', price: 150, category: 'offensive',
  },
};

export const SPECIAL_WEAPON_LIST = Object.values(SPECIAL_WEAPONS);

// One special weapon unlocks per boss level, cheapest/simplest first —
// mirrors the campaign's own 10 boss levels 1:1 so every boss kill has a
// chance to feel like real, lasting progress even beyond that run's coins.
export const SPECIAL_WEAPON_UNLOCK_LEVELS: Record<number, SpecialWeaponId> = {
  5: 'chickenAttack',
  10: 'poopCatapult',
  15: 'bigBoomerang',
  20: 'beeSwarm',
  25: 'explodingDuck',
  30: 'raven',
  35: 'eggBomber',
  40: 'iceCannon',
  45: 'tornadoStrike',
  50: 'laser',
};
