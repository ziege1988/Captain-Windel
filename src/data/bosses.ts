import type { BossDef } from '../game/types';

// Section 15-17 & 54: 10 boss slots (one per 5-level chapter). Every boss
// reuses the same BossDef shape + a small set of reusable BossAbilityId
// mechanics (see game/ai/bossBehavior.ts) so later bosses need only new
// data, not new systems. Clown and Huhn get their signature named
// mechanics; later bosses combine abilities differently for variety.
export const BOSSES: Record<string, BossDef> = {
  clown: {
    id: 'clown', name: 'Der Clown', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 320, meleeDamage: 14, defense: 0.05, moveSpeed: 140, attackSpeed: 0.9, attackControl: 1 },
    scoreValue: 3000, color: '#2c2c2c', accessories: ['clownNose', 'clownShoes', 'clownHat'],
    weaponId: 'club', preferredRange: 70, sizeMult: 1.5,
    abilities: [
      { id: 'balloonBarrage', name: 'Ballon-Salve', cooldownMs: 9000, telegraphMs: 700 },
      { id: 'chargeSlam', name: 'Hammer-Sprung', cooldownMs: 7000, telegraphMs: 500 },
    ],
    introText: 'Der Clown betritt die Arena... irgendwas stimmt nicht mit ihm.',
    deathText: 'Der Clown fällt der Länge nach hin und lässt einen letzten Luftballon steigen.',
    arenaId: 'meadowBoss',
  },
  ironTree: {
    id: 'ironTree', name: 'Eisen-Baum', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 520, meleeDamage: 18, defense: 0.1, moveSpeed: 110, attackSpeed: 0.8, attackControl: 0.95 },
    scoreValue: 4200, color: '#2c2c2c', accessories: ['heavyArmor'],
    weaponId: 'axe', preferredRange: 75, sizeMult: 1.6,
    abilities: [
      { id: 'chargeSlam', name: 'Wurzel-Stampfer', cooldownMs: 6500, telegraphMs: 600 },
      { id: 'summonMinion', name: 'Astlinge rufen', cooldownMs: 12000, telegraphMs: 400 },
    ],
    introText: 'Der Wald selbst scheint sich gegen dich zu erheben.',
    deathText: 'Der Eisen-Baum stürzt krachend um.',
    arenaId: 'forestBoss',
  },
  magmaBrute: {
    id: 'magmaBrute', name: 'Magma-Brutalo', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 760, meleeDamage: 22, defense: 0.12, moveSpeed: 130, attackSpeed: 0.85, attackControl: 1 },
    scoreValue: 5400, color: '#2c2c2c', accessories: ['heavyArmor'],
    weaponId: 'club', preferredRange: 70, sizeMult: 1.65,
    abilities: [
      { id: 'chargeSlam', name: 'Lava-Stampfer', cooldownMs: 6000, telegraphMs: 550 },
      { id: 'eggDrop', name: 'Glutklumpen', cooldownMs: 8000, telegraphMs: 600 },
    ],
    introText: 'Die Erde glüht unter seinen Schritten.',
    deathText: 'Der Magma-Brutalo erstarrt und zerbröselt zu Asche.',
    arenaId: 'volcanoBoss',
  },
  frostQueen: {
    id: 'frostQueen', name: 'Frost-Königin', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 1000, meleeDamage: 24, defense: 0.1, moveSpeed: 150, attackSpeed: 1.0, attackControl: 1.05 },
    scoreValue: 6600, color: '#2c2c2c', accessories: ['wizardHat'],
    weaponId: 'bow', preferredRange: 300, sizeMult: 1.6,
    abilities: [
      { id: 'summonMinion', name: 'Eis-Diener rufen', cooldownMs: 11000, telegraphMs: 400 },
      { id: 'chargeSlam', name: 'Frost-Stoß', cooldownMs: 6500, telegraphMs: 500 },
    ],
    introText: 'Die Luft wird eisig kalt.',
    deathText: 'Die Frost-Königin schmilzt langsam dahin.',
    arenaId: 'iceBoss',
  },
  chicken: {
    id: 'chicken', name: 'Killer-Huhn', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 1260, meleeDamage: 20, defense: 0.05, moveSpeed: 210, attackSpeed: 1.3, attackControl: 1 },
    scoreValue: 7800, color: '#f5f5f5', accessories: ['chickenBeak'],
    preferredRange: 55, sizeMult: 1.5,
    abilities: [
      { id: 'eggDrop', name: 'Faules Ei', cooldownMs: 5000, telegraphMs: 450 },
      { id: 'chargeSlam', name: 'Hektischer Ansturm', cooldownMs: 7000, telegraphMs: 350 },
    ],
    introText: 'BGAWK! Ein völlig durchgeknalltes Riesenhuhn stürmt herein.',
    deathText: 'Das Killer-Huhn taumelt, legt ein letztes Ei und plumpst um.',
    arenaId: 'desertBoss',
  },
  stoneKnight: {
    id: 'stoneKnight', name: 'Stein-Ritter', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 1550, meleeDamage: 26, defense: 0.22, moveSpeed: 100, attackSpeed: 0.75, attackControl: 0.9 },
    scoreValue: 9200, color: '#2c2c2c', accessories: ['shield', 'heavyArmor'],
    weaponId: 'sword', preferredRange: 75, sizeMult: 1.7,
    abilities: [
      { id: 'chargeSlam', name: 'Ruinen-Stampfer', cooldownMs: 6000, telegraphMs: 600 },
      { id: 'summonMinion', name: 'Wachen rufen', cooldownMs: 13000, telegraphMs: 400 },
    ],
    introText: 'Die Ruine erwacht zu unheilvollem Leben.',
    deathText: 'Der Stein-Ritter zerfällt zu einem Steinhaufen.',
    arenaId: 'ruinsBoss',
  },
  graveWraith: {
    id: 'graveWraith', name: 'Grab-Geist', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 1850, meleeDamage: 28, defense: 0.1, moveSpeed: 175, attackSpeed: 1.1, attackControl: 1 },
    scoreValue: 10600, color: '#37474f', accessories: ['wizardHat'],
    weaponId: 'sword', preferredRange: 70, sizeMult: 1.6,
    abilities: [
      { id: 'summonMinion', name: 'Untote rufen', cooldownMs: 10000, telegraphMs: 400 },
      { id: 'balloonBarrage', name: 'Seelen-Salve', cooldownMs: 9000, telegraphMs: 600 },
    ],
    introText: 'Nebel steigt aus den Gräbern auf.',
    deathText: 'Der Grab-Geist löst sich in Rauch auf.',
    arenaId: 'graveyardBoss',
  },
  stormTitan: {
    id: 'stormTitan', name: 'Sturm-Titan', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 2200, meleeDamage: 30, defense: 0.12, moveSpeed: 160, attackSpeed: 1.0, attackControl: 1 },
    scoreValue: 12200, color: '#2c2c2c', accessories: ['heavyArmor'],
    weaponId: 'axe', preferredRange: 80, sizeMult: 1.75,
    abilities: [
      { id: 'chargeSlam', name: 'Donnerschlag', cooldownMs: 6000, telegraphMs: 550 },
      { id: 'eggDrop', name: 'Blitzeinschlag', cooldownMs: 7500, telegraphMs: 500 },
    ],
    introText: 'Der Himmel reißt auf.',
    deathText: 'Der Sturm-Titan wird vom eigenen Blitz getroffen und stürzt.',
    arenaId: 'stormBoss',
  },
  chaosHydra: {
    id: 'chaosHydra', name: 'Chaos-Zwilling', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 2650, meleeDamage: 32, defense: 0.14, moveSpeed: 190, attackSpeed: 1.15, attackControl: 1.05 },
    scoreValue: 14200, color: '#4a148c', accessories: ['wizardHat', 'shield'],
    weaponId: 'sword', preferredRange: 75, sizeMult: 1.8,
    abilities: [
      { id: 'summonMinion', name: 'Chaos-Klone', cooldownMs: 9500, telegraphMs: 400 },
      { id: 'balloonBarrage', name: 'Chaos-Splitter', cooldownMs: 8000, telegraphMs: 500 },
    ],
    introText: 'Die Realität selbst beginnt zu flackern.',
    deathText: 'Der Chaos-Zwilling zerplatzt in bunte Fetzen.',
    arenaId: 'chaosArenaBoss',
  },
  windelNemesis: {
    id: 'windelNemesis', name: 'Captain Shadow', isBoss: true, aiType: 'boss',
    baseStats: { maxHealth: 3600, meleeDamage: 38, defense: 0.15, moveSpeed: 220, attackSpeed: 1.25, attackControl: 1.1 },
    scoreValue: 25000, color: '#000000', accessories: ['heavyArmor', 'shield'],
    weaponId: 'sword', preferredRange: 75, sizeMult: 1.9,
    abilities: [
      { id: 'chargeSlam', name: 'Schatten-Ansturm', cooldownMs: 5000, telegraphMs: 450 },
      { id: 'summonMinion', name: 'Schattenklone rufen', cooldownMs: 9000, telegraphMs: 350 },
      { id: 'eggDrop', name: 'Dunkel-Explosion', cooldownMs: 7000, telegraphMs: 500 },
    ],
    introText: 'Ein dunkles Spiegelbild von Captain Windel selbst tritt aus dem Schatten.',
    deathText: 'Captain Shadow zerfällt in Rauch und Windeln fliegen durch die Luft.',
    arenaId: 'finalDarkBoss',
  },
};

export const BOSS_LIST = Object.values(BOSSES);
export const BOSS_ORDER: string[] = [
  'clown', 'ironTree', 'magmaBrute', 'frostQueen', 'chicken',
  'stoneKnight', 'graveWraith', 'stormTitan', 'chaosHydra', 'windelNemesis',
];
