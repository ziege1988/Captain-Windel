import type { AnimState, CapeColorId, CharacterId, FacingDirection, SpecialWeaponId, StatBlock, StatModifiers, WeaponId } from '../types';
import { applyModifiers, defaultModifiers } from '../types';
import { createBody, type PhysicsBody } from '../physics/physics';
import { usesTwoHands } from '../../data/weapons';
import { UPGRADES } from '../../data/upgrades';

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

// Banana pratfall beat lengths (ms). Deliberately generous: the brief asks
// for the enemy to slip, actually fall over, and then be briefly confused
// and unable to act — a beat the player can see and punish, not a flicker.
const SLIP_FALL_MS = 950;
const SLIP_GETUP_MS = 600;
const SLIP_DIZZY_MS = 1450;
const SLIP_TOTAL_MS = SLIP_FALL_MS + SLIP_GETUP_MS + SLIP_DIZZY_MS;

// The shield upgrade's own defence figure, read from the upgrade table so
// the two cannot drift apart if it is ever retuned.
const SHIELD_DEFENSE_ADD = UPGRADES.find((u) => u.id === 'shield')?.modifiers.defenseAdd ?? 0;

export function freshStatus(): StatusEffects {
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
  // Section 8 (quality update): one-time throwable bonus weapon granted at
  // campaign milestones — player-only, consumed on use (see
  // GameEngine.throwBonusWeapon).
  hasBonusWeapon = false;
  // Humorous effects pass: real banana-slip stun (legs-out-from-under +
  // circling cartoon birds above the head) instead of a generic stagger.
  // Blocks canAct() via hitstunRemainingMs, but is tracked separately so the
  // renderers know to draw the slip pose + birds rather than a plain stagger.
  dazedUntilMs = 0;
  // Banana pratfall sequencer. The old version was a single flat 'dazed'
  // pose for 1.1s, which read as a light stagger and was over before the
  // player could punish it. This drives a real three-beat cartoon fall —
  // skid along the ground, climb back up, then stand there dizzy with the
  // birds circling — see SLIP_* below and GameEngine's 'banana' hazard.
  slipSequenceMs = 0;
  // Toilet-paper wrap. The target is spun up in paper and completely unable
  // to act until it tears its way out; wrappedTotalMs is kept so the
  // renderers can drive the wrap-on / struggle / tear-free beats, and
  // wrapImmuneUntilMs stops the weapon from chaining wraps back-to-back
  // into a permanent lock.
  wrappedUntilMs = 0;
  wrappedTotalMs = 0;
  wrapImmuneUntilMs = 0;
  /** Set for one frame when a wrap expires, so the engine can play the
   * tear-free burst exactly once. Consumed by GameEngine. */
  wrapBreakPending = false;
  /** Throttles how often the AI will hop up onto the raised platform, so
   * chasing the player upstairs is a beat rather than a reflex. */
  platformJumpCooldownMs = 0;
  /** Which way the AI committed to walking off the platform. Held until it
   * is actually off, because re-deciding every frame from the player's
   * relative position makes the enemy jitter in place when the player is
   * standing directly underneath it. */
  platformExitDir: -1 | 0 | 1 = 0;
  /** How long the AI has been pressed up against an arena wall without
   * getting anywhere. Once it passes the threshold the engine commits the
   * fighter to walking back out (see wallEscapeMs), so a cornered enemy
   * never becomes a stationary punching bag. */
  wallStuckMs = 0;
  /** Remaining time on that committed walk out of the corner, and which
   * way it goes. Committed rather than re-decided per frame for the same
   * reason as platformExitDir. */
  wallEscapeMs = 0;
  wallEscapeDir: -1 | 0 | 1 = 0;
  /** Position at the last wall check and how long ago that was, so "not
   * getting anywhere" is an actual measurement over a window rather than a
   * guess from the animation or a single frame's velocity. */
  lastWallCheckX = 0;
  wallSampleMs = 0;
  // One-time bonus weapon: stork drops a diaper bomb on a chosen target.
  hasStorkBonusWeapon = false;
  // Persistent-progression pass: the single held shop-bought special
  // weapon slot (player-only) — bought with permanent coins, run-scoped
  // (lost, unspent, on Game Over), consumed the instant it's used. See
  // GameEngine.useSpecialWeapon.
  hasSpecialWeaponId: SpecialWeaponId | null = null;
  // Character-system overhaul: which of the four playable heroes this
  // fighter's rig/palette/hair/proportions should render as (player-only —
  // enemies/bosses leave this at the harmless default since renderFighter
  // only reads it when f.kind === 'player'), plus the player's own cosmetic
  // cape recolor (purely visual, never a stat — see appStore.equipCapeColor).
  characterId: CharacterId = 'windelmann';
  capeColorId: CapeColorId = 'red';

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

  // Boss idle-gesture state (section: boss individuality polish pass). Only
  // triggered while a boss isn't in attack range, so it never eats into
  // attack uptime/DPS (see GameEngine.updateEnemyAi) — purely a liveliness
  // flourish, not a balance change.
  gestureCooldownMs = 6000 + Math.random() * 6000;
  tauntActiveMs = 0;
  tauntVariant = 0;

  constructor(id: string, kind: FighterKind, name: string, baseStats: StatBlock, x: number, groundY: number) {
    this.id = id;
    this.kind = kind;
    this.name = name;
    this.baseStats = baseStats;
    this.health = baseStats.maxHealth;
    this.body = createBody(x, groundY, groundY);
  }

  /** Whether the carried shield is actually in use. A bow needs both hands,
   * so while one is equipped the shield is slung and gives nothing — it is
   * not drawn and its defence bonus does not count. */
  get shieldActive(): boolean {
    return this.accessories.includes('shield') && !usesTwoHands(this.weaponId);
  }

  get stats(): StatBlock {
    const stats = applyModifiers(this.baseStats, this.modifiers);
    if (this.accessories.includes('shield') && !this.shieldActive) {
      // Take the bonus back off rather than tracking it separately: the
      // modifier was folded in when the upgrade was picked up (see
      // applyUpgradeToPlayer), and reading the figure from the upgrade
      // itself keeps the two from drifting apart.
      const shieldDefense = SHIELD_DEFENSE_ADD;
      return { ...stats, defense: Math.max(0, stats.defense - shieldDefense) };
    }
    return stats;
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

  get isWrapped(): boolean {
    return this.wrappedUntilMs > 0;
  }

  canAct(): boolean {
    return (
      !this.isDead &&
      this.hitstunRemainingMs <= 0 &&
      !this.knockedDown &&
      !this.isFrozen &&
      !this.isStunned &&
      !this.isWrapped
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
    if (this.dazedUntilMs > 0) this.dazedUntilMs -= dtMs;
    this.tickSlipSequence(dtMs);
    if (this.wrapImmuneUntilMs > 0) this.wrapImmuneUntilMs -= dtMs;
    if (this.platformJumpCooldownMs > 0) this.platformJumpCooldownMs -= dtMs;
    if (this.wrappedUntilMs > 0) {
      this.wrappedUntilMs -= dtMs;
      if (this.wrappedUntilMs <= 0) {
        this.wrappedUntilMs = 0;
        this.wrappedTotalMs = 0;
        this.wrapBreakPending = true;
        if (this.anim === 'wrapped') this.setAnim('idle', true);
      }
    }

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

  /** Starts the banana pratfall: the fighter is out of the fight for the
   * whole sequence (hitstun covers it), lying flat on the ground first,
   * then getting back up, then standing dizzy with circling birds. */
  startSlip(): void {
    this.slipSequenceMs = SLIP_TOTAL_MS;
    this.hitstunRemainingMs = Math.max(this.hitstunRemainingMs, SLIP_TOTAL_MS);
    this.dazedUntilMs = 0; // the birds only join once the fighter is upright again
    this.setAnim('fallen', true);
  }

  /** Advances the pratfall and swaps the pose on each beat boundary. Forced
   * setAnim calls only ever happen on an actual transition, so each pose
   * plays from its own t=0 and none of them restart every frame. */
  private tickSlipSequence(dtMs: number): void {
    if (this.slipSequenceMs <= 0) return;
    this.slipSequenceMs -= dtMs;
    if (this.slipSequenceMs <= 0) {
      this.slipSequenceMs = 0;
      this.dazedUntilMs = 0;
      this.setAnim('idle', true);
      return;
    }
    const elapsed = SLIP_TOTAL_MS - this.slipSequenceMs;
    const next: AnimState = elapsed < SLIP_FALL_MS
      ? 'fallen'
      : elapsed < SLIP_FALL_MS + SLIP_GETUP_MS ? 'gettingUp' : 'dazed';
    if (this.anim !== next) this.setAnim(next, true);
    // Birds circle the head only while the fighter is actually standing —
    // during the flattened beats the whole rig is drawn rotated on its
    // side, and the overlay would rotate along with it.
    this.dazedUntilMs = next === 'dazed' ? this.slipSequenceMs : 0;
  }

  /** Spins this fighter up in toilet paper for `durationMs`. No-op while it
   * is still wrap-immune from the last one, so the weapon can open a window
   * but never chain into a permanent lock. */
  applyWrap(durationMs: number): boolean {
    if (this.isDead || this.wrappedUntilMs > 0 || this.wrapImmuneUntilMs > 0) return false;
    this.wrappedUntilMs = durationMs;
    this.wrappedTotalMs = durationMs;
    this.wrapImmuneUntilMs = durationMs + 3000;
    this.body.vel.x = 0;
    this.setAnim('wrapped', true);
    return true;
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
