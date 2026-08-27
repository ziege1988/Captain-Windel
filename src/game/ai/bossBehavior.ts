import type { Fighter } from '../entities/Fighter';
import type { BossAbilityDef } from '../types';

export interface BossTickResult {
  fireAbility: BossAbilityDef | null;
  telegraphStarted: BossAbilityDef | null;
}

/** Advances a boss's ability cooldown/telegraph state machine by dtMs.
 * Returns which ability (if any) just started telegraphing or just fired
 * this frame, so the engine can trigger the concrete effect exactly once. */
export function tickBossAbilities(boss: Fighter, abilities: BossAbilityDef[], dtMs: number, distToTarget: number): BossTickResult {
  const result: BossTickResult = { fireAbility: null, telegraphStarted: null };
  for (const ability of abilities) {
    const remaining = boss.bossAbilityCooldownsMs[ability.id] ?? 0;
    boss.bossAbilityCooldownsMs[ability.id] = Math.max(0, remaining - dtMs);
  }

  if (boss.bossTelegraph) {
    boss.bossTelegraph.remainingMs -= dtMs;
    if (boss.bossTelegraph.remainingMs <= 0) {
      const ability = abilities.find((a) => a.id === boss.bossTelegraph!.abilityId) ?? null;
      boss.bossTelegraph = null;
      if (ability) {
        boss.bossAbilityCooldownsMs[ability.id] = ability.cooldownMs;
        result.fireAbility = ability;
      }
    }
    return result;
  }

  if (!boss.canAct()) return result;

  const ready = abilities.filter((a) => (boss.bossAbilityCooldownsMs[a.id] ?? 0) <= 0);
  if (ready.length === 0) return result;
  // Only roll for a new ability occasionally and only within reasonable
  // engagement distance, so the boss doesn't spam abilities from far away.
  if (distToTarget > 700) return result;
  if (Math.random() > 0.012) return result;

  const chosen = ready[Math.floor(Math.random() * ready.length)];
  boss.bossTelegraph = { abilityId: chosen.id, remainingMs: chosen.telegraphMs };
  result.telegraphStarted = chosen;
  return result;
}
