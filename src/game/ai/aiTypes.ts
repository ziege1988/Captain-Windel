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
  if (dist > range) {
    return { moveDir: dir, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  if (canAttack) {
    return { moveDir: 0, wantsAttack: true, wantsBlock: false, wantsKick: Math.random() < 0.25 };
  }
  return { moveDir: 0, wantsAttack: false, wantsBlock: false, wantsKick: false };
}

function rangedBehavior(self: Fighter, dist: number, dir: -1 | 1, canAttack: boolean): AiDecision {
  const desired = self.preferredRange;
  if (dist < desired * 0.7) {
    return { moveDir: (dir * -1) as -1 | 1, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  if (dist > desired * 1.15) {
    return { moveDir: dir, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  if (canAttack) {
    return { moveDir: 0, wantsAttack: true, wantsBlock: false, wantsKick: false };
  }
  return NO_ACTION;
}

function ninjaBehavior(self: Fighter, dist: number, dir: -1 | 1, canAttack: boolean): AiDecision {
  const range = self.preferredRange;
  if (dist > range) {
    return { moveDir: dir, wantsAttack: false, wantsBlock: false, wantsKick: false };
  }
  if (canAttack) {
    return { moveDir: 0, wantsAttack: true, wantsBlock: false, wantsKick: Math.random() < 0.4 };
  }
  // Skitter around unpredictably while waiting for cooldown.
  const jitter = Math.sin(self.animTimeMs / 120 + self.body.pos.x) > 0 ? 1 : -1;
  return { moveDir: jitter as -1 | 1, wantsAttack: false, wantsBlock: false, wantsKick: false };
}

function defensiveBehavior(self: Fighter, dist: number, dir: -1 | 1, canAttack: boolean): AiDecision {
  const range = self.preferredRange;
  if (dist > range) {
    return { moveDir: dir, wantsAttack: false, wantsBlock: Math.random() < 0.1, wantsKick: false };
  }
  if (canAttack && Math.random() < 0.6) {
    return { moveDir: 0, wantsAttack: true, wantsBlock: false, wantsKick: false };
  }
  return { moveDir: 0, wantsAttack: false, wantsBlock: Math.random() < 0.5, wantsKick: false };
}
