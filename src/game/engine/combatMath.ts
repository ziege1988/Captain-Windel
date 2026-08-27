import { BALANCE } from '../../data/balance';
import type { WeaponDef } from '../types';
import type { Fighter } from '../entities/Fighter';

export type HitTier = 'normal' | 'heavy' | 'critical';

export interface HitResult {
  tier: HitTier;
  damage: number;
  knockback: number;
  staggered: boolean;
  vomit: boolean;
  perfect: boolean;
}

// Section 8-10/30: central place that decides how hard a hit lands, whether
// it staggers/knocks down, and whether it triggers the cartoon vomit gag.
export function resolveHit(attacker: Fighter, weapon: WeaponDef, isKick: boolean, perfect: boolean): HitResult {
  const roll = Math.random();
  let tier: HitTier = 'normal';
  if (roll < BALANCE.hit.critChance || perfect) tier = 'critical';
  else if (roll < BALANCE.hit.critChance + BALANCE.hit.heavyChance) tier = 'heavy';

  const base = attacker.stats.meleeDamage * weapon.damageMult * (isKick ? 0.85 : 1);
  const tierMult = tier === 'critical' ? 1.9 : tier === 'heavy' ? 1.35 : 1;
  const perfectBonus = perfect ? 1.25 : 1;
  const damage = base * tierMult * perfectBonus;

  const knockback = weapon.knockback * (tier === 'critical' ? 1.6 : tier === 'heavy' ? 1.25 : 1);
  const staggerChance = weapon.staggerChance + (tier === 'critical' ? 0.35 : tier === 'heavy' ? 0.15 : 0);
  const staggered = Math.random() < Math.min(0.95, staggerChance);
  const vomit = tier === 'critical' && Math.random() < BALANCE.hit.vomitChanceOnCrit;

  return { tier, damage, knockback, staggered, vomit, perfect };
}

export function applyDefense(rawDamage: number, defenderDefense: number): number {
  return Math.max(1, rawDamage * (1 - defenderDefense));
}

export function scoreForHit(tier: HitTier, perfect: boolean): number {
  let value: number = BALANCE.score.hit;
  if (tier === 'heavy') value = BALANCE.score.heavyHit;
  if (tier === 'critical') value = BALANCE.score.criticalHit;
  if (perfect) value += BALANCE.score.perfectBonus;
  return value;
}
