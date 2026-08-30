import type { SuperpowerId, WeaponDef, WeaponId } from '../types';
import { Fighter, freshStatus } from '../entities/Fighter';
import { createBoss, createEnemy, createPlayer } from '../entities/factory';
import { ENEMIES } from '../../data/enemies';
import { BOSSES } from '../../data/bosses';
import { ARENAS } from '../../data/arenas';
import { getLevel } from '../../data/levels';
import { BALANCE, enemyAggression, enemyRecoveryBonusMs, enemyTelegraphMs, readyDurationMs } from '../../data/balance';
import { WEAPONS } from '../../data/weapons';
import { SUPERPOWERS } from '../../data/superpowers';
import type { SaveData } from '../../storage/saveData';
import { useAppStore } from '../../state/appStore';
import { decideAiAction } from '../ai/aiTypes';
import { tickBossAbilities } from '../ai/bossBehavior';
import { applyKnockback, distance, stepPhysics } from '../physics/physics';
import { ParticleSystem } from '../effects/particles';
import { HitStop, ScreenShake } from '../effects/screenEffects';
import { audio } from '../audio/audioManager';
import { renderArena, type ArenaLayout } from './renderArena';
import { renderFighter } from './renderFighter';
import { renderBoss } from './renderBoss';
import { applyDefense, resolveHit, scoreForHit } from './combatMath';

export type GamePhase = 'ready' | 'bossIntro' | 'playing' | 'levelWon' | 'gameOver' | 'paused' | 'arenaTransition';

export interface HudState {
  phase: GamePhase;
  playerHealth: number;
  playerMaxHealth: number;
  enemyHealth: number;
  enemyMaxHealth: number;
  enemyName: string;
  isBossFight: boolean;
  score: number;
  combo: number;
  level: number;
  chaosMode: boolean;
  livesRemaining: number;
  maxLives: number;
  hasBonusWeapon: boolean;
  airSupportUnlocked: boolean;
  airSupportCooldownMs: number;
  hasStorkBonusWeapon: boolean;
  weaponId: WeaponId;
  bossIntroText: string;
  levelWonInfo: { score: number; leveledUp: boolean } | null;
  gameOverSummary: { score: number; level: number; kills: number; bosses: number; combo: number } | null;
  superpowerCooldowns: Record<SuperpowerId, number>;
  toast: string | null;
}

interface Projectile {
  id: number;
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  owner: Fighter;
  weaponId: WeaponId;
  damageDealt: boolean;
  returning?: boolean;
  life: number;
}

interface Hazard {
  id: number;
  kind: 'egg' | 'balloon' | 'banana' | 'bonusBomb' | 'fireWave' | 'frostNova' | 'diaperBomb';
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  timer: number;
  radius: number;
  owner: 'player' | 'enemy';
  triggered: boolean;
}

// Humorous effects pass: the stork-with-baby flying entity shared by the
// rare player-triggered "air support" ability (pure distraction, no damage)
// and the separate one-time "Storch & Baby" bonus weapon (drops a real
// diaper-bomb hazard). One flight path system, two different payloads —
// keeps the flight/rendering code from being duplicated between them.
type StorkVariant = 'crossFly' | 'circle';
type StorkMode = 'airSupport' | 'bonusWeapon';

interface StorkFlight {
  variant: StorkVariant;
  mode: StorkMode;
  elapsedMs: number;
  totalMs: number;
  dir: 1 | -1; // entry/travel side
  targetX: number; // enemy x captured when the flight starts — a fixed
  // flight path reads clearer than a homing stork chasing a moving target.
  flightY: number;
  effectFired: boolean;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Section 8 (quality update): campaign levels that grant the player a
// one-time throwable bonus weapon — a handful of deliberate milestones,
// not every level, and never boss levels (so the reward doesn't compete
// for attention with a boss intro). Persisted per-run in
// save.bonusWeaponMilestonesClaimed so it's only ever granted once.
const BONUS_WEAPON_MILESTONE_LEVELS = [8, 22, 38];

// Humorous effects pass: a separate, later-game milestone list for the
// "Storch & Baby" diaper-bomb bonus weapon — deliberately rarer/later than
// the plain bonus bomb above, per the requested early/mid/late/very-late
// progression (normal weapons -> first bonus weapons -> air support ->
// especially strong/rare air attacks).
const STORK_BONUS_MILESTONE_LEVELS = [30, 44];

// Section 6 (polish pass): a short-lived, floating comic-book-style sound
// effect ("Faaarrt…") spawned next to a fighter's rear on every fart.
interface ComicText {
  text: string;
  x: number;
  y: number;
  ageMs: number;
  lifeMs: number;
  color: string;
}

let hazardCounter = 0;
let projectileCounter = 0;

// Fallback size used only until the canvas is actually mounted/measured;
// resize() immediately replaces this with the real, undistorted viewport
// size so the arena always fits the screen without stretching (section 5/40).
const FALLBACK_WIDTH = 390;
const FALLBACK_HEIGHT = 664;
const ARENA_SIDE_PADDING = 34;
const GROUND_FRACTION = 0.64;
// The arena is rendered zoomed out a bit: the "world" (the coordinate
// space fighters/hazards/physics actually live in, i.e. everything on
// `this.layout`) is 1/ARENA_ZOOM times bigger than the physical screen,
// and the canvas transform compresses it back down to fit — so there's
// more world-space to move around in (more room, more reachable distance
// before weapon ranges kick in) while the whole arena still always fits
// entirely on screen with no side-scrolling camera at all.
const ARENA_ZOOM = 0.82;

export class GameEngine {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private rafId = 0;
  private lastTime = 0;
  private accumStartTime = performance.now();

  private layout: ArenaLayout = {
    width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT,
    groundY: FALLBACK_HEIGHT * GROUND_FRACTION,
    minX: ARENA_SIDE_PADDING, maxX: FALLBACK_WIDTH - ARENA_SIDE_PADDING,
  };

  player: Fighter;
  enemy: Fighter | null = null;
  levelIndex: number;
  isBossLevel = false;
  bossDefId: string | null = null;
  arenaId = 'meadow';

  phase: GamePhase = 'ready';
  private phaseBeforePause: GamePhase = 'ready';
  bossIntroTimerMs = 0;
  readyTimerMs = 0;
  levelWonHandled = false;

  score = 0;
  combo = 0;
  enemiesDefeated = 0;
  bossesDefeated = 0;
  highestCombo = 0;
  chaosMode = false;

  // Section 10 (3-lives quality update): one GameEngine instance = one run,
  // so this resets to a fresh 3 every time the player starts or continues
  // from the main menu. Dying with attempts left heals and retries the
  // current level (see handlePlayerDefeated) instead of ending the run.
  static readonly MAX_LIVES = 3;
  livesRemaining = GameEngine.MAX_LIVES;

  // Humorous effects pass: air support is a rare, player-triggered
  // distraction — unlocked from this campaign level onward, gated further
  // by a long cooldown so it stays a special-occasion tool, never a
  // routine every-fight button.
  static readonly AIR_SUPPORT_UNLOCK_LEVEL = 18;
  static readonly AIR_SUPPORT_COOLDOWN_MS = 42000;
  airSupportCooldownMs = 0;
  storkFlight: StorkFlight | null = null;

  particles = new ParticleSystem();
  shake = new ScreenShake();
  hitStop = new HitStop();

  projectiles: Projectile[] = [];
  hazards: Hazard[] = [];
  comicTexts: ComicText[] = [];

  superpowerCooldowns: Map<SuperpowerId, number> = new Map();
  save: SaveData;
  toastMessage: string | null = null;
  toastTimerMs = 0;

  private inputMoveDir: -1 | 0 | 1 = 0;
  private wantsBlock = false;
  private lastHudEmitMs = 0;

  onHud: (hud: HudState) => void;

  constructor(canvas: HTMLCanvasElement, save: SaveData, startLevel: number, onHud: (hud: HudState) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.save = save;
    this.onHud = onHud;
    this.levelIndex = startLevel;
    this.chaosMode = startLevel > BALANCE.campaign.totalLevels;
    this.player = createPlayer(this.layout.minX + 120, this.layout.groundY, save);
    this.resize();
    this.loadLevel(this.levelIndex);
  }

  /** Sizes the canvas backing buffer 1:1 to its actual on-screen box (in
   * CSS pixels, scaled by devicePixelRatio) so the arena is never
   * non-uniformly stretched — it always renders at the real aspect ratio
   * of the device, portrait phone or wide desktop alike. */
  resize(): void {
    const container = this.canvas.parentElement;
    const cssWidth = Math.round(container?.clientWidth || window.innerWidth || FALLBACK_WIDTH);
    const cssHeight = Math.round(container?.clientHeight || window.innerHeight || FALLBACK_HEIGHT);
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.ctx.setTransform(dpr * ARENA_ZOOM, 0, 0, dpr * ARENA_ZOOM, 0, 0);

    const worldWidth = cssWidth / ARENA_ZOOM;
    const worldHeight = cssHeight / ARENA_ZOOM;
    this.layout = {
      width: worldWidth,
      height: worldHeight,
      groundY: worldHeight * GROUND_FRACTION,
      minX: ARENA_SIDE_PADDING,
      maxX: worldWidth - ARENA_SIDE_PADDING,
    };

    for (const f of [this.player, this.enemy]) {
      if (!f) continue;
      f.body.groundY = this.layout.groundY;
      if (f.body.grounded) f.body.pos.y = this.layout.groundY;
      f.body.pos.x = Math.min(this.layout.maxX - 20, Math.max(this.layout.minX + 20, f.body.pos.x));
    }
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  start(): void {
    this.lastTime = performance.now();
    const loop = (t: number) => {
      const rawDt = Math.min(40, t - this.lastTime);
      this.lastTime = t;
      this.tick(rawDt);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  setPaused(paused: boolean): void {
    if (paused) {
      if (this.phase === 'gameOver' || this.phase === 'paused') return;
      this.phaseBeforePause = this.phase;
      this.phase = 'paused';
    } else if (this.phase === 'paused') {
      this.phase = this.phaseBeforePause;
    }
  }

  // ---------------------------------------------------------------------
  // Level management
  // ---------------------------------------------------------------------

  private loadLevel(index: number): void {
    const level = getLevel(index);
    this.arenaId = level.arenaId;
    this.isBossLevel = level.isBoss;
    this.bossDefId = level.bossId ?? null;
    this.projectiles = [];
    this.hazards = [];
    this.storkFlight = null;

    // Section 1: start with clear daylight between the two fighters rather
    // than nearly toe-to-toe, so the opening seconds actually feel like a
    // stand-off instead of an ambush.
    const innerWidth = this.layout.maxX - this.layout.minX;
    const startMargin = innerWidth * 0.15;

    this.player.body.pos.x = this.layout.minX + startMargin;
    this.player.body.pos.y = this.layout.groundY;
    this.player.body.vel = { x: 0, y: 0 };
    this.player.facing = 1;
    this.player.setAnim('idle', true);

    const enemyX = this.layout.maxX - startMargin;
    if (level.isBoss && level.bossId) {
      const def = BOSSES[level.bossId];
      this.enemy = createBoss(def, enemyX, this.layout.groundY, level.difficultyScale, level.sizeScale);
      this.enemy.setAnim('bossIntro', true);
      this.phase = 'bossIntro';
      this.bossIntroTimerMs = 2600;
      audio.play('bossIntro');
      audio.vibrate([40, 60, 80]);
    } else {
      const def = ENEMIES[level.enemyId] ?? ENEMIES.standard;
      this.enemy = createEnemy(def, enemyX, this.layout.groundY, level.difficultyScale, level.sizeScale);
      this.enemy.setAnim('idle', true);
      this.phase = 'ready';
      this.readyTimerMs = readyDurationMs(index);
      this.showToast('BEREIT?', this.readyTimerMs);
    }
    this.enemy.facing = -1;

    // Section 6/7/8: how eager, how telegraphed and how quick-to-recover
    // this level's enemy/boss is — tapers up over the campaign instead of
    // every fighter being maximally aggressive from level 1.
    this.enemy.aggression = enemyAggression(index, level.isBoss);
    this.enemy.attackTelegraphMs = enemyTelegraphMs(index, level.isBoss);
    this.enemy.recoveryBonusMs = enemyRecoveryBonusMs(index, level.isBoss);

    // Section 8 (quality update): a handful of deliberate campaign
    // milestones grant a one-time throwable bonus weapon — announced right
    // as the level starts (so the player sees it before they'd need it),
    // never replacing the normal weapon, persisted so it's only ever
    // granted once per milestone per run.
    if (BONUS_WEAPON_MILESTONE_LEVELS.includes(index) && !this.save.bonusWeaponMilestonesClaimed.includes(index)) {
      this.player.hasBonusWeapon = true;
      useAppStore.getState().claimBonusWeaponMilestone(index);
      this.showToast('🎁 BONUS-WAFFE ERHALTEN!', 2000);
    }

    // Humorous effects pass: same one-time-grant pattern, later in the
    // campaign, for the "Storch & Baby" diaper-bomb bonus weapon.
    if (STORK_BONUS_MILESTONE_LEVELS.includes(index) && !this.save.storkBonusMilestonesClaimed.includes(index)) {
      this.player.hasStorkBonusWeapon = true;
      useAppStore.getState().claimStorkBonusMilestone(index);
      this.showToast('🦢👶 STORCH & BABY ERHALTEN!', 2000);
    }

    this.levelWonHandled = false;
  }

  proceedToNextLevel(): void {
    this.levelIndex += 1;
    if (this.levelIndex > BALANCE.campaign.totalLevels) this.chaosMode = true;
    this.loadLevel(this.levelIndex);
  }

  restartFromLevel(index: number): void {
    this.levelIndex = index;
    this.chaosMode = index > BALANCE.campaign.totalLevels;
    this.score = 0;
    this.combo = 0;
    this.enemiesDefeated = 0;
    this.bossesDefeated = 0;
    this.highestCombo = 0;
    this.player.health = this.player.maxHealth;
    this.player.isDead = false;
    this.player.deathPhase = 'none';
    this.loadLevel(this.levelIndex);
  }

  // ---------------------------------------------------------------------
  // Input (called by React touch controls)
  // ---------------------------------------------------------------------

  setMoveDir(dir: -1 | 0 | 1): void {
    this.inputMoveDir = dir;
  }

  jump(): void {
    if (this.phase !== 'playing' && this.phase !== 'ready') return;
    if (!this.player.canAct() || !this.player.body.grounded) return;
    this.player.body.vel.y = -820;
    this.player.body.grounded = false;
    this.player.setAnim('jump', true);
    audio.play('jump');
  }

  attack(): void {
    if (this.phase !== 'playing' || !this.player.canAct()) return;
    if (this.player.attackCooldownRemainingMs > 0) return;
    this.startAttack(this.player, false);
  }

  kick(): void {
    if (this.phase !== 'playing' || !this.player.canAct()) return;
    if (this.player.attackCooldownRemainingMs > 0) return;
    this.startAttack(this.player, true);
  }

  blockStart(): void {
    this.wantsBlock = true;
  }
  blockEnd(): void {
    this.wantsBlock = false;
  }

  dodge(): void {
    if (this.phase !== 'playing' || !this.player.canAct()) return;
    this.player.setAnim('dodge', true);
    this.player.invulnerableMs = 320;
    this.player.dodgeActiveWindowMs = 320;
    const dir = this.enemy ? Math.sign(this.enemy.body.pos.x - this.player.body.pos.x) || 1 : -1;
    this.player.body.vel.x += -dir * 260;
    audio.play('dodge');
  }

  placeBananaPeel(): void {
    if (this.phase !== 'playing') return;
    if (!this.player.equippedUpgradeIds.includes('banana_peel')) return;
    if (this.player.bananaCooldownMs > 0) return;
    this.player.bananaCooldownMs = 7000;
    hazardCounter += 1;
    this.hazards.push({
      id: hazardCounter,
      kind: 'banana',
      pos: { x: this.player.body.pos.x + this.player.facing * 40, y: this.layout.groundY },
      vel: { x: 0, y: 0 },
      timer: 9000,
      radius: 26,
      owner: 'player',
      triggered: false,
    });
  }

  // Section 8 (quality update): the one-time milestone reward — a real
  // thrown weapon, not another button that silently does nothing. A short
  // wind-up (reusing the 'attack' pose so the throw reads as one motion
  // with the arm) then an arcing bomb that explodes on hitting the enemy
  // or after its fuse runs out, dealing a real AoE hit — separate from and
  // on top of whatever weapon is currently equipped, consumed after one use.
  throwBonusWeapon(): void {
    if (this.phase !== 'playing' || !this.player.canAct()) return;
    if (!this.player.hasBonusWeapon) return;
    this.player.hasBonusWeapon = false;
    this.player.setAnim('attack', true);
    this.player.attackCooldownRemainingMs = 550;
    this.player.weaponFlashMs = 120;
    audio.play('weaponSwing');
    const dir = this.player.facing;
    const throwX = this.player.body.pos.x;
    const throwY = this.player.body.groundY - 50;
    window.setTimeout(() => {
      if (this.phase !== 'playing' && this.phase !== 'levelWon') return;
      hazardCounter += 1;
      this.hazards.push({
        id: hazardCounter,
        kind: 'bonusBomb',
        pos: { x: throwX + dir * 30, y: throwY },
        vel: { x: dir * 480, y: -300 },
        timer: 900,
        radius: 75,
        owner: 'player',
        triggered: false,
      });
    }, 150);
  }

  // Humorous effects pass: air support is a rare, announced distraction —
  // never a normal-fight tool. Locked out until the campaign level unlock,
  // gated by a long cooldown, and it never deals damage: a stork flies
  // through (or circles above) the arena and briefly surprises/distracts
  // the boss, giving a short tactical opening rather than an automatic win.
  useAirSupport(): void {
    if (this.phase !== 'playing') return;
    if (this.levelIndex < GameEngine.AIR_SUPPORT_UNLOCK_LEVEL) return;
    if (this.airSupportCooldownMs > 0) return;
    if (!this.enemy || this.enemy.isDead) return;
    if (this.storkFlight) return;
    this.airSupportCooldownMs = GameEngine.AIR_SUPPORT_COOLDOWN_MS;
    this.showToast('🦢 LUFTUNTERSTÜTZUNG IM ANFLUG!', 1400);
    window.setTimeout(() => {
      if (this.phase !== 'playing' && this.phase !== 'levelWon') return;
      this.startStorkFlight('airSupport');
    }, 900);
  }

  // The one-time "Storch & Baby" bonus weapon: same flight system as air
  // support, but this pass drops a real diaper-bomb hazard on the target
  // instead of a pure distraction — a tactical bonus, not a normal attack,
  // consumed on use.
  throwStorkBonusWeapon(): void {
    if (this.phase !== 'playing') return;
    if (!this.player.hasStorkBonusWeapon) return;
    if (this.storkFlight) return;
    this.player.hasStorkBonusWeapon = false;
    this.showToast('🦢👶 STORCH IM ANFLUG!', 1400);
    window.setTimeout(() => {
      if (this.phase !== 'playing' && this.phase !== 'levelWon') return;
      this.startStorkFlight('bonusWeapon');
    }, 700);
  }

  private startStorkFlight(mode: StorkMode): void {
    if (!this.enemy || this.enemy.isDead) return;
    // The bonus weapon always flies a clean straight pass over the target
    // (it needs to reliably drop its payload); air support randomly picks
    // between the two variants for variety.
    const variant: StorkVariant = mode === 'bonusWeapon'
      ? 'crossFly'
      : (Math.random() < 0.5 ? 'crossFly' : 'circle');
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    this.storkFlight = {
      variant,
      mode,
      elapsedMs: 0,
      totalMs: variant === 'crossFly' ? 2800 : 2600,
      dir,
      targetX: this.enemy.body.pos.x,
      flightY: this.layout.groundY - this.layout.height * 0.4,
      effectFired: false,
    };
    audio.play('storkFlyby');
  }

  /** World-space position of the currently flying stork, given its
   * elapsed/total progress. crossFly flies a straight pass edge-to-edge;
   * circle flies in, loops twice above the target, then flies back out the
   * same side — both are real traversed paths, never a fade-in-place. */
  private storkPosition(flight: StorkFlight): { x: number; y: number } {
    const p = Math.min(1, flight.elapsedMs / flight.totalMs);
    const margin = 70;
    if (flight.variant === 'crossFly') {
      const startX = flight.dir > 0 ? this.layout.minX - margin : this.layout.maxX + margin;
      const endX = flight.dir > 0 ? this.layout.maxX + margin : this.layout.minX - margin;
      return {
        x: lerp(startX, endX, p),
        y: flight.flightY + Math.sin(p * Math.PI * 2) * 10,
      };
    }
    const entryX = flight.dir > 0 ? this.layout.minX - margin : this.layout.maxX + margin;
    const inEnd = 0.22;
    const outStart = 0.78;
    if (p < inEnd) {
      const q = p / inEnd;
      return { x: lerp(entryX, flight.targetX, q), y: lerp(flight.flightY, flight.flightY - 12, q) };
    }
    if (p > outStart) {
      const q = (p - outStart) / (1 - outStart);
      return { x: lerp(flight.targetX, entryX, q), y: lerp(flight.flightY - 12, flight.flightY, q) };
    }
    const loopP = (p - inEnd) / (outStart - inEnd);
    const angle = loopP * Math.PI * 4;
    const radius = 55;
    return {
      x: flight.targetX + Math.cos(angle) * radius,
      y: flight.flightY - 12 + Math.sin(angle) * radius * 0.35,
    };
  }

  private updateStork(dtMs: number): void {
    const flight = this.storkFlight;
    if (!flight) return;
    flight.elapsedMs += dtMs;
    const p = flight.elapsedMs / flight.totalMs;

    // Fire the payload once, right as the stork is over (or looping above)
    // the target — never before it visibly arrives.
    if (!flight.effectFired) {
      const { x } = this.storkPosition(flight);
      const overTarget = flight.variant === 'crossFly'
        ? Math.abs(x - flight.targetX) < 45
        : p > 0.28;
      if (overTarget) {
        flight.effectFired = true;
        if (flight.mode === 'airSupport') {
          this.triggerAirSupportEffect();
        } else {
          this.dropDiaperBomb(flight);
        }
      }
    }

    if (p >= 1) this.storkFlight = null;
  }

  private triggerAirSupportEffect(): void {
    if (!this.enemy || this.enemy.isDead) return;
    const enemy = this.enemy;
    audio.play('surprise');
    this.particles.burst({ x: enemy.body.pos.x, y: enemy.body.groundY - 95 }, 12, {
      color: '#ffffff', shape: 'circle', size: 4, life: 0.5, maxLife: 0.5, gravity: -30,
    });
    this.spawnComicText('?!', enemy.body.pos.x, enemy.body.groundY - 140, '#fff59d');
    enemy.setAnim('surprised', true);
    // Short tactical distraction, not a stun-lock — matches the same scale
    // as a heavy hit's stagger window, never longer.
    const distractMs = 850;
    enemy.hitstunRemainingMs = Math.max(enemy.hitstunRemainingMs, distractMs);
    this.showToast('Der Storch lenkt ab!', 1000);
  }

  private dropDiaperBomb(flight: StorkFlight): void {
    const { x, y } = this.storkPosition(flight);
    hazardCounter += 1;
    this.hazards.push({
      id: hazardCounter,
      kind: 'diaperBomb',
      pos: { x, y },
      vel: { x: 0, y: 60 },
      timer: 1400,
      radius: 46,
      owner: 'player',
      triggered: false,
    });
    audio.play('weaponSwing');
  }

  useSuperpower(id: SuperpowerId): void {
    if (this.phase !== 'playing') return;
    if (!this.save.unlockedSuperpowers.includes(id)) return;
    if ((this.superpowerCooldowns.get(id) ?? 0) > 0) return;
    const def = SUPERPOWERS[id];
    this.superpowerCooldowns.set(id, def.cooldownMs);
    this.player.setAnim('fart', true);
    // Section (quality pass): covers the full announce -> bend -> held-
    // release -> return motion (see the 'fart' pose in renderFighter.ts,
    // now a full 1s so the bend is slow enough to actually read) so the
    // player isn't snapped back to idle mid-animation.
    this.player.hitstunRemainingMs = 1000;
    audio.play('superpower');
    audio.vibrate([30, 40, 60, 40, 90]);
    this.shake.add(0.5);

    // Fires right in the held-release beat of the pose (bend completes at
    // 0.5s, release beat runs to 0.68s).
    window.setTimeout(() => this.fireSuperpower(id), 600);
  }

  private fireSuperpower(id: SuperpowerId): void {
    if (!this.enemy || this.enemy.isDead) return;
    const def = SUPERPOWERS[id];
    // Section (quality pass): each power gets its own base shape instead of
    // every non-nuclear power sharing the same puffy "cloud" blob — chili
    // specifically must never show a gas cloud, only fire. towardFacing=true
    // so the effect is clearly aimed at the enemy — the character is
    // oriented at them, not puffing off into empty space.
    const baseShape = id === 'nuclear' ? 'ring' : id === 'chili' ? 'drop' : 'cloud';
    const baseSizeMult = id === 'chili' ? 1.7 : 1.35;
    this.triggerFartEffect(this.player, def.color, baseSizeMult, baseShape, true);
    const dirAngle = this.player.facing > 0 ? 0 : Math.PI;
    this.fireSuperpowerVisual(
      id,
      this.player.body.pos.x + this.player.facing * 42,
      this.player.body.groundY - 55,
      dirAngle,
    );

    const hitsEnemy = distance(this.player.body.pos, this.enemy.body.pos) < 340;
    if (!hitsEnemy) return;

    const dmg = applyDefense(def.damage, this.enemy.stats.defense);
    this.dealDamageTo(this.enemy, dmg, false);
    this.addScore(BALANCE.score.superpowerHit);

    // Humorous effects pass (point 7): every elemental power gets its own
    // brief, visible reaction on top of its mechanical effect — not just a
    // status overlay — so a hit clearly reads as "the enemy just got hit by
    // fire/ice/gas" rather than a silent stat change. Kept short (a single
    // flinch beat) so it stays a readable reaction, never an extra stun.
    switch (id) {
      case 'gasCloud':
        this.enemy.applySlow(0.55, def.effectDurationMs);
        this.enemy.setAnim('hit', true);
        this.enemy.hitstunRemainingMs = Math.max(this.enemy.hitstunRemainingMs, 260);
        applyKnockback(this.enemy.body, this.player.facing, 60, 0.3);
        this.spawnComicText('Pfui!', this.enemy.body.pos.x, this.enemy.body.groundY - 130, '#aed581');
        break;
      case 'chili':
        this.enemy.applyDot(6, def.effectDurationMs, '#ff5722');
        // Fire: a real backward flinch, not just a damage-over-time tick —
        // the enemy visibly backs away from the flame.
        this.enemy.setAnim('knockback', true);
        this.enemy.hitstunRemainingMs = Math.max(this.enemy.hitstunRemainingMs, 320);
        applyKnockback(this.enemy.body, this.player.facing, 140, 0.35);
        break;
      case 'ice':
        this.enemy.applyFreeze(def.effectDurationMs);
        this.enemy.setAnim('hit', true);
        this.enemy.hitstunRemainingMs = Math.max(this.enemy.hitstunRemainingMs, 260);
        break;
      case 'electro':
        this.enemy.applyStun(def.effectDurationMs);
        break;
      case 'tornado':
        applyKnockback(this.enemy.body, this.player.facing, 520, 0.6);
        this.enemy.setAnim('knockback', true);
        this.enemy.hitstunRemainingMs = 700;
        break;
      case 'nuclear':
        applyKnockback(this.enemy.body, this.player.facing, 700, 0.5);
        this.enemy.setAnim('knockback', true);
        this.enemy.hitstunRemainingMs = 900;
        this.shake.add(0.9);
        this.hitStop.trigger(160);
        break;
    }
  }

  cycleWeapon(): void {
    const unlocked = this.save.unlockedWeapons;
    if (unlocked.length <= 1) return;
    const idx = unlocked.indexOf(this.player.weaponId);
    this.player.weaponId = unlocked[(idx + 1) % unlocked.length];
    audio.play('menuTap');
  }

  // ---------------------------------------------------------------------
  // Attack execution shared by player + enemies
  // ---------------------------------------------------------------------

  private startAttack(f: Fighter, isKick: boolean): void {
    f.setAnim(isKick ? 'kick' : 'attack', true);
    const weapon = WEAPONS[isKick ? 'fists' : f.weaponId];
    const cooldownBase = isKick ? 480 : 520 / weapon.attackSpeedMult;
    f.attackCooldownRemainingMs = cooldownBase / Math.max(0.4, f.stats.attackSpeed);
    // Section 7/9: enemies get extra recovery on top of their raw weapon
    // cadence so they can't just chain-attack the player with no opening.
    if (f.kind !== 'player') f.attackCooldownRemainingMs += f.recoveryBonusMs;
    (f as Fighter & { pendingHitApplied?: boolean }).pendingHitApplied = false;
    f.weaponFlashMs = 120;
    audio.play('weaponSwing');

    const shape = weapon.shape;
    if (shape === 'ranged' || shape === 'boomerang') {
      window.setTimeout(() => this.spawnProjectile(f, shape), 160);
    }
  }

  private spawnProjectile(owner: Fighter, shape: 'ranged' | 'boomerang'): void {
    if (owner.isDead) return;
    projectileCounter += 1;
    const weapon = WEAPONS[owner.weaponId];
    this.projectiles.push({
      id: projectileCounter,
      pos: { x: owner.body.pos.x + owner.facing * 30, y: this.layout.groundY - 50 },
      vel: { x: owner.facing * (weapon.projectileSpeed ?? 600), y: 0 },
      owner,
      weaponId: owner.weaponId,
      damageDealt: false,
      returning: false,
      life: 2.2,
    });
    audio.play('weaponSwing');
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  private tick(rawDtMs: number): void {
    const timeScale = this.hitStop.update(rawDtMs);
    const dtMs = rawDtMs * timeScale;
    const dtSec = dtMs / 1000;

    if (this.phase === 'ready') {
      this.updateReadyPhase(rawDtMs, dtSec);
    } else if (this.phase === 'bossIntro') {
      this.bossIntroTimerMs -= rawDtMs;
      this.enemy?.updateTimers(rawDtMs);
      if (this.bossIntroTimerMs <= 0 && this.enemy) {
        this.enemy.introPlayed = true;
        this.enemy.setAnim('idle', true);
        this.phase = 'playing';
      }
    } else if (this.phase === 'playing') {
      this.updatePlaying(dtMs, dtSec);
    }

    this.shake.update(rawDtMs / 1000);
    this.particles.update(dtSec);
    this.updateComicTexts(rawDtMs);

    if (this.toastTimerMs > 0) {
      this.toastTimerMs -= rawDtMs;
      if (this.toastTimerMs <= 0) this.toastMessage = null;
    }

    this.render(dtSec);
    this.emitHud(rawDtMs);
  }

  /** Section 1/2: brief pre-fight protection. The player can already move
   * around and get a feel for the arena; the enemy stands its ground and
   * neither side can land a hit yet (attack/kick/dodge/block simply no-op
   * while phase !== 'playing', see the action methods below). Once the
   * timer runs out combat opens for real and the enemy starts approaching. */
  private updateReadyPhase(rawDtMs: number, dtSec: number): void {
    this.readyTimerMs -= rawDtMs;
    const player = this.player;
    const enemy = this.enemy;

    player.updateTimers(rawDtMs);
    if (enemy) enemy.updateTimers(rawDtMs);

    if (player.canAct()) {
      const speed = player.effectiveMoveSpeed();
      player.body.vel.x = this.inputMoveDir * speed;
      if (this.inputMoveDir !== 0) {
        player.facing = this.inputMoveDir;
        if (player.anim !== 'block') player.setAnim(player.body.grounded ? 'run' : player.anim);
      } else if (player.anim === 'run') {
        player.setAnim('idle');
      }
    }
    if (!player.body.grounded && player.canAct()) {
      player.setAnim(player.body.vel.y < 0 ? 'jump' : 'fall');
    }
    stepPhysics(player.body, dtSec, this.layout.minX, this.layout.maxX);
    if (player.body.grounded && player.body.vel.y === 0 && (player.anim === 'jump' || player.anim === 'fall')) {
      player.setAnim('idle');
    }

    if (enemy) {
      enemy.facing = player.body.pos.x >= enemy.body.pos.x ? 1 : -1;
      stepPhysics(enemy.body, dtSec, this.layout.minX, this.layout.maxX);
    }

    if (this.readyTimerMs <= 0) {
      this.phase = 'playing';
      this.showToast('FIGHT!', 900);
      audio.play('menuTap');
    }
  }

  private updatePlaying(dtMs: number, dtSec: number): void {
    const player = this.player;
    const enemy = this.enemy;

    player.updateTimers(dtMs);
    if (enemy) enemy.updateTimers(dtMs);

    // --- player movement / actions ---
    if (player.canAct() && !player.isDead) {
      player.isBlocking = this.wantsBlock && this.inputMoveDir === 0;
      if (player.isBlocking) player.setAnim('block');
      const speed = player.effectiveMoveSpeed();
      player.body.vel.x = this.inputMoveDir * speed;
      if (this.inputMoveDir !== 0) {
        player.facing = this.inputMoveDir;
        if (player.anim !== 'block') player.setAnim(player.body.grounded ? 'run' : player.anim);
      } else if (player.anim === 'run') {
        player.setAnim('idle');
      } else if ((player.anim === 'attack' || player.anim === 'kick') && player.attackCooldownRemainingMs <= 0) {
        // Section 2 (polish pass): without this, standing still after a
        // swing left the player frozen in the attack pose indefinitely —
        // the next attack would then "start" from a pose that never
        // returned to neutral. Reverting to idle once the swing's own
        // recovery is done lets attack -> idle -> next attack read as one
        // continuous motion instead of a jump-cut.
        player.setAnim('idle');
      } else if (player.anim === 'fart' || player.anim === 'superpower' || player.anim === 'hit' || player.anim === 'stagger') {
        // Reaching this branch already means canAct() is true, i.e. any
        // hitstun/lockout behind these poses has expired — safe to settle.
        player.setAnim('idle');
      }
    } else if (!player.body.grounded) {
      // allow air drift to continue during hitstun-free falls
    } else {
      player.body.vel.x = 0;
    }

    // Only auto-switch to jump/fall while the player is free to act — a
    // deliberate 'attack'/'hit'/'knockback'/'stagger' pose (and its hit
    // resolution) must not be clobbered by a brief, incidental hop.
    if (!player.body.grounded && player.canAct()) {
      player.setAnim(player.body.vel.y < 0 ? 'jump' : 'fall');
    }

    // face the enemy passively when idle
    if (enemy && player.anim === 'idle') {
      player.facing = enemy.body.pos.x >= player.body.pos.x ? 1 : -1;
    }

    stepPhysics(player.body, dtSec, this.layout.minX, this.layout.maxX);
    if (player.body.grounded && player.body.vel.y === 0 && (player.anim === 'jump' || player.anim === 'fall')) {
      player.setAnim('idle');
      audio.play('land');
    }

    this.updateDeathSequence(player, dtMs);

    // --- enemy AI ---
    if (enemy) {
      if (!enemy.isDead) this.updateEnemyAi(enemy, dtMs, dtSec);
      stepPhysics(enemy.body, dtSec, this.layout.minX, this.layout.maxX);
      this.updateDeathSequence(enemy, dtMs);
    }

    // --- attack hit-frame resolution ---
    this.resolveAttackHitFrame(player, enemy);
    if (enemy) this.resolveAttackHitFrame(enemy, player);

    this.updateProjectiles(dtSec);
    this.updateHazards(dtSec);
    this.updateStork(dtMs);
    if (this.airSupportCooldownMs > 0) this.airSupportCooldownMs -= dtMs;

    for (const [id, ms] of this.superpowerCooldowns) {
      if (ms > 0) this.superpowerCooldowns.set(id, Math.max(0, ms - dtMs));
    }

    if (enemy?.deathPhase === 'done' && !this.levelWonHandled) {
      this.handleEnemyDefeated(enemy);
    }
    if (player.deathPhase === 'done' && this.phase === 'playing') {
      this.handlePlayerDefeated();
    }
  }

  private updateEnemyAi(enemy: Fighter, dtMs: number, dtSec: number): void {
    if (enemy.aiType === 'boss' && this.bossDefId) {
      const def = BOSSES[this.bossDefId];
      const dist = distance(enemy.body.pos, this.player.body.pos);
      const result = tickBossAbilities(enemy, def.abilities, dtMs, dist);
      if (result.telegraphStarted) {
        // Section (boss AI overhaul): a dedicated windup pose (arms raised,
        // pulsing aura — see renderBoss.ts) instead of reusing 'stagger',
        // which reads as the boss being hurt rather than about to unleash
        // something — the player needs to instantly tell "this is a threat
        // window," not confuse it with a punish opportunity.
        enemy.setAnim('telegraph', true);
        enemy.body.vel.x = 0;
      }
      if (result.fireAbility) {
        this.executeBossAbility(enemy, result.fireAbility.id);
      }
      if (enemy.bossTelegraph) {
        // holds still while telegraphing
        enemy.body.vel.x *= 0.8;
        return;
      }

      // Occasional idle taunt/gesture (boss individuality polish pass) —
      // only plays while the boss isn't closing in for an attack, so it
      // never delays or replaces real combat behaviour or attack uptime.
      if (enemy.tauntActiveMs > 0) {
        enemy.tauntActiveMs -= dtMs;
        enemy.body.vel.x *= 0.7;
        if (enemy.tauntActiveMs <= 0) {
          enemy.setAnim('idle');
        } else {
          return;
        }
      } else {
        enemy.gestureCooldownMs -= dtMs;
        if (enemy.gestureCooldownMs <= 0) {
          if (dist > enemy.preferredRange * 1.3 && enemy.canAct()) {
            enemy.tauntVariant = (enemy.tauntVariant + 1) % 3;
            enemy.setAnim('taunt', true);
            enemy.tauntActiveMs = 900;
            enemy.gestureCooldownMs = 13000 + Math.random() * 6000;
            enemy.body.vel.x = 0;
            return;
          }
          enemy.gestureCooldownMs = 500;
        }
      }
    }

    const decision = decideAiAction(enemy, this.player);
    if (decision.moveDir !== 0) {
      enemy.body.vel.x = decision.moveDir * enemy.effectiveMoveSpeed();
      enemy.facing = decision.moveDir;
      enemy.setAnim('run');
    } else {
      enemy.body.vel.x *= 0.7;
      if (enemy.anim === 'run') {
        enemy.setAnim('idle');
      } else if ((enemy.anim === 'attack' || enemy.anim === 'kick') && enemy.attackCooldownRemainingMs <= 0) {
        enemy.setAnim('idle');
      } else if (
        enemy.anim === 'hit' || enemy.anim === 'stagger'
        || (enemy.anim === 'dazed' && enemy.dazedUntilMs <= 0)
        || (enemy.anim === 'surprised' && enemy.hitstunRemainingMs <= 0)
      ) {
        enemy.setAnim('idle');
      }
      enemy.facing = this.player.body.pos.x >= enemy.body.pos.x ? 1 : -1;
    }
    if (decision.wantsBlock) enemy.setAnim('block');
    if (decision.wantsAttack) this.startAttack(enemy, decision.wantsKick);
    void dtSec;
  }

  private executeBossAbility(boss: Fighter, id: string): void {
    const dir = this.player.body.pos.x >= boss.body.pos.x ? 1 : -1;
    boss.facing = dir;
    boss.setAnim('attack', true);
    audio.vibrate(60);
    switch (id) {
      case 'chargeSlam': {
        boss.body.vel.x = dir * 620;
        this.shake.add(0.4);
        break;
      }
      case 'eggDrop': {
        hazardCounter += 1;
        this.hazards.push({
          id: hazardCounter, kind: 'egg',
          pos: { x: boss.body.pos.x + dir * 60, y: this.layout.groundY },
          vel: { x: 0, y: 0 }, timer: 1300, radius: 46, owner: 'enemy', triggered: false,
        });
        break;
      }
      case 'balloonBarrage': {
        for (let i = 0; i < 3; i++) {
          hazardCounter += 1;
          this.hazards.push({
            id: hazardCounter, kind: 'balloon',
            pos: { x: boss.body.pos.x + dir * (40 + i * 30), y: this.layout.groundY - 60 - i * 20 },
            vel: { x: dir * -40, y: -60 - i * 20 }, timer: 4000, radius: 22, owner: 'enemy', triggered: false,
          });
        }
        break;
      }
      case 'summonMinion': {
        if (this.hazards.filter((h) => h.kind === 'egg').length < 4) {
          const minionDef = ENEMIES.standard;
          const minion = createEnemy(minionDef, boss.body.pos.x + dir * 90, this.layout.groundY, 0.6, 0.75);
          minion.health = minion.maxHealth * 0.5;
          this.particles.burst(minion.body.pos, 10, { color: '#8bc34a', shape: 'spark' });
        }
        break;
      }
      case 'fireWave': {
        // A travelling wall of fire the player must dodge (jump/move away)
        // — on contact it burns for a few seconds, distinct from a normal
        // hit. Slow enough, and telegraphed long enough beforehand, to
        // reliably get out of the way of.
        hazardCounter += 1;
        this.hazards.push({
          id: hazardCounter, kind: 'fireWave',
          pos: { x: boss.body.pos.x + dir * 50, y: this.layout.groundY - 30 },
          vel: { x: dir * 250, y: 0 }, timer: 1600, radius: 40, owner: 'enemy', triggered: false,
        });
        this.particles.burst({ x: boss.body.pos.x + dir * 50, y: this.layout.groundY - 30 }, 14, { color: '#ff7043', shape: 'drop', size: 9, gravity: -60 });
        break;
      }
      case 'frostNova': {
        // A short-fused burst centered on the boss — the player has the
        // telegraph window plus this fuse to move out of range before it
        // resolves; anyone still caught inside gets briefly slowed.
        hazardCounter += 1;
        this.hazards.push({
          id: hazardCounter, kind: 'frostNova',
          pos: { x: boss.body.pos.x, y: this.layout.groundY - 40 },
          vel: { x: 0, y: 0 }, timer: 650, radius: 95, owner: 'enemy', triggered: false,
        });
        this.particles.burst({ x: boss.body.pos.x, y: this.layout.groundY - 40 }, 16, { color: '#81d4fa', shape: 'circle', size: 5, gravity: 0 });
        break;
      }
    }
    // Section (boss AI overhaul): a firm recovery beat after any special so
    // it can't chain straight into a normal punch — the special itself is
    // the moment, and the player gets a guaranteed breather right after it.
    boss.attackCooldownRemainingMs = Math.max(boss.attackCooldownRemainingMs, 900);
  }

  private resolveAttackHitFrame(attacker: Fighter, defender: Fighter | null): void {
    if (!defender || defender.isDead) return;
    if (attacker.anim !== 'attack' && attacker.anim !== 'kick') return;
    const applied = (attacker as Fighter & { pendingHitApplied?: boolean }).pendingHitApplied;
    if (applied) return;
    if (attacker.animTimeMs < attacker.attackTelegraphMs) return;

    (attacker as Fighter & { pendingHitApplied?: boolean }).pendingHitApplied = true;

    const isKick = attacker.anim === 'kick';
    const weapon = WEAPONS[isKick ? 'fists' : attacker.weaponId];
    const dx = defender.body.pos.x - attacker.body.pos.x;
    const facingCorrect = Math.sign(dx) === attacker.facing || Math.abs(dx) < 10;
    const inRange = Math.abs(dx) <= weapon.range + defender.width / 2;
    if (!facingCorrect || !inRange) return;

    const perfect = defender.anim === 'attack' || !!defender.bossTelegraph;
    this.applyHit(attacker, defender, weapon.id === 'fists' && isKick ? WEAPONS.fists : weapon, isKick, perfect);
  }

  private applyHit(attacker: Fighter, defender: Fighter, weapon: WeaponDef, isKick: boolean, perfect: boolean): void {
    if (defender.invulnerableMs > 0) {
      if (defender.dodgeActiveWindowMs > 0 && attacker.kind !== 'player') {
        this.addScore(BALANCE.score.dodgePerfect);
        this.showToast('PERFECT AUSWEICHEN!');
        audio.play('dodge');
      }
      return;
    }

    const hit = resolveHit(attacker, weapon, isKick, perfect);
    const dmg = applyDefense(hit.damage, defender.stats.defense);
    this.dealDamageTo(defender, dmg, true, isKick);
    // A follow-up hit lands the real punish already — end the banana daze
    // (birds) now rather than have it linger under the hit/knockback pose.
    defender.dazedUntilMs = 0;

    const dir = Math.sign(defender.body.pos.x - attacker.body.pos.x) || attacker.facing;
    applyKnockback(defender.body, dir, hit.knockback, hit.tier === 'critical' ? 0.55 : 0.3);

    if (hit.staggered) {
      defender.setAnim(hit.knockback > 150 ? 'knockback' : 'stagger', true);
      defender.hitstunRemainingMs = hit.tier === 'critical' ? 650 : hit.tier === 'heavy' ? 420 : 260;
    } else {
      defender.setAnim('hit', true);
      defender.hitstunRemainingMs = 180;
    }

    if (attacker.kind === 'player') {
      this.combo += 1;
      this.highestCombo = Math.max(this.highestCombo, this.combo);
      this.player.comboTimerMs = BALANCE.combo.resetAfterMs;
      const comboMult = 1 + Math.min(2, (this.combo - 1) * 0.08);
      this.addScore(Math.round(scoreForHit(hit.tier, perfect) * comboMult));
      if (hit.staggered) this.addScore(BALANCE.score.knockdown);
    }

    if (hit.vomit && !defender.isDead) {
      defender.vomitTimerMs = 900;
      audio.play('vomit');
      this.particles.burst({ x: defender.body.pos.x, y: this.layout.groundY - 60 }, 10, { color: '#7cb342', shape: 'drop', gravity: 700 });
    }

    // impact particles + shake per section 9
    const impactPos = { x: (attacker.body.pos.x + defender.body.pos.x) / 2, y: this.layout.groundY - 60 };
    if (isKick) {
      this.particles.burst({ x: defender.body.pos.x, y: this.layout.groundY - 4 }, 8, { color: '#c9b28a', shape: 'dust', gravity: 200, size: 5 });
    } else {
      const count = hit.tier === 'critical' ? 16 : hit.tier === 'heavy' ? 10 : 5;
      this.particles.burst(impactPos, count, { color: hit.tier === 'critical' ? '#ffeb3b' : '#ffffff', shape: hit.tier === 'critical' ? 'ring' : 'spark', size: hit.tier === 'critical' ? 14 : 6 });
    }

    audio.play(hit.tier === 'critical' ? 'criticalHit' : hit.tier === 'heavy' ? 'heavyHit' : 'hit');
    audio.vibrate(hit.tier === 'critical' ? [10, 20, 30] : hit.tier === 'heavy' ? 20 : 10);
    this.shake.add(hit.tier === 'critical' ? 0.55 : hit.tier === 'heavy' ? 0.3 : 0.12);
    if (hit.tier === 'critical') this.hitStop.trigger(BALANCE.hit.critHitStopMs);
    else if (hit.tier === 'heavy') this.hitStop.trigger(BALANCE.hit.hitStopMs);
  }

  private dealDamageTo(target: Fighter, amount: number, fromAttack: boolean, isKick = false): void {
    void isKick;
    if (target.isDead) return;
    target.health = Math.max(0, target.health - amount);
    if (!fromAttack) {
      target.setAnim('hit', true);
      target.hitstunRemainingMs = 200;
    }
    if (target.health <= 0 && !target.isDead) {
      target.isDead = true;
      target.deathPhase = 'falling';
      target.deathTimerMs = 500;
      target.setAnim(target.anim === 'attack' ? 'knockback' : target.anim, true);
      if (target.kind === 'player') {
        audio.play('gameOver');
      } else {
        audio.vibrate(40);
      }
    }
  }

  private updateDeathSequence(f: Fighter, dtMs: number): void {
    if (!f.isDead) return;
    switch (f.deathPhase) {
      case 'falling':
        f.deathTimerMs -= dtMs;
        if (f.deathTimerMs <= 0 || (f.body.grounded && Math.abs(f.body.vel.x) < 10)) {
          f.deathPhase = 'lying';
          f.deathTimerMs = 650;
          f.setAnim('fallen', true);
        }
        break;
      case 'lying':
        f.deathTimerMs -= dtMs;
        if (f.deathTimerMs <= 0) {
          f.deathPhase = 'fart';
          f.deathTimerMs = 550;
          this.triggerFartEffect(f, '#9ccc65', 1.35);
          this.shake.add(0.15);
        }
        break;
      case 'fart':
        f.deathTimerMs -= dtMs;
        if (f.deathTimerMs <= 0) {
          f.deathPhase = 'done';
          f.setAnim('dead', true);
        }
        break;
      default:
        break;
    }
  }

  private handleEnemyDefeated(enemy: Fighter): void {
    this.levelWonHandled = true;
    this.enemiesDefeated += 1;
    this.addScore(BALANCE.score.kill);
    if (enemy.kind === 'boss') {
      this.bossesDefeated += 1;
      this.addScore(BALANCE.boss.scoreBonus);
    } else {
      this.addScore(enemy.scoreValue);
    }
    this.phase = 'levelWon';
    // Visible on levels that skip the upgrade screen (see GameScreen) —
    // where an upgrade follows, the overlay covers it immediately anyway.
    this.showToast('SIEG!', 1300);
  }

  // Section 10 (3-lives quality update): a death only ends the run once
  // every attempt is spent. With attempts left, it's a soft retry — heal
  // up, reset the current fight, keep the score/level progress already
  // earned — so the player visibly loses a life and gets right back in,
  // rather than every death being a full Game Over.
  private handlePlayerDefeated(): void {
    this.livesRemaining -= 1;
    if (this.livesRemaining > 0) {
      const label = this.livesRemaining === 1 ? 'VERSUCH' : 'VERSUCHE';
      this.showToast(`NOCH ${this.livesRemaining} ${label}!`, 1800);
      this.player.health = this.player.maxHealth;
      this.player.isDead = false;
      this.player.deathPhase = 'none';
      this.player.status = freshStatus();
      this.loadLevel(this.levelIndex);
    } else {
      this.phase = 'gameOver';
    }
  }

  // ---------------------------------------------------------------------
  // Projectiles & hazards
  // ---------------------------------------------------------------------

  private updateProjectiles(dtSec: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dtSec;
      p.pos.x += p.vel.x * dtSec;
      p.pos.y += p.vel.y * dtSec;

      if (p.weaponId === 'boomerang' && !p.returning && p.life < 1.4) {
        p.returning = true;
      }
      if (p.returning) {
        const target = p.owner;
        const dx = target.body.pos.x - p.pos.x;
        const dy = (this.layout.groundY - 50) - p.pos.y;
        const len = Math.hypot(dx, dy) || 1;
        p.vel.x = (dx / len) * (WEAPONS.boomerang.projectileSpeed ?? 600);
        p.vel.y = (dy / len) * (WEAPONS.boomerang.projectileSpeed ?? 600);
        if (len < 30) {
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      const target = p.owner.kind === 'player' ? this.enemy : this.player;
      if (target && !target.isDead && !p.damageDealt) {
        const dist = distance(p.pos, { x: target.body.pos.x, y: this.layout.groundY - 50 });
        if (dist < 34) {
          p.damageDealt = true;
          const weapon = WEAPONS[p.weaponId];
          const hit = resolveHit(p.owner, weapon, false, false);
          const dmg = applyDefense(hit.damage, target.stats.defense);
          if (target.invulnerableMs <= 0) {
            this.applyHit(p.owner, target, weapon, false, false);
          }
          void dmg;
          if (p.weaponId !== 'boomerang') {
            this.projectiles.splice(i, 1);
            continue;
          }
        }
      }

      if (p.life <= 0 || p.pos.x < this.layout.minX - 50 || p.pos.x > this.layout.maxX + 50) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  private updateHazards(dtSec: number): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.timer -= dtSec * 1000;
      if (h.kind === 'bonusBomb' || h.kind === 'diaperBomb') h.vel.y += BALANCE.physics.gravity * 0.7 * dtSec;
      h.pos.x += h.vel.x * dtSec;
      h.pos.y += h.vel.y * dtSec;
      if (h.kind === 'balloon') {
        h.pos.y += Math.sin(h.timer / 200) * 0.6;
      }

      const targets = h.owner === 'enemy' ? [this.player] : this.enemy ? [this.enemy] : [];
      for (const target of targets) {
        if (!target || target.isDead || h.triggered) continue;
        const groundish = h.kind === 'banana' ? target.body.groundY : this.layout.groundY - 55;
        const dist = distance(h.pos, { x: target.body.pos.x, y: h.kind === 'banana' ? target.body.groundY : groundish });
        if (dist < h.radius) {
          this.triggerHazard(h, target);
        }
      }

      if ((h.kind !== 'banana' && h.timer <= 0) || h.triggered) {
        if ((h.kind === 'egg' || h.kind === 'bonusBomb' || h.kind === 'frostNova' || h.kind === 'diaperBomb') && h.timer <= 0 && !h.triggered) {
          this.triggerHazard(h, null);
        }
        this.hazards.splice(i, 1);
      } else if (h.kind === 'banana' && h.timer <= 0) {
        this.hazards.splice(i, 1);
      }
    }
  }

  private triggerHazard(h: Hazard, directTarget: Fighter | null): void {
    h.triggered = true;
    if (h.kind === 'egg') {
      this.particles.burst(h.pos, 20, { color: '#ffb300', shape: 'ring', size: 12 });
      audio.play('explosion');
      this.shake.add(0.35);
      const targets = [this.player, this.enemy].filter((f): f is Fighter => !!f && !f.isDead);
      for (const t of targets) {
        if (distance(h.pos, t.body.pos) < h.radius + 30) {
          this.dealDamageTo(t, applyDefense(18, t.stats.defense), false);
          applyKnockback(t.body, Math.sign(t.body.pos.x - h.pos.x) || 1, 260, 0.4);
          t.setAnim('knockback', true);
          t.hitstunRemainingMs = 400;
        }
      }
    } else if (h.kind === 'balloon') {
      this.particles.burst(h.pos, 10, { color: '#f06292', shape: 'circle', size: 6 });
      audio.play('hit');
      if (directTarget) {
        this.dealDamageTo(directTarget, applyDefense(8, directTarget.stats.defense), false);
        directTarget.applySlow(0.75, 900);
      }
    } else if (h.kind === 'banana') {
      if (directTarget && directTarget.kind !== 'player') {
        // Humorous effects pass: a real slip, not a generic stagger — legs
        // fly out, the enemy briefly falls, and classic cartoon birds circle
        // its head while it's dazed. Short duration (helpful, not
        // overpowered): just long enough for a free follow-up hit.
        this.particles.burst(h.pos, 8, { color: '#fdd835', shape: 'spark' });
        audio.play('hit');
        directTarget.setAnim('dazed', true);
        const dazeMs = 1100;
        directTarget.hitstunRemainingMs = dazeMs;
        directTarget.dazedUntilMs = dazeMs;
        applyKnockback(directTarget.body, directTarget.facing, 140, 0.5);
        this.addScore(400);
        this.showToast('AUSGERUTSCHT!');
      }
    } else if (h.kind === 'bonusBomb') {
      // Section 8 (quality update): a real explosion with a real AoE hit —
      // a proper payoff for the milestone reward, not a firework that does
      // nothing. Only ever threatens the enemy (it's the player's own
      // thrown weapon), with a limited blast radius so it can still miss.
      this.particles.burst(h.pos, 26, { color: '#ffb300', shape: 'ring', size: 15 });
      this.particles.burst(h.pos, 18, { color: '#ff7043', shape: 'spark', size: 9 });
      this.particles.burst(h.pos, 10, { color: '#8d6e63', shape: 'dust', size: 8, gravity: 250 });
      audio.play('explosion');
      this.shake.add(0.6);
      this.hitStop.trigger(120);
      const target = this.enemy;
      if (target && !target.isDead && distance(h.pos, target.body.pos) < h.radius) {
        this.dealDamageTo(target, applyDefense(60, target.stats.defense), false);
        applyKnockback(target.body, Math.sign(target.body.pos.x - h.pos.x) || this.player.facing, 380, 0.5);
        target.setAnim('knockback', true);
        target.hitstunRemainingMs = 600;
        this.addScore(600);
        this.showToast('BOOM! VOLLTREFFER!', 1000);
      } else {
        this.showToast('BOOM! DANEBEN...', 1000);
      }
    } else if (h.kind === 'fireWave') {
      // A travelling fire hazard — matches the "Feuerwelle" example
      // explicitly requested for fire-themed bosses. Direct hit + a short
      // burn, distinct from a normal punch and telegraphed well before it
      // reaches the player.
      this.particles.burst(h.pos, 12, { color: '#ff5722', shape: 'drop', size: 8, gravity: -80 });
      audio.play('hit');
      if (directTarget) {
        this.dealDamageTo(directTarget, applyDefense(20, directTarget.stats.defense), false);
        directTarget.applyDot(5, 2200, '#ff5722');
        applyKnockback(directTarget.body, directTarget.facing, 140, 0.35);
      }
    } else if (h.kind === 'frostNova') {
      // A short-fused AoE the player must move out of before it resolves —
      // matches the "verlangsamende Eisfläche" example for ice-themed
      // bosses. Anyone still inside when it pops takes a hit and is slowed.
      this.particles.burst(h.pos, 20, { color: '#81d4fa', shape: 'ring', size: 14 });
      this.particles.burst(h.pos, 14, { color: '#e1f5fe', shape: 'circle', size: 4, gravity: 0 });
      audio.play('hit');
      const target = this.player;
      if (!target.isDead && distance(h.pos, target.body.pos) < h.radius) {
        this.dealDamageTo(target, applyDefense(16, target.stats.defense), false);
        target.applySlow(0.5, 1800);
      }
    } else if (h.kind === 'diaperBomb') {
      // The "Storch & Baby" bonus weapon's payload — a real thrown/dropped
      // object with a visible cartoon impact, not just a damage number. A
      // tactical bonus (moderate damage + a brief distraction), never an
      // automatic win — the fight still has to be finished by hand.
      this.particles.burst(h.pos, 16, { color: '#fff9c4', shape: 'circle', size: 8, life: 0.5, maxLife: 0.5, gravity: 40 });
      this.particles.burst(h.pos, 10, { color: '#8d6e63', shape: 'dust', size: 7, life: 0.5, maxLife: 0.5, gravity: 200 });
      audio.play('diaperSplat');
      this.shake.add(0.35);
      if (directTarget) {
        this.dealDamageTo(directTarget, applyDefense(24, directTarget.stats.defense), false);
        directTarget.setAnim('surprised', true);
        directTarget.hitstunRemainingMs = Math.max(directTarget.hitstunRemainingMs, 900);
        applyKnockback(directTarget.body, directTarget.facing, 120, 0.4);
        this.spawnComicText('PLATSCH!', h.pos.x, h.pos.y - 20, '#fff59d');
        this.addScore(500);
        this.showToast('VOLLTREFFER MIT DER WINDEL!');
      } else {
        this.showToast('Die Windel verfehlt knapp...');
      }
    }
  }

  // ---------------------------------------------------------------------
  // Score / toast helpers
  // ---------------------------------------------------------------------

  private addScore(amount: number): void {
    this.score += Math.max(0, Math.round(amount));
  }

  private showToast(msg: string, durationMs = 1100): void {
    this.toastMessage = msg;
    this.toastTimerMs = durationMs;
  }

  // ---------------------------------------------------------------------
  // Fart effect (shared by the active superpowers and the death sequence)
  // ---------------------------------------------------------------------

  /** Section 4-7 (polish pass): one shared trigger for every "Furz" so the
   * gas cloud size, comic text and sound stay consistent everywhere a fart
   * happens — whether it's an active superpower or a defeated fighter's
   * last breath. `sizeMult` scales the cloud (superpowers/death-fart use
   * ~1.35x, i.e. the requested +30-40%, on top of the old baseline). */
  private triggerFartEffect(f: Fighter, color: string, sizeMult = 1, shape: 'cloud' | 'ring' | 'drop' = 'cloud', towardFacing = false): void {
    // Section 7 (polish pass): active superpowers aim the effect at the
    // enemy (towardFacing=true — the character is oriented at them, so the
    // cloud/blast originates and drifts on that side), while the death-fart
    // keeps its original behind-the-back puff (towardFacing=false, default)
    // since nothing is being aimed at anyone there.
    const dir = towardFacing ? f.facing : -f.facing;
    const originX = f.body.pos.x + dir * 42;
    const originY = f.body.groundY - 55;
    this.particles.burst({ x: originX, y: originY }, Math.round(16 * sizeMult), {
      color, shape, size: 10 * sizeMult, life: 0.75, maxLife: 0.75, gravity: -35,
    });
    this.spawnComicText('Faaarrt…', originX, originY - 16);
    audio.playFart();
  }

  // Section 7-9 (polish pass): one shared "aimed" burst per superpower id,
  // layered on top of triggerFartEffect's base cloud/sound/text (which stay
  // unchanged). Each id gets its own shape/reach/behaviour so the release
  // reads as that power specifically, and everything is biased toward
  // `dirAngle` (the direction the character/butt is actually oriented,
  // i.e. facing the enemy) instead of exploding evenly in every direction.
  private fireSuperpowerVisual(id: SuperpowerId, originX: number, originY: number, dirAngle: number): void {
    switch (id) {
      case 'gasCloud':
        this.particles.burstDirectional({ x: originX, y: originY }, 14, dirAngle, 0.7, {
          color: SUPERPOWERS.gasCloud.color, shape: 'cloud', size: 9, life: 0.6, maxLife: 0.6, gravity: -25,
        });
        break;
      case 'chili': {
        // Section (quality pass): chili is fire, full stop — no gas cloud
        // anywhere in its effect. A bigger, longer flicker sequence (more
        // waves, bigger particles, more reach per wave) so it reads as a
        // real spectacular flame jet rather than a small particle puff, and
        // an outward-racing core flame so there's a clear leading edge with
        // actual reach instead of everything spawning at the same spot.
        for (let wave = 0; wave < 5; wave++) {
          window.setTimeout(() => {
            if (!this.enemy) return;
            const reach = wave * 14;
            const wx = originX + Math.cos(dirAngle) * reach;
            const wy = originY + Math.sin(dirAngle) * reach;
            this.particles.burstDirectional({ x: wx, y: wy }, 11, dirAngle, 0.32, {
              color: wave % 2 === 0 ? '#ff5722' : '#ffc107',
              shape: 'drop', size: 12 - wave, life: 0.38, maxLife: 0.38, gravity: -90,
            });
          }, wave * 60);
        }
        break;
      }
      case 'ice':
        this.particles.burstDirectional({ x: originX, y: originY }, 12, dirAngle, 0.18, {
          color: '#81d4fa', shape: 'circle', size: 5, life: 0.5, maxLife: 0.5, gravity: 0,
        });
        break;
      case 'electro':
        this.particles.burstDirectional({ x: originX, y: originY }, 10, dirAngle, 0.45, {
          color: '#ffeb3b', shape: 'spark', size: 10, life: 0.28, maxLife: 0.28, gravity: 0,
        });
        break;
      case 'tornado':
        this.particles.burst({ x: originX, y: originY }, 16, {
          color: '#cfd8dc', shape: 'dust', size: 7, life: 0.5, maxLife: 0.5, gravity: 0,
        });
        break;
      case 'nuclear':
        this.particles.burst({ x: originX, y: originY }, 10, {
          color: '#ff8a65', shape: 'spark', size: 8, life: 0.5, maxLife: 0.5, gravity: -100,
        });
        break;
    }
  }

  private spawnComicText(text: string, x: number, y: number, color = '#fff8e1'): void {
    this.comicTexts.push({ text, x, y, ageMs: 0, lifeMs: 900, color });
    if (this.comicTexts.length > 6) this.comicTexts.shift();
  }

  private updateComicTexts(dtMs: number): void {
    for (let i = this.comicTexts.length - 1; i >= 0; i--) {
      const c = this.comicTexts[i];
      c.ageMs += dtMs;
      if (c.ageMs >= c.lifeMs) this.comicTexts.splice(i, 1);
    }
  }

  private renderComicTexts(ctx: CanvasRenderingContext2D): void {
    for (const c of this.comicTexts) {
      const p = c.ageMs / c.lifeMs;
      const popIn = Math.min(1, c.ageMs / 120);
      const wobble = Math.sin(c.ageMs / 90) * 4;
      const rise = -p * 46;
      const alpha = p < 0.65 ? 1 : Math.max(0, 1 - (p - 0.65) / 0.35);
      ctx.save();
      ctx.translate(c.x + wobble, c.y + rise);
      ctx.scale(popIn, popIn);
      ctx.globalAlpha = alpha;
      ctx.font = "bold 22px 'Comic Sans MS', 'Segoe UI', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#4a2f00';
      ctx.lineWidth = 4;
      ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, 0, 0);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  private render(dtSec: number): void {
    const ctx = this.ctx;
    const arena = ARENAS[this.arenaId] ?? ARENAS.meadow;
    const t = (performance.now() - this.accumStartTime) / 1000;

    ctx.save();
    ctx.translate(this.shake.offsetX, this.shake.offsetY);
    renderArena(ctx, arena, this.layout, t);

    for (const h of this.hazards) this.renderHazard(ctx, h);
    for (const p of this.projectiles) this.renderProjectile(ctx, p);

    if (this.player.bossTelegraph === null) {
      // no-op, player never telegraphs
    }
    if (this.enemy?.bossTelegraph) {
      this.renderTelegraph(ctx, this.enemy);
    }

    const fighters = [this.player, this.enemy].filter((f): f is Fighter => !!f);
    fighters.sort((a, b) => a.body.pos.y - b.body.pos.y);
    for (const f of fighters) (f.kind === 'boss' ? renderBoss : renderFighter)(ctx, f, dtSec);

    this.renderStork(ctx);
    this.particles.render(ctx);
    this.renderComicTexts(ctx);
    ctx.restore();
  }

  private renderTelegraph(ctx: CanvasRenderingContext2D, boss: Fighter): void {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(performance.now() / 60) * 0.3;
    ctx.fillStyle = '#ff1744';
    ctx.beginPath();
    ctx.arc(boss.body.pos.x, this.layout.groundY - 130 * boss.scale, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Humorous effects pass: a real cartoon stork carrying a baby bundle,
  // flying an actual traversed path (see storkPosition) rather than
  // fading in/out in place — flapping wings, trailing legs, a baby peeking
  // out of a slung cloth sack beneath the beak.
  private renderStork(ctx: CanvasRenderingContext2D): void {
    const flight = this.storkFlight;
    if (!flight) return;
    const { x, y } = this.storkPosition(flight);
    const t = flight.elapsedMs / 1000;
    const facing: 1 | -1 = flight.variant === 'crossFly'
      ? (flight.dir > 0 ? 1 : -1)
      : (Math.cos(t * 3) > 0 ? 1 : -1);
    const flapPhase = Math.sin(t * 11);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing, 1);

    // Baby bundle, slung beneath the beak on a short cloth strap.
    ctx.strokeStyle = '#8d6e63';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(15, 16);
    ctx.stroke();
    ctx.fillStyle = '#90caf9';
    ctx.beginPath();
    ctx.ellipse(15, 22, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5c8fc7';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#ffe0b2';
    ctx.beginPath();
    ctx.arc(19, 18, 4, 0, Math.PI * 2);
    ctx.fill();

    // Trailing legs.
    ctx.strokeStyle = '#e64a19';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, 9); ctx.lineTo(-9, 20);
    ctx.moveTo(-1, 10); ctx.lineTo(-4, 21);
    ctx.stroke();

    // Rear wing (flaps opposite phase, drawn behind the body).
    ctx.fillStyle = '#eceff1';
    ctx.save();
    ctx.rotate(-0.3 - flapPhase * 0.35);
    ctx.beginPath();
    ctx.ellipse(-4, -2, 20, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#37474f';
    ctx.beginPath();
    ctx.ellipse(-16, -2, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Body.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#cfd8dc';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Neck + head + beak.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(12, -4);
    ctx.quadraticCurveTo(20, -14, 16, -18);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(16, -18, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#212121';
    ctx.beginPath();
    ctx.arc(18, -20, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff7043';
    ctx.beginPath();
    ctx.moveTo(20, -18);
    ctx.lineTo(31, -16);
    ctx.lineTo(20, -15);
    ctx.closePath();
    ctx.fill();

    // Front wing (flaps toward camera, drawn on top).
    ctx.fillStyle = '#f5f5f5';
    ctx.save();
    ctx.rotate(0.25 + flapPhase * 0.4);
    ctx.beginPath();
    ctx.ellipse(3, -3, 21, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#37474f';
    ctx.beginPath();
    ctx.ellipse(-10, -4, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  private renderProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
    const weapon = WEAPONS[p.weaponId];
    ctx.save();
    ctx.fillStyle = weapon.color;
    ctx.translate(p.pos.x, p.pos.y);
    ctx.rotate(Math.atan2(p.vel.y, p.vel.x));
    if (p.weaponId === 'boomerang') {
      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0.3, Math.PI * 1.6);
      ctx.stroke();
    } else {
      ctx.fillRect(-14, -2, 28, 4);
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private renderHazard(ctx: CanvasRenderingContext2D, h: Hazard): void {
    ctx.save();
    ctx.translate(h.pos.x, h.kind === 'banana' ? this.layout.groundY - 4 : h.pos.y);
    if (h.kind === 'egg') {
      const pulse = h.timer < 400 ? 1 + Math.sin(performance.now() / 40) * 0.15 : 1;
      ctx.fillStyle = '#fff8e1';
      ctx.strokeStyle = '#795548';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 16 * pulse, 20 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (h.kind === 'balloon') {
      ctx.fillStyle = '#f06292';
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ad1457';
      ctx.beginPath();
      ctx.moveTo(0, 18);
      ctx.lineTo(0, 28);
      ctx.stroke();
    } else if (h.kind === 'banana') {
      ctx.fillStyle = '#fdd835';
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 6, 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (h.kind === 'bonusBomb') {
      // A round cartoon bomb, tumbling in flight, with a lit sparking fuse
      // — instantly readable as "explosive," matching the reward's own
      // toast/flavor ("🎁 BONUS-WAFFE").
      ctx.rotate(h.pos.x * 0.05);
      ctx.fillStyle = '#212121';
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#6d4c2f';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(6, -12);
      ctx.quadraticCurveTo(14, -18, 10, -24);
      ctx.stroke();
      const spark = 0.6 + Math.sin(performance.now() / 40) * 0.4;
      ctx.fillStyle = `rgba(255,${Math.round(160 + spark * 60)},60,${0.7 + spark * 0.3})`;
      ctx.beginPath();
      ctx.arc(10, -24, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (h.kind === 'fireWave') {
      // A rolling wall of flame — several overlapping flickering flame
      // blobs so it reads as a wave, not a single fireball.
      const flicker = performance.now() / 70;
      for (let i = -1; i <= 1; i++) {
        const wob = Math.sin(flicker + i * 2) * 4;
        ctx.fillStyle = i === 0 ? '#ffca28' : '#ff5722';
        ctx.beginPath();
        ctx.ellipse(i * 16, -10 + wob * 0.4, 18, 26 + wob, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (h.kind === 'diaperBomb') {
      // A real cartoon diaper, folded and tabbed, tumbling as it falls —
      // instantly recognizable, matching the weapon's own name/flavor.
      ctx.rotate(h.pos.y * 0.03);
      ctx.fillStyle = '#fdfdfd';
      ctx.strokeStyle = '#cfd8dc';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(11, 8);
      ctx.lineTo(0, 14);
      ctx.lineTo(-11, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // side tabs
      ctx.fillStyle = '#ffca28';
      ctx.beginPath();
      ctx.ellipse(-9, 4, 3.5, 2.2, 0.4, 0, Math.PI * 2);
      ctx.ellipse(9, 4, 3.5, 2.2, -0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (h.kind === 'frostNova') {
      // Expanding icy ring — grows visibly as its fuse burns down so the
      // player can see exactly how much time/space they have to escape it.
      const growT = 1 - Math.max(0, h.timer / 650);
      const r = h.radius * (0.25 + growT * 0.85);
      ctx.strokeStyle = 'rgba(129,212,250,0.8)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(179,229,252,0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // HUD emission
  // ---------------------------------------------------------------------

  private emitHud(rawDtMs: number): void {
    this.lastHudEmitMs += rawDtMs;
    if (this.lastHudEmitMs < 60 && this.phase === 'playing') return;
    this.lastHudEmitMs = 0;

    const cooldowns = {} as Record<SuperpowerId, number>;
    for (const id of Object.keys(SUPERPOWERS) as SuperpowerId[]) {
      cooldowns[id] = this.superpowerCooldowns.get(id) ?? 0;
    }

    this.onHud({
      phase: this.phase,
      playerHealth: this.player.health,
      playerMaxHealth: this.player.maxHealth,
      enemyHealth: this.enemy?.health ?? 0,
      enemyMaxHealth: this.enemy?.maxHealth ?? 1,
      enemyName: this.enemy?.name ?? '',
      isBossFight: this.isBossLevel,
      score: this.score,
      combo: this.combo,
      level: this.levelIndex,
      chaosMode: this.chaosMode,
      livesRemaining: this.livesRemaining,
      maxLives: GameEngine.MAX_LIVES,
      hasBonusWeapon: this.player.hasBonusWeapon,
      airSupportUnlocked: this.levelIndex >= GameEngine.AIR_SUPPORT_UNLOCK_LEVEL,
      airSupportCooldownMs: Math.max(0, this.airSupportCooldownMs),
      hasStorkBonusWeapon: this.player.hasStorkBonusWeapon,
      weaponId: this.player.weaponId,
      bossIntroText: this.bossDefId ? BOSSES[this.bossDefId].introText : '',
      levelWonInfo: this.phase === 'levelWon' ? { score: this.score, leveledUp: true } : null,
      gameOverSummary: this.phase === 'gameOver' ? {
        score: this.score, level: this.levelIndex, kills: this.enemiesDefeated, bosses: this.bossesDefeated, combo: this.highestCombo,
      } : null,
      superpowerCooldowns: cooldowns,
      toast: this.toastMessage,
    });
  }
}
