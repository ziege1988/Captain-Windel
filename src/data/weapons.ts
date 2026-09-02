import type { WeaponDef, WeaponId } from '../game/types';

// Every weapon plays differently: reach, speed, knockback, and shape are all
// tuned individually rather than just scaling a damage number.
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: {
    id: 'fists',
    name: 'Fäuste',
    description: 'Schnell, kurze Reichweite, kein Schnickschnack.',
    shape: 'melee',
    range: 46,
    damageMult: 1,
    attackSpeedMult: 1.15,
    knockback: 90,
    staggerChance: 0.05,
    color: '#111111',
  },
  branch: {
    id: 'branch',
    name: 'Ast',
    description: 'Der erste gefundene Stock. Etwas mehr Reichweite.',
    shape: 'melee',
    range: 62,
    damageMult: 1.15,
    attackSpeedMult: 1,
    knockback: 110,
    staggerChance: 0.08,
    color: '#7a5230',
  },
  club: {
    id: 'club',
    name: 'Knüppel',
    description: 'Schwer, langsam, stößt ordentlich zurück.',
    shape: 'melee',
    range: 58,
    damageMult: 1.5,
    attackSpeedMult: 0.75,
    knockback: 190,
    staggerChance: 0.22,
    color: '#5c3a21',
  },
  boxingGloves: {
    id: 'boxingGloves',
    name: 'Boxhandschuhe',
    description: 'Sehr schnelle Kombos, geringer Rückstoß.',
    shape: 'melee',
    range: 48,
    damageMult: 1.1,
    attackSpeedMult: 1.4,
    knockback: 70,
    staggerChance: 0.06,
    color: '#c0392b',
  },
  spear: {
    id: 'spear',
    name: 'Speer',
    description: 'Besondere Nahkampfreichweite. Hält Gegner auf Distanz.',
    shape: 'thrust',
    range: 110,
    damageMult: 1.25,
    attackSpeedMult: 0.85,
    knockback: 160,
    staggerChance: 0.1,
    color: '#9b7653',
    trailColor: '#e8d8b0',
  },
  axe: {
    id: 'axe',
    name: 'Axt',
    description: 'Massiver Schaden, spürbar langsam.',
    shape: 'melee',
    range: 64,
    damageMult: 1.9,
    attackSpeedMult: 0.6,
    knockback: 220,
    staggerChance: 0.3,
    color: '#7f8c8d',
  },
  sword: {
    id: 'sword',
    name: 'Schwert',
    description: 'Ausgewogen: gute Reichweite, guter Schaden.',
    shape: 'melee',
    range: 72,
    damageMult: 1.45,
    attackSpeedMult: 1.0,
    knockback: 140,
    staggerChance: 0.15,
    color: '#bdc3c7',
  },
  boomerang: {
    id: 'boomerang',
    name: 'Bumerang',
    description: 'Fliegt weg und kommt zurück. Trifft auf dem Hin- und Rückweg.',
    shape: 'boomerang',
    range: 260,
    damageMult: 0.9,
    attackSpeedMult: 0.7,
    knockback: 100,
    staggerChance: 0.1,
    color: '#e67e22',
    projectileSpeed: 620,
  },
  toiletPaper: {
    id: 'toiletPaper',
    name: 'Klopapier',
    description: 'Wickelt den Gegner blitzschnell ein — er ist kurz gelähmt, bis er sich befreit.',
    shape: 'melee',
    // Low damage on purpose: the payoff is the free window the wrap opens
    // up, not the hit itself.
    range: 78,
    damageMult: 0.65,
    attackSpeedMult: 1.05,
    knockback: 40,
    staggerChance: 0,
    color: '#fafafa',
    trailColor: '#e0e0e0',
  },
  bow: {
    id: 'bow',
    name: 'Bogen',
    description: 'Fernkampf mit sichtbarer Flugbahn.',
    shape: 'ranged',
    range: 520,
    damageMult: 1.1,
    attackSpeedMult: 0.8,
    knockback: 80,
    staggerChance: 0.08,
    color: '#6b4226',
    trailColor: '#f1c40f',
    projectileSpeed: 780,
  },
};

export const WEAPON_LIST = Object.values(WEAPONS);

// Weapons the player can actually end up holding: the starting fists plus
// everything an upgrade grants. 'branch' and 'club' exist only as enemy
// weapons (see enemies.ts / bosses.ts), so the arsenal screens should not
// offer them as permanently-locked slots the player can never fill.
export const PLAYER_WEAPON_IDS: WeaponId[] = [
  'fists', 'boxingGloves', 'toiletPaper', 'spear', 'sword', 'axe', 'boomerang', 'bow',
];
export const PLAYER_WEAPON_LIST = PLAYER_WEAPON_IDS.map((id) => WEAPONS[id]);
