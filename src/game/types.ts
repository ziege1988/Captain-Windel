// Core shared types for the whole game. Everything data-driven (enemies,
// bosses, weapons, upgrades, superpowers, arenas, levels) is described with
// these interfaces so new content can be added as data, not new engine code.

export interface Vec2 {
  x: number;
  y: number;
}

export type FacingDirection = 1 | -1;

export type AnimState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'attack'
  | 'kick'
  | 'block'
  | 'dodge'
  | 'hit'
  | 'knockback'
  | 'stagger'
  | 'fallen'
  | 'gettingUp'
  | 'vomit'
  | 'superpower'
  | 'fart'
  | 'dead'
  | 'bossIntro'
  | 'bossDeath'
  | 'taunt'
  | 'telegraph'
  | 'dazed'
  | 'surprised';

/** Base combat stats. All multiplicative modifiers from upgrades/equipment
 * apply on top of these at read-time (see StatModifiers). */
export interface StatBlock {
  maxHealth: number;
  meleeDamage: number;
  defense: number; // 0..0.9, fraction of incoming damage reduced
  moveSpeed: number; // px/s
  attackSpeed: number; // multiplier, 1 = base
  attackControl: number; // multiplier affecting hit-box precision / recovery
}

export interface StatModifiers {
  maxHealthMult: number;
  meleeDamageMult: number;
  defenseAdd: number;
  moveSpeedMult: number;
  attackSpeedMult: number;
  attackControlMult: number;
}

export function defaultModifiers(): StatModifiers {
  return {
    maxHealthMult: 1,
    meleeDamageMult: 1,
    defenseAdd: 0,
    moveSpeedMult: 1,
    attackSpeedMult: 1,
    attackControlMult: 1,
  };
}

export function combineModifiers(a: StatModifiers, b: StatModifiers): StatModifiers {
  return {
    maxHealthMult: a.maxHealthMult * b.maxHealthMult,
    meleeDamageMult: a.meleeDamageMult * b.meleeDamageMult,
    defenseAdd: a.defenseAdd + b.defenseAdd,
    moveSpeedMult: a.moveSpeedMult * b.moveSpeedMult,
    attackSpeedMult: a.attackSpeedMult * b.attackSpeedMult,
    attackControlMult: a.attackControlMult * b.attackControlMult,
  };
}

export function applyModifiers(base: StatBlock, mod: StatModifiers): StatBlock {
  return {
    maxHealth: base.maxHealth * mod.maxHealthMult,
    meleeDamage: base.meleeDamage * mod.meleeDamageMult,
    defense: Math.min(0.9, Math.max(0, base.defense + mod.defenseAdd)),
    moveSpeed: base.moveSpeed * mod.moveSpeedMult,
    attackSpeed: base.attackSpeed * mod.attackSpeedMult,
    attackControl: base.attackControl * mod.attackControlMult,
  };
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WeaponId =
  | 'fists'
  | 'branch'
  | 'club'
  | 'frypan'
  | 'boxingGloves'
  | 'spear'
  | 'axe'
  | 'sword'
  | 'boomerang'
  | 'bow';

export type AttackShape = 'melee' | 'thrust' | 'ranged' | 'boomerang';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  shape: AttackShape;
  range: number; // px reach in front of the character
  damageMult: number; // multiplier on base melee damage
  attackSpeedMult: number; // multiplier on attack cadence (lower = slower)
  knockback: number; // impulse applied to target
  staggerChance: number; // 0..1
  color: string;
  trailColor?: string;
  projectileSpeed?: number; // for ranged/boomerang weapons
}

// ---------------------------------------------------------------------------
// Upgrades / equipment
// ---------------------------------------------------------------------------

export type UpgradeCategory = 'stat' | 'weapon' | 'ability';

export type EquipmentSlot = 'head' | 'hands' | 'feet' | 'body' | 'back' | null;

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  category: UpgradeCategory;
  weight: number; // relative chance of being offered
  equipmentSlot: EquipmentSlot; // visual attachment point, or null
  grantsWeapon?: WeaponId;
  grantsAbility?: string; // ability id, e.g. bananaPeel
  modifiers: Partial<StatModifiers>;
  maxStacks?: number; // default 1 (unique), Infinity for stackable
  minLevel?: number; // earliest campaign level this can be offered on (default 1)
}

// ---------------------------------------------------------------------------
// Superpowers ("Furz"-Kräfte)
// ---------------------------------------------------------------------------

export type SuperpowerId =
  | 'gasCloud'
  | 'chili'
  | 'ice'
  | 'electro'
  | 'tornado'
  | 'nuclear';

export interface SuperpowerDef {
  id: SuperpowerId;
  name: string;
  icon: string;
  description: string;
  unlockAtKills: number;
  cooldownMs: number;
  damage: number;
  effectDurationMs: number; // duration of debuff on target (slow/freeze/stun/dot)
  color: string;
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export type AiType = 'melee' | 'ranged' | 'ninja' | 'defensive' | 'boss';

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

export interface EnemyDef {
  id: string;
  name: string;
  aiType: AiType;
  baseStats: StatBlock;
  scoreValue: number;
  color: string;
  accessories: string[]; // visual tags e.g. 'boxingGloves', 'shield', 'ninjaMask'
  weaponId?: WeaponId;
  preferredRange: number; // for ranged/defensive AI
  isBoss?: false;
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

export type BossAbilityId = 'balloonBarrage' | 'eggDrop' | 'chargeSlam' | 'summonMinion' | 'fireWave' | 'frostNova';

export interface BossAbilityDef {
  id: BossAbilityId;
  name: string;
  cooldownMs: number;
  telegraphMs: number;
}

export interface BossDef extends Omit<EnemyDef, 'isBoss'> {
  isBoss: true;
  sizeMult: number;
  abilities: BossAbilityDef[];
  introText: string;
  deathText: string;
  arenaId: string;
}

// ---------------------------------------------------------------------------
// Arenas
// ---------------------------------------------------------------------------

export type ArenaPalette = 'meadow' | 'darkMeadow' | 'forest' | 'volcano' | 'ice' | 'desert' | 'ruins' | 'graveyard' | 'storm' | 'chaos';

export interface ArenaDef {
  id: string;
  name: string;
  palette: ArenaPalette;
  skyTop: string;
  skyBottom: string;
  groundColor: string;
  groundColor2: string;
  accentColor: string;
  isDark: boolean;
  hasLightning: boolean;
  hasFog: boolean;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export interface LevelDef {
  index: number; // 1-based
  enemyId: string;
  isBoss: boolean;
  bossId?: string;
  arenaId: string;
  difficultyScale: number; // multiplier applied on top of enemy base stats
  sizeScale: number;
}
