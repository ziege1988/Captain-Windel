import { Fighter } from './Fighter';
import type { BossDef, EnemyDef } from '../types';
import { BALANCE } from '../../data/balance';
import type { SaveData } from '../../storage/saveData';
import { UPGRADES } from '../../data/upgrades';

// Baseline visual scale so fighters read clearly on a tall mobile screen
// with a lot of sky above the ground line — purely cosmetic, applied on
// top of the per-level size scaling (section 12) and boss size (section 15).
const VISUAL_SCALE = 1.35;

export function createPlayer(x: number, groundY: number, save: SaveData): Fighter {
  const f = new Fighter('player', 'player', 'Captain Windel', { ...BALANCE.player.baseStats }, x, groundY);
  f.color = '#111111';
  f.weaponId = 'fists';
  f.accessories = ['diaper', 'cape'];
  f.scale = VISUAL_SCALE;
  void save;
  return f;
}

export function applyUpgradeToPlayer(player: Fighter, upgradeId: string): void {
  const def = UPGRADES.find((u) => u.id === upgradeId);
  if (!def) return;
  const already = player.equippedUpgradeIds.filter((id) => id === upgradeId).length;
  const maxStacks = def.maxStacks ?? 1;
  if (already >= maxStacks) return;

  player.equippedUpgradeIds.push(upgradeId);
  player.modifiers = {
    maxHealthMult: player.modifiers.maxHealthMult * (def.modifiers.maxHealthMult ?? 1),
    meleeDamageMult: player.modifiers.meleeDamageMult * (def.modifiers.meleeDamageMult ?? 1),
    defenseAdd: player.modifiers.defenseAdd + (def.modifiers.defenseAdd ?? 0),
    moveSpeedMult: player.modifiers.moveSpeedMult * (def.modifiers.moveSpeedMult ?? 1),
    attackSpeedMult: player.modifiers.attackSpeedMult * (def.modifiers.attackSpeedMult ?? 1),
    attackControlMult: player.modifiers.attackControlMult * (def.modifiers.attackControlMult ?? 1),
  };
  // Health scales with the new max but keep the current ratio full-ish
  player.health = Math.min(player.health + (player.maxHealth - player.health) * 0, player.maxHealth);
  player.health = Math.min(player.maxHealth, player.health + player.maxHealth * 0.15);

  if (def.grantsWeapon) {
    player.weaponId = def.grantsWeapon;
  }
  if (def.equipmentSlot) {
    player.accessories = [...player.accessories, def.equipmentSlot === 'head' ? 'pot'
      : def.equipmentSlot === 'hands' ? 'gloves'
      : def.equipmentSlot === 'feet' ? 'bigShoes'
      : def.equipmentSlot === 'body' ? 'shield'
      : 'fancyCape'];
  }
}

let enemyCounter = 0;

export function createEnemy(def: EnemyDef, x: number, groundY: number, difficultyScale: number, sizeScale: number): Fighter {
  enemyCounter += 1;
  const scaled = {
    maxHealth: def.baseStats.maxHealth * difficultyScale,
    meleeDamage: def.baseStats.meleeDamage * (1 + (difficultyScale - 1) * (BALANCE.enemyScaling.damageGrowthPerLevel / BALANCE.enemyScaling.healthGrowthPerLevel)),
    defense: def.baseStats.defense + (difficultyScale - 1) * (BALANCE.enemyScaling.defenseGrowthPerLevel / BALANCE.enemyScaling.healthGrowthPerLevel) * 0.1,
    moveSpeed: def.baseStats.moveSpeed * (1 + (difficultyScale - 1) * (BALANCE.enemyScaling.speedGrowthPerLevel / BALANCE.enemyScaling.healthGrowthPerLevel)),
    attackSpeed: def.baseStats.attackSpeed,
    attackControl: def.baseStats.attackControl,
  };
  const f = new Fighter(`enemy_${enemyCounter}`, 'enemy', def.name, scaled, x, groundY);
  f.facing = -1;
  f.color = def.color;
  f.accessories = def.accessories;
  f.scale = sizeScale * VISUAL_SCALE;
  if (def.weaponId) f.weaponId = def.weaponId;
  f.aiType = def.aiType;
  f.preferredRange = def.preferredRange;
  f.scoreValue = def.scoreValue;
  return f;
}

export function createBoss(def: BossDef, x: number, groundY: number, difficultyScale: number, sizeScale: number): Fighter {
  enemyCounter += 1;
  const scaled = {
    maxHealth: def.baseStats.maxHealth * difficultyScale * BALANCE.boss.healthMult,
    meleeDamage: def.baseStats.meleeDamage * difficultyScale * BALANCE.boss.damageMult,
    defense: def.baseStats.defense,
    moveSpeed: def.baseStats.moveSpeed,
    attackSpeed: def.baseStats.attackSpeed,
    attackControl: def.baseStats.attackControl,
  };
  const f = new Fighter(`boss_${def.id}`, 'boss', def.name, scaled, x, groundY);
  f.facing = -1;
  f.color = def.color;
  f.accessories = def.accessories;
  f.scale = def.sizeMult * sizeScale * VISUAL_SCALE;
  f.width = 60;
  f.height = 120;
  if (def.weaponId) f.weaponId = def.weaponId;
  f.aiType = 'boss';
  f.preferredRange = def.preferredRange;
  f.scoreValue = def.scoreValue;
  f.bossDefId = def.id;
  return f;
}
