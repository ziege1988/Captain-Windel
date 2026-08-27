import type { AnimState, FacingDirection, StatBlock, StatModifiers, WeaponId } from '../types';
import { applyModifiers, defaultModifiers } from '../types';
import { createBody, type PhysicsBody } from '../physics/physics';

export type FighterKind = 'player' | 'enemy' | 'boss';

export interface StatusEffects {
  slowMult: number; // 1 = normal
  slowUntilMs: number;
  stunnedUntilMs: number;
  frozenUntilMs: number;
  dotPerSec: number;
  dotUntilMs: number;
  dotColor: string;
}

function freshStatus(): StatusEffects {
  return { slowMult: 1, slowUntilMs: 0, stunnedUntilMs: 0, frozenUntilMs: 0, dotPerSec: 0, dotUntilMs: 0, dotColor: '#7cb342' };
}

export type DeathPhase = 'none' | 'falling' | 'lying' | 'fart' | 'done';

/** Shared runtime state/behaviour for Captain Windel, normal enemies and
 * bosses. Kind-specific decision making (player input vs. AI) lives
 * outside this class; Fighter only tracks state and simple timers. */
export class Fighter {
  id: string;
  kind: FighterKind;
  name: string;
  body: PhysicsBody;
  facing: FacingDirection = 1;
  baseStats: StatBlock;
  modifiers: StatModifiers = defaultModifiers();
  health: number;
  anim: AnimState = 'idle';
  animTimeMs = 0;
  attackCooldownRemainingMs = 0;
  hitstunRemainingMs = 0;
  knockedDown = false;
  isDead = false;
  deathPhase: DeathPhase = 'none';
  deathTimerMs = 0;
  status: StatusEffects = freshStatus();
  weaponId: WeaponId = 'fists';
  equippedUpgradeIds: string[] = [];
  scale = 1;
  color = '#111111';
  accessories: string[] = [];
  width = 40;
  height = 90;
  invulnerableMs = 0;
  dodgeActiveWindowMs = 0;
  comboCounter = 0;
  comboTimerMs = 0;
  totalScore = 0;
  isBlocking = false;
  weaponFlashMs = 0;
  vomitTimerMs = 0;
  bananaCooldownMs = 0;

  // Enemy/boss-only metadata (unused for the player).
  aiType: string | null = null;
  preferredRange = 50;
  scoreValue = 0;
  bossDefId: string | null = null;
  bossAbilityCooldownsMs: Record<string, number> = {};
  bossTelegraph: { abilityId: string; remainingMs: number } | null = null;
  introPlayed = false;
  // How readable/eager this fighter's attacks are (section 7/8 of the
  // combat-start balance pass). Player keeps the snappy defaults; enemies
  // get these dialled in per-level by the engine when a level loads.
  attackTelegraphMs = 140;
  aggression = 1; // 0..1, chance to actually take an attack opportunity
  recoveryBonusMs = 0; // extra cooldown tacked onto attacks, beyond the weapon's own cadence

  constructor(id: string, kind: FighterKind, name: string, baseStats: StatBlock, x: number, groundY: number) {
    this.id = id;
    this.kind = kind;
    this.name = name;
    this.baseStats = baseStats;
    this.health = baseStats.maxHealth;
    this.body = createBody(x, groundY, groundY);
  }

  get stats(): StatBlock {
    return applyModifiers(this.baseStats, this.modifiers);
  }

  get maxHealth(): number {
    return this.stats.maxHealth;
  }

  get isFrozen(): boolean {
    return this.status.frozenUntilMs > 0;
  }
  get isStunned(): boolean {
    return this.status.stunnedUntilMs > 0;
  }
  get isSlowed(): boolean {
    return this.status.slowUntilMs > 0;
  }

  canAct(): boolean {
    return (
      !this.isDead &&
      this.hitstunRemainingMs <= 0 &&
      !this.knockedDown &&
      !this.isFrozen &&
      !this.isStunned
    );
  }

  setAnim(next: AnimState, force = false): void {
    if (this.anim === next && !force) return;
    this.anim = next;
    this.animTimeMs = 0;
  }

  updateTimers(dtMs: number): void {
    this.animTimeMs += dtMs;
    if (this.attackCooldownRemainingMs > 0) this.attackCooldownRemainingMs -= dtMs;
    if (this.hitstunRemainingMs > 0) this.hitstunRemainingMs -= dtMs;
    if (this.invulnerableMs > 0) this.invulnerableMs -= dtMs;
    if (this.dodgeActiveWindowMs > 0) this.dodgeActiveWindowMs -= dtMs;
    if (this.weaponFlashMs > 0) this.weaponFlashMs -= dtMs;
    if (this.vomitTimerMs > 0) this.vomitTimerMs -= dtMs;
    if (this.bananaCooldownMs > 0) this.bananaCooldownMs -= dtMs;

    if (this.status.slowUntilMs > 0) {
      this.status.slowUntilMs -= dtMs;
      if (this.status.slowUntilMs <= 0) this.status.slowMult = 1;
    }
    if (this.status.stunnedUntilMs > 0) this.status.stunnedUntilMs -= dtMs;
    if (this.status.frozenUntilMs > 0) this.status.frozenUntilMs -= dtMs;
    if (this.status.dotUntilMs > 0) this.status.dotUntilMs -= dtMs;

    if (this.comboTimerMs > 0) {
      this.comboTimerMs -= dtMs;
      if (this.comboTimerMs <= 0) this.comboCounter = 0;
    }
  }

  applySlow(mult: number, durationMs: number): void {
    this.status.slowMult = Math.min(this.status.slowMult, mult);
    this.status.slowUntilMs = Math.max(this.status.slowUntilMs, durationMs);
  }

  applyStun(durationMs: number): void {
    this.status.stunnedUntilMs = Math.max(this.status.stunnedUntilMs, durationMs);
  }

  applyFreeze(durationMs: number): void {
    this.status.frozenUntilMs = Math.max(this.status.frozenUntilMs, durationMs);
  }

  applyDot(perSec: number, durationMs: number, color: string): void {
    this.status.dotPerSec = perSec;
    this.status.dotUntilMs = Math.max(this.status.dotUntilMs, durationMs);
    this.status.dotColor = color;
  }

  effectiveMoveSpeed(): number {
    return this.stats.moveSpeed * this.status.slowMult;
  }
}
