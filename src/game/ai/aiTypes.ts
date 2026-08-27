import type { Fighter } from '../entities/Fighter';

export interface AiDecision {
  moveDir: -1 | 0 | 1;
  wantsAttack: boolean;
  wantsBlock: boolean;
  wantsKick: boolean;
}

const NO_ACTION: AiDecision = { moveDir: 0, wantsAttack: false, wantsBlock: false, wantsKick: false };

// Section 45: AI type registry. Each function is a pure decision-maker;
// the combat engine is responsible for actually moving/attacking. New AI
// types can be added here without touching enemy data or the engine loop.
//
// Section 6/7/9 (combat-start balance pass): every behavior now reads
// `self.aggression` before actually taking a swing — a value below 1 means
// the fighter sometimes lets a ready attack opportunity pass (a visible,
// readable "hesitation" beat instead of robotically attacking the instant
// it's able to). And once an attack is on cooldown, a fighter that's still
// standing close now backs off instead of just idling in the player's
// face, so the player always gets some breathing room / an opening
// instead of being pinned against a wall.
export function decideAiAction(self: Fighter, target: Fighter): AiDecision {
  if (!self.canAct()) return NO_ACTION;
  const dx = target.body.pos.x - self.body.pos.x;
  const dist = Math.abs(dx);
  const dir: -1 | 1 = dx >= 0 ? 1 : -1;
  const canAttack = self.attackCooldownRemainingMs <= 0;

  switch (self.aiType) {
    case 'ranged':
      return rangedBehavior(self, dist, dir, canAttack);
    case 'ninja':
      return ninjaBehavior(self, dist, dir, canAttack);
    case 'defensive':
      return defensiveBehavior(self, dist, dir, canAttack);
    case 'boss':
    case 'melee':
    default:
      return meleeBehavior(self, dist, dir, canAttack);
  }
}

function meleeBehavior(self: Fighter, dist: number, dir: -1 | 1, canAttack: boolean): AiDecision {
  const range = self.preferredRange;
  if (dist > range * 1.3) {
    return { moveDir: dir, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  if (canAttack) {
    if (Math.random() < self.aggression) {
      return { moveDir: 0, wantsAttack: true, wantsBlock: false, wantsKick: Math.random() < 0.25 };
    }
    // Hesitates instead of attacking — a readable opening for the player.
    return { moveDir: 0, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  // Recovering from a recent attack — create space rather than crowding.
  if (dist < range * 0.85) {
    return { moveDir: (dir * -1) as -1 | 1, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  return NO_ACTION;
}

function rangedBehavior(self: Fighter, dist: number, dir: -1 | 1, canAttack: boolean): AiDecision {
  const desired = self.preferredRange;
  if (dist < desired * 0.7) {
    return { moveDir: (dir * -1) as -1 | 1, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  if (dist > desired * 1.15) {
    return { moveDir: dir, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  if (canAttack && Math.random() < self.aggression) {
    return { moveDir: 0, wantsAttack: true, wantsBlock: false, wantsKick: false };
  }
  return NO_ACTION;
}

function ninjaBehavior(self: Fighter, dist: number, dir: -1 | 1, canAttack: boolean): AiDecision {
  const range = self.preferredRange;
  if (dist > range * 1.3) {
    return { moveDir: dir, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  if (canAttack && Math.random() < self.aggression) {
    return { moveDir: 0, wantsAttack: true, wantsBlock: false, wantsKick: Math.random() < 0.4 };
  }
  if (dist < range * 0.85) {
    return { moveDir: (dir * -1) as -1 | 1, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  // Skitter around unpredictably while waiting for cooldown.
  const jitter = Math.sin(self.animTimeMs / 120 + self.body.pos.x) > 0 ? 1 : -1;
  return { moveDir: jitter as -1 | 1, wantsAttack: false, wantsBlock: false, wantsKick: false };
}

function defensiveBehavior(self: Fighter, dist: number, dir: -1 | 1, canAttack: boolean): AiDecision {
  const range = self.preferredRange;
  if (dist > range * 1.3) {
    return { moveDir: dir, wantsAttack: false, wantsBlock: Math.random() < 0.1, wantsKick: false };
  }
  if (canAttack && Math.random() < 0.6 * self.aggression) {
    return { moveDir: 0, wantsAttack: true, wantsBlock: false, wantsKick: false };
  }
  if (!canAttack && dist < range * 0.85) {
    return { moveDir: (dir * -1) as -1 | 1, wantsAttack: false, wantsBlock: Math.random() < 0.3, wantsKick: false };
  }
  return { moveDir: 0, wantsAttack: false, wantsBlock: Math.random() < 0.5, wantsKick: false };
}
