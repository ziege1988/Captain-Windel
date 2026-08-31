import type { BossDef, SpecialWeaponId, SuperpowerId, WeaponDef, WeaponId } from '../types';
import { Fighter, freshStatus } from '../entities/Fighter';
import { createBoss, createEnemy, createPlayer } from '../entities/factory';
import { ENEMIES } from '../../data/enemies';
import { BOSSES } from '../../data/bosses';
import { ARENAS } from '../../data/arenas';
import { getLevel } from '../../data/levels';
import { BALANCE, enemyAggression, enemyRecoveryBonusMs, enemyTelegraphMs, readyDurationMs } from '../../data/balance';
import { WEAPONS } from '../../data/weapons';
import { SUPERPOWERS } from '../../data/superpowers';
import { SPECIAL_WEAPONS, SPECIAL_WEAPON_UNLOCK_LEVELS } from '../../data/specialWeapons';
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
  // Persistent-progression pass.
  coins: number;
  coinFlash: boolean;
  specialWeaponId: SpecialWeaponId | null;
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
  kind: 'egg' | 'balloon' | 'banana' | 'bonusBomb' | 'fireWave' | 'frostNova' | 'diaperBomb'
    | 'poopBomb' | 'explodingDuck' | 'bigBoomerangOut' | 'bigBoomerangBack' | 'tornado' | 'eggBomberEgg';
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  timer: number;
  radius: number;
  owner: 'player' | 'enemy';
  triggered: boolean;
}

// Persistent-progression pass: a boss-dropped reward the player walks
// (or, once past its brief "pop up" beat, is drawn) into. Kept as its own
// array rather than folded into Hazard — pickups are always the player's
// to collect and never "trigger" a hazard effect on contact, they just
// get credited. `homing` flicks on a short delay after spawning so the
// reward is guaranteed to actually reach the player even while the level-
// won screen has frozen normal gameplay input (see updatePickups).
interface Pickup {
  id: number;
  kind: 'coin' | 'heart';
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  ageMs: number;
  value: number;
  homing: boolean;
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

// ---------------------------------------------------------------------
// Persistent-progression pass: special-weapon state shapes
// ---------------------------------------------------------------------

type RavenPhase = 'entering' | 'hover' | 'diving' | 'pecking' | 'returning' | 'leaving';

// The raven companion (section 7 of the brief): a genuine small ally, not
// a particle effect — its own health bar, its own simple state machine
// (hover near the player -> occasionally dive at the enemy -> peck ->
// return -> repeat), can be damaged by the enemy while diving/pecking, and
// leaves (flies off) on either running out of health or its time limit.
interface RavenState {
  pos: { x: number; y: number };
  facing: 1 | -1;
  phase: RavenPhase;
  health: number;
  maxHealth: number;
  ageMs: number;
  maxAgeMs: number;
  phaseTimerMs: number;
  phaseDurationMs: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  attackCooldownMs: number;
  wingPhase: number;
  cawTimerMs: number;
}

// Shared by the laser cannon and the ice cannon — a real multi-layer beam
// (outer glow + bright core + hot center) sweeping from the player to the
// enemy over `totalMs`, rather than a flat line.
interface BeamEffect {
  color: string;
  coreColor: string;
  ageMs: number;
  totalMs: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  impactApplied: boolean;
  freeze?: boolean;
}

// A crazed chicken sprinting in a straight line across the ground and
// ramming through the enemy on the way — a ground-level cousin of the
// stork flight system, but running rather than flying.
interface ChickenRun {
  elapsedMs: number;
  totalMs: number;
  dir: 1 | -1;
  startX: number;
  endX: number;
  y: number;
  effectFired: boolean;
}

// Visual-only timer for the bee swarm special weapon, layered on top of a
// few discrete scheduled stings (see updateBeeSwarmEffect) — the swarm
// itself is drawn as several small dots orbiting the enemy, not a real
// physics hazard.
interface BeeSwarmEffect {
  ageMs: number;
  totalMs: number;
  hitsFired: number;
}

// Whirlwind-Furz follow-up: a real world-space sweep from where it was
// summoned (startX) across to the far arena wall (endX) — the whole field,
// not just the gap to the enemy — growing and spinning faster as it goes.
interface TornadoEffect {
  x: number;
  startX: number;
  endX: number;
  ageMs: number;
  totalMs: number;
  rotation: number;
  hasHitEnemy: boolean;
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
let pickupCounter = 0;

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
// Gameplay/animation pass (point 17): pulled out further again — noticeably
// more ground/landscape/movement room visible, characters read a bit
// smaller as a direct, intended consequence (never compensated for here).
const ARENA_ZOOM = 0.62;

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
  // Gameplay/animation pass (point 2): a brief player victory beat after a
  // normal (non-boss) kill — enemy falls, player gets a short taunt/fist-pump
  // moment, THEN the level actually completes — instead of "SIEG!" and the
  // next screen appearing the instant the corpse finishes its death sequence.
  private celebrationTimerMs = 0;
  private celebratingEnemy: Fighter | null = null;
  // Whirlwind-Furz rework (points 12-15): a genuine physical lift/spin/fall
  // while the funnel has the enemy — orbits their x position around a
  // centre while real gravity (via the normal physics body) handles the
  // vertical arc, so it reads as "the tornado caught them" rather than a
  // teleport up and back down. null whenever nothing is currently caught.
  private tornadoCarry: { target: Fighter; ageMs: number; totalMs: number; centerX: number } | null = null;
  // Whirlwind-Furz follow-up: the funnel now genuinely sweeps across the
  // WHOLE arena (not just to wherever the enemy happened to be standing),
  // growing larger and spinning faster the whole way, drawn fresh every
  // frame (updateTornadoEffect/renderTornadoEffect) instead of a handful of
  // scheduled particle bursts — a real world-space effect, like the beam/
  // raven/stork effects below, rather than something attached to a fighter.
  private tornadoEffect: TornadoEffect | null = null;

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
  pickups: Pickup[] = [];
  coinFlashMs = 0;

  // Persistent-progression pass: the raven companion, a beam effect shared
  // by the laser cannon and ice cannon, and the ground-running chicken
  // charge — each a small self-contained state object rather than folded
  // into the generic Hazard system, since none of them fit its
  // spawn-travel-trigger-once shape (a persistent companion with its own
  // HP, a screen-space beam with no physical position, a homing ground
  // dash) — see useSpecialWeapon() and its per-weapon methods below.
  raven: RavenState | null = null;
  beamEffect: BeamEffect | null = null;
  chickenRun: ChickenRun | null = null;
  beeSwarmEffect: BeeSwarmEffect | null = null;

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
    // Persistent-progression pass: a special weapon bought from the
    // main-menu shop (before this run existed) is stashed in
    // save.pendingSpecialWeapon — consume it into the player's single held
    // slot right as the run starts, then clear the pending flag so it isn't
    // handed out again next run.
    if (save.pendingSpecialWeapon) {
      this.player.hasSpecialWeaponId = save.pendingSpecialWeapon;
      useAppStore.getState().setPendingSpecialWeapon(null);
    }
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
    // Deliberately NOT resetting pickups here: on a normal (non-boss) kill
    // with no upgrade offered, GameScreen auto-advances to the next level
    // only ~700ms after 'levelWon' — often before a just-spawned coin
    // reward has had time to home in and be collected. Clearing the array
    // on load silently discarded that reward; letting it carry over means
    // it simply keeps homing toward the player (who is at the same
    // reference point regardless of level) and gets collected within a
    // fraction of a second in the new level instead of vanishing.
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

    // Persistent-progression pass: one shop special weapon unlocks per boss
    // milestone level — permanently, independent of bonusWeaponMilestones/
    // storkBonusMilestones above, and never re-claimed once the store shows
    // it as unlocked (read fresh here rather than via this.save, since a
    // purchase/unlock made through the store elsewhere this run wouldn't be
    // reflected on the possibly-stale reference captured in the constructor).
    const unlockId = SPECIAL_WEAPON_UNLOCK_LEVELS[index];
    if (unlockId) {
      const liveSave = useAppStore.getState().save;
      if (!liveSave.unlockedSpecialWeapons.includes(unlockId)) {
        useAppStore.getState().unlockSpecialWeapon(unlockId);
        const def = SPECIAL_WEAPONS[unlockId];
        this.showToast(`🔓 NEU IN DER WAFFENKAMMER: ${def.icon} ${def.name}!`, 2200);
      }
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

  // Persistent-progression pass: fires the player's single shop-bought
  // special weapon (section 4/5/21 of the brief) — spectacular, one-time,
  // consumed the instant it's used, never a substitute for the normal
  // weapon/superpower loop. Dispatches to one of ten distinct effects; see
  // fireSpecialWeapon below.
  useSpecialWeapon(): void {
    if (this.phase !== 'playing') return;
    if (!this.player.canAct()) return;
    const id = this.player.hasSpecialWeaponId;
    if (!id) return;
    if (!this.enemy || this.enemy.isDead) return;
    this.player.hasSpecialWeaponId = null;
    this.player.setAnim('superpower', true);
    audio.play('specialActivate');
    this.fireSpecialWeapon(id);
  }

  private fireSpecialWeapon(id: SpecialWeaponId): void {
    switch (id) {
      case 'chickenAttack': this.launchChickenAttack(); break;
      case 'poopCatapult': this.launchPoopCatapult(); break;
      case 'bigBoomerang': this.throwBigBoomerang(); break;
      case 'beeSwarm': this.launchBeeSwarm(); break;
      case 'explodingDuck': this.launchExplodingDuck(); break;
      case 'raven': this.deploySpecialRaven(); break;
      case 'eggBomber': this.launchEggBomber(); break;
      case 'iceCannon': this.fireIceCannon(); break;
      case 'tornadoStrike': this.summonTornado(); break;
      case 'laser': this.fireLaserCannon(); break;
    }
  }

  // --- individual special-weapon launchers -----------------------------

  /** 🐔 Hühner-Angriff — a crazed chicken sprints across the ground and
   * rams the enemy (see ChickerRun/updateChickenRun/renderChickenRun). */
  private launchChickenAttack(): void {
    const enemy = this.enemy;
    if (!enemy) return;
    const dir: 1 | -1 = enemy.body.pos.x >= this.player.body.pos.x ? 1 : -1;
    this.chickenRun = {
      elapsedMs: 0, totalMs: 900, dir,
      startX: this.player.body.pos.x, endX: enemy.body.pos.x,
      y: this.layout.groundY, effectFired: false,
    };
    this.showToast('🐔 HÜHNER-ANGRIFF!', 900);
  }

  /** 💩 Kot-Katapult — a lobbed distraction hit, arcing like the bonus-bomb
   * throw but dazing rather than exploding. */
  private launchPoopCatapult(): void {
    const enemy = this.enemy;
    const player = this.player;
    if (!enemy) return;
    const dir: 1 | -1 = enemy.body.pos.x >= player.body.pos.x ? 1 : -1;
    const dist = Math.max(120, Math.abs(enemy.body.pos.x - player.body.pos.x));
    hazardCounter += 1;
    this.hazards.push({
      id: hazardCounter, kind: 'poopBomb',
      pos: { x: player.body.pos.x + dir * 30, y: this.layout.groundY - 90 },
      vel: { x: dir * (dist / 0.85), y: -260 },
      timer: 1100, radius: 42, owner: 'player', triggered: false,
    });
  }

  /** 🪃 Riesen-Bumerang — flies out, hits once, then flies itself home (see
   * updateHazards' bigBoomerangBack homing + triggerHazard's conversion). */
  private throwBigBoomerang(): void {
    const enemy = this.enemy;
    const player = this.player;
    if (!enemy) return;
    const dir: 1 | -1 = enemy.body.pos.x >= player.body.pos.x ? 1 : -1;
    hazardCounter += 1;
    this.hazards.push({
      id: hazardCounter, kind: 'bigBoomerangOut',
      pos: { x: player.body.pos.x + dir * 20, y: this.layout.groundY - 70 },
      vel: { x: dir * 560, y: 0 },
      timer: 1400, radius: 46, owner: 'player', triggered: false,
    });
  }

  /** 🐝 Bienenschwarm — a swarm that briefly pursues the enemy, stinging a
   * few times over its lifetime (see updateBeeSwarmEffect). */
  private launchBeeSwarm(): void {
    if (!this.enemy) return;
    this.beeSwarmEffect = { ageMs: 0, totalMs: 1800, hitsFired: 0 };
    this.showToast('🐝 BIENENSCHWARM!', 900);
  }

  /** 🦆 Explodierende Ente — waddles into range, then a real AoE blast. */
  private launchExplodingDuck(): void {
    const enemy = this.enemy;
    const player = this.player;
    if (!enemy) return;
    const dir: 1 | -1 = enemy.body.pos.x >= player.body.pos.x ? 1 : -1;
    hazardCounter += 1;
    this.hazards.push({
      id: hazardCounter, kind: 'explodingDuck',
      pos: { x: player.body.pos.x + dir * 26, y: this.layout.groundY - 18 },
      vel: { x: dir * 150, y: 0 },
      timer: 2400, radius: 40, owner: 'player', triggered: false,
    });
  }

  /** 🐦 Raben-Assistent — a real temporary ally, not a particle effect; see
   * RavenState/updateRaven/renderRaven for the full behaviour. */
  private deploySpecialRaven(): void {
    const player = this.player;
    const startX = player.body.pos.x - player.facing * 260;
    const startY = this.layout.groundY - 260;
    const hoverX = player.body.pos.x - player.facing * 34;
    const hoverY = this.layout.groundY - 165;
    this.raven = {
      pos: { x: startX, y: startY }, facing: player.facing,
      phase: 'entering', health: 40, maxHealth: 40,
      ageMs: 0, maxAgeMs: 15000,
      phaseTimerMs: 500, phaseDurationMs: 500,
      fromX: startX, fromY: startY, toX: hoverX, toY: hoverY,
      attackCooldownMs: 1200, wingPhase: 0, cawTimerMs: 1800 + Math.random() * 1500,
    };
    this.showToast('🐦 RABE IM EINSATZ!', 1200);
  }

  /** 🥚 Eier-Bomber — a short volley of eggs dropped over the enemy. */
  private launchEggBomber(): void {
    if (!this.enemy) return;
    this.showToast('🥚 EIER-BOMBER!', 1000);
    audio.play('specialActivate');
    for (let i = 0; i < 3; i++) {
      window.setTimeout(() => {
        const enemy = this.enemy;
        if (!enemy || enemy.isDead) return;
        const offset = (i - 1) * 34;
        hazardCounter += 1;
        this.hazards.push({
          id: hazardCounter, kind: 'eggBomberEgg',
          pos: { x: enemy.body.pos.x + offset, y: this.layout.groundY - 220 },
          vel: { x: 0, y: 40 }, timer: 1400, radius: 44, owner: 'player', triggered: false,
        });
        this.particles.burst({ x: enemy.body.pos.x + offset, y: this.layout.groundY - 220 }, 4, {
          color: '#ffffff', shape: 'circle', size: 4, life: 0.3, maxLife: 0.3,
        });
      }, i * 220);
    }
  }

  /** 🧊 Eis-Kanone — the same shared beam effect as the laser cannon (see
   * BeamEffect/updateBeamEffect), but slower, weaker, and freezing rather
   * than knocking back — a defensive/control pick, not a damage pick. */
  private fireIceCannon(): void {
    const player = this.player;
    if (!this.enemy) return;
    audio.play('laserCharge');
    window.setTimeout(() => {
      const enemy = this.enemy;
      if (!enemy) return;
      this.beamEffect = {
        color: 'rgba(129,212,250,0.4)', coreColor: '#e1f5fe',
        ageMs: 0, totalMs: 520, freeze: true,
        fromX: player.body.pos.x + player.facing * 30, fromY: this.layout.groundY - 65,
        toX: enemy.body.pos.x, toY: this.layout.groundY - 60,
        impactApplied: false,
      };
      audio.play('laserFire');
      this.shake.add(0.25);
    }, 420);
  }

  /** 🌀 Mini-Tornado — spawned right on the enemy, see triggerHazard's
   * 'tornado' branch for the hit + multi-pulse fling. */
  private summonTornado(): void {
    const enemy = this.enemy;
    if (!enemy) return;
    hazardCounter += 1;
    this.hazards.push({
      id: hazardCounter, kind: 'tornado',
      pos: { x: enemy.body.pos.x, y: this.layout.groundY - 60 },
      vel: { x: 0, y: 0 }, timer: 260, radius: 70, owner: 'player', triggered: false,
    });
    this.particles.burst({ x: enemy.body.pos.x, y: this.layout.groundY - 20 }, 20, {
      color: '#b0bec5', shape: 'dust', size: 10, life: 0.6, maxLife: 0.6, gravity: -20,
    });
  }

  /** 🔴 Laserkanone (brief section 6): charge -> a real travelling beam ->
   * a spectacular impact -> high damage -> consumed. Shares BeamEffect with
   * the ice cannon, undamped/red instead of icy/blue. */
  private fireLaserCannon(): void {
    const player = this.player;
    if (!this.enemy) return;
    audio.play('laserCharge');
    this.particles.burst({ x: player.body.pos.x + player.facing * 20, y: this.layout.groundY - 60 }, 14, {
      color: '#ff1744', shape: 'spark', size: 6, life: 0.5, maxLife: 0.5, gravity: 0,
    });
    window.setTimeout(() => {
      const enemy = this.enemy;
      if (!enemy) return;
      this.beamEffect = {
        color: 'rgba(255,23,68,0.35)', coreColor: '#ff5252',
        ageMs: 0, totalMs: 420,
        fromX: player.body.pos.x + player.facing * 30, fromY: this.layout.groundY - 65,
        toX: enemy.body.pos.x, toY: this.layout.groundY - 60,
        impactApplied: false,
      };
      audio.play('laserFire');
      this.shake.add(0.3);
    }, 480);
  }

  private setRavenPhase(raven: RavenState, phase: RavenPhase, durationMs: number, toX: number, toY: number): void {
    raven.phase = phase;
    raven.phaseDurationMs = durationMs;
    raven.phaseTimerMs = durationMs;
    raven.fromX = raven.pos.x;
    raven.fromY = raven.pos.y;
    raven.toX = toX;
    raven.toY = toY;
  }

  // --- per-tick updates for the special-weapon state objects -----------

  private updateBeamEffect(dtMs: number): void {
    const beam = this.beamEffect;
    if (!beam) return;
    beam.ageMs += dtMs;
    const impactAt = beam.totalMs * 0.35;
    if (!beam.impactApplied && beam.ageMs >= impactAt) {
      beam.impactApplied = true;
      const target = this.enemy;
      if (target && !target.isDead) {
        const pct = beam.freeze ? 0.08 : 0.25;
        const dmg = Math.round(target.maxHealth * pct);
        this.dealDamageTo(target, applyDefense(dmg, target.stats.defense), false);
        if (beam.freeze) {
          target.applyFreeze(1600);
          target.applySlow(0.4, 3200);
        } else {
          applyKnockback(target.body, Math.sign(target.body.pos.x - beam.fromX) || 1, 300, 0.4);
          target.setAnim('knockback', true);
          target.hitstunRemainingMs = 650;
        }
        this.particles.burst({ x: beam.toX, y: beam.toY }, 24, {
          color: beam.freeze ? '#b3e5fc' : '#ff8a65',
          shape: beam.freeze ? 'circle' : 'spark',
          size: 9, life: 0.5, maxLife: 0.5, gravity: beam.freeze ? 0 : -40,
        });
        this.shake.add(beam.freeze ? 0.3 : 0.55);
        this.hitStop.trigger(beam.freeze ? 60 : 100);
        this.spawnComicText(beam.freeze ? 'EISKALT!' : 'ZAP!!!', beam.toX, beam.toY - 30, beam.freeze ? '#e1f5fe' : '#ff5252');
        this.addScore(beam.freeze ? 500 : 800);
      }
    }
    if (beam.ageMs >= beam.totalMs) this.beamEffect = null;
  }

  private updateChickenRun(dtMs: number): void {
    const run = this.chickenRun;
    if (!run) return;
    run.elapsedMs += dtMs;
    const t = Math.min(1, run.elapsedMs / run.totalMs);
    if (!run.effectFired && t >= 0.85 && this.enemy && !this.enemy.isDead) {
      run.effectFired = true;
      const x = lerp(run.startX, run.endX, t);
      const dmg = Math.round(this.enemy.maxHealth * 0.1);
      this.dealDamageTo(this.enemy, applyDefense(dmg, this.enemy.stats.defense), false);
      applyKnockback(this.enemy.body, run.dir, 320, 0.4);
      this.enemy.setAnim('knockback', true);
      this.enemy.hitstunRemainingMs = 500;
      this.particles.burst({ x, y: this.layout.groundY - 30 }, 14, { color: '#fff59d', shape: 'spark', size: 7, life: 0.4, maxLife: 0.4 });
      this.spawnComicText('BAGAWK!', x, this.layout.groundY - 60, '#fff59d');
      audio.play('hit');
      this.addScore(300);
    }
    if (t >= 1) this.chickenRun = null;
  }

  private updateBeeSwarmEffect(dtMs: number): void {
    const swarm = this.beeSwarmEffect;
    if (!swarm) return;
    swarm.ageMs += dtMs;
    const hitTimes = [250, 800, 1350];
    while (swarm.hitsFired < hitTimes.length && swarm.ageMs >= hitTimes[swarm.hitsFired]) {
      const idx = swarm.hitsFired;
      swarm.hitsFired += 1;
      const enemy = this.enemy;
      if (enemy && !enemy.isDead) {
        const dmg = Math.round(enemy.maxHealth * 0.035);
        this.dealDamageTo(enemy, applyDefense(dmg, enemy.stats.defense), false);
        enemy.applySlow(0.8, 500);
        this.particles.burst(enemy.body.pos, 6, { color: '#ffca28', shape: 'spark', size: 4, life: 0.3, maxLife: 0.3 });
        audio.play('hit');
        if (idx === 0) this.spawnComicText('BSSSZZ!', enemy.body.pos.x, this.layout.groundY - 140, '#ffca28');
      }
    }
    if (swarm.ageMs >= swarm.totalMs) this.beeSwarmEffect = null;
  }

  private updateRaven(dtMs: number): void {
    const raven = this.raven;
    if (!raven) return;
    raven.ageMs += dtMs;
    raven.wingPhase += dtMs;
    raven.cawTimerMs -= dtMs;
    if (raven.cawTimerMs <= 0 && raven.phase !== 'leaving') {
      raven.cawTimerMs = 2600 + Math.random() * 2600;
      audio.play('ravenCaw');
    }

    const enemyGone = !this.enemy || this.enemy.isDead;
    if (raven.phase !== 'leaving' && (raven.ageMs >= raven.maxAgeMs || raven.health <= 0 || enemyGone)) {
      this.setRavenPhase(raven, 'leaving', 700, raven.pos.x - raven.facing * 200, raven.pos.y - 220);
    }

    raven.phaseTimerMs -= dtMs;
    const t = raven.phaseDurationMs > 0 ? Math.min(1, 1 - Math.max(0, raven.phaseTimerMs / raven.phaseDurationMs)) : 1;
    const hoverX = this.player.body.pos.x - this.player.facing * 34 + Math.sin(raven.ageMs / 260) * 6;
    const hoverY = this.layout.groundY - 165 + Math.sin(raven.ageMs / 190) * 4;

    switch (raven.phase) {
      case 'entering':
        raven.pos.x = lerp(raven.fromX, raven.toX, t);
        raven.pos.y = lerp(raven.fromY, raven.toY, t);
        raven.facing = this.player.facing;
        if (raven.phaseTimerMs <= 0) raven.phase = 'hover';
        break;
      case 'hover':
        raven.pos.x = hoverX;
        raven.pos.y = hoverY;
        raven.facing = this.player.facing;
        raven.attackCooldownMs -= dtMs;
        if (raven.attackCooldownMs <= 0 && !enemyGone && this.enemy) {
          this.setRavenPhase(raven, 'diving', 420, this.enemy.body.pos.x, this.layout.groundY - 90);
        }
        break;
      case 'diving': {
        raven.pos.x = lerp(raven.fromX, raven.toX, t);
        raven.pos.y = lerp(raven.fromY, raven.toY, t);
        raven.facing = raven.toX >= raven.fromX ? 1 : -1;
        const enemy = this.enemy;
        if (enemy && enemy.anim === 'attack' && distance(raven.pos, enemy.body.pos) < 70 && Math.random() < 0.05) {
          raven.health -= 8;
          this.particles.burst(raven.pos, 6, { color: '#424242', shape: 'spark', size: 4, life: 0.3, maxLife: 0.3 });
        }
        if (raven.phaseTimerMs <= 0) {
          if (enemy && !enemy.isDead) {
            const dmg = Math.round(enemy.maxHealth * 0.025);
            this.dealDamageTo(enemy, applyDefense(dmg, enemy.stats.defense), false);
            enemy.hitstunRemainingMs = Math.max(enemy.hitstunRemainingMs, 250);
            enemy.setAnim('hit', true);
            this.particles.burst(raven.pos, 8, { color: '#424242', shape: 'spark', size: 5, life: 0.3, maxLife: 0.3 });
            audio.play('hit');
            this.addScore(120);
          }
          this.setRavenPhase(raven, 'pecking', 280, raven.pos.x, raven.pos.y);
        }
        break;
      }
      case 'pecking': {
        raven.pos.x = raven.fromX + Math.sin(raven.ageMs / 30) * 4;
        const enemy = this.enemy;
        if (enemy && enemy.anim === 'attack' && Math.random() < 0.05) {
          raven.health -= 8;
        }
        if (raven.phaseTimerMs <= 0) {
          this.setRavenPhase(raven, 'returning', 420, raven.pos.x, raven.pos.y);
        }
        break;
      }
      case 'returning':
        raven.toX = hoverX;
        raven.toY = hoverY;
        raven.pos.x = lerp(raven.fromX, raven.toX, t);
        raven.pos.y = lerp(raven.fromY, raven.toY, t);
        raven.facing = this.player.facing;
        if (raven.phaseTimerMs <= 0) {
          raven.phase = 'hover';
          raven.attackCooldownMs = 1600 + Math.random() * 1200;
        }
        break;
      case 'leaving':
        raven.pos.x = lerp(raven.fromX, raven.toX, t);
        raven.pos.y = lerp(raven.fromY, raven.toY, t);
        if (raven.phaseTimerMs <= 0) this.raven = null;
        break;
    }
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
    // Movement-quality pass 3: covers the full glance -> turn -> bend ->
    // held-release -> return motion (see the 'fart' pose in
    // renderFighter.ts, now 1.25s total) so the player isn't snapped back
    // to idle mid-animation.
    this.player.hitstunRemainingMs = 1250;
    audio.play('superpower');
    audio.vibrate([30, 40, 60, 40, 90]);
    this.shake.add(0.5);

    // Fires in the middle of the pose's held-release beat (bend completes
    // at 0.52s, hold runs to 0.85s) — well after the turn/bend has actually
    // finished, never before.
    window.setTimeout(() => this.fireSuperpower(id), 680);
  }

  private fireSuperpower(id: SuperpowerId): void {
    if (!this.enemy || this.enemy.isDead) return;
    const def = SUPERPOWERS[id];
    // Section (quality pass): each power gets its own base shape instead of
    // every non-nuclear power sharing the same puffy "cloud" blob — chili
    // specifically must never show a gas cloud, only fire. towardFacing=true
    // so the effect is clearly aimed at the enemy — the character is
    // oriented at them, not puffing off into empty space.
    const baseShape = id === 'nuclear' ? 'ring' : id === 'chili' ? 'flame' : id === 'ice' ? 'shard' : 'cloud';
    const baseSizeMult = id === 'chili' ? 1.7 : id === 'ice' ? 1.3 : 1.35;
    this.triggerFartEffect(this.player, def.color, baseSizeMult, baseShape, true);
    const dirAngle = this.player.facing > 0 ? 0 : Math.PI;
    this.fireSuperpowerVisual(
      id,
      this.player.body.pos.x + this.player.facing * 30,
      this.player.body.groundY - 26 * this.player.scale,
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
        // the enemy visibly backs away from the flame, with small residual
        // flame-lick embers left burning on them for a moment.
        this.enemy.setAnim('knockback', true);
        this.enemy.hitstunRemainingMs = Math.max(this.enemy.hitstunRemainingMs, 320);
        applyKnockback(this.enemy.body, this.player.facing, 140, 0.35);
        // Sized to match the now much bigger flame jet in
        // fireSuperpowerVisual — the enemy should look genuinely wrapped
        // in fire for a moment, not dotted with a few tiny embers.
        this.particles.burst({ x: this.enemy.body.pos.x, y: this.enemy.body.groundY - 40 * this.enemy.scale }, 10, {
          color: '#ff7043', shape: 'flame', size: 42, life: 0.5, maxLife: 0.5, gravity: -60,
        });
        break;
      case 'ice':
        this.enemy.applyFreeze(def.effectDurationMs);
        this.enemy.setAnim('hit', true);
        this.enemy.hitstunRemainingMs = Math.max(this.enemy.hitstunRemainingMs, 260);
        // A visible little burst of ice crystals right on the enemy so the
        // freeze reads as an actual ice impact, not just a status tint.
        this.particles.burst({ x: this.enemy.body.pos.x, y: this.enemy.body.groundY - 40 * this.enemy.scale }, 8, {
          color: '#b3e5fc', shape: 'shard', size: 6, life: 0.4, maxLife: 0.4, gravity: 30, rotSpeed: 4,
        });
        break;
      case 'electro':
        this.enemy.applyStun(def.effectDurationMs);
        break;
      case 'tornado':
        // Points 12-15: no instant knockback here — the real lift/spin/fall
        // sequence fires once the growing funnel visually reaches the enemy
        // (see fireSuperpowerVisual's 'tornado' case -> beginTornadoLift),
        // so it never reads as an immediate teleport the moment the button
        // is pressed. Just a brief flinch to sell "something's coming."
        this.enemy.setAnim('hit', true);
        this.enemy.hitstunRemainingMs = Math.max(this.enemy.hitstunRemainingMs, 350);
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
    // Persistent-progression pass: pickups update unconditionally, like the
    // systems above — a boss's coin/heart drop must keep animating and stay
    // collectible even during the frozen 'levelWon' overlay right after the
    // kill (see updatePickups' own comment).
    this.updatePickups(dtMs);
    if (this.coinFlashMs > 0) this.coinFlashMs -= rawDtMs;
    // Special-weapon effects likewise update unconditionally — a raven's
    // 15s lifetime, or a beam/chicken/swarm mid-flight, must not freeze if
    // the enemy dies (or the game pauses/overlays) while one is still active.
    this.updateBeamEffect(dtMs);
    this.updateRaven(dtMs);
    this.updateChickenRun(dtMs);
    this.updateBeeSwarmEffect(dtMs);

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
      const tornadoCarried = this.tornadoCarry?.target === enemy;
      if (!enemy.isDead && !tornadoCarried) this.updateEnemyAi(enemy, dtMs, dtSec);
      stepPhysics(enemy.body, dtSec, this.layout.minX, this.layout.maxX);
      if (tornadoCarried) this.updateTornadoCarry(dtMs);
      this.updateDeathSequence(enemy, dtMs);
    }

    // --- attack hit-frame resolution ---
    this.resolveAttackHitFrame(player, enemy);
    if (enemy) this.resolveAttackHitFrame(enemy, player);

    this.updateProjectiles(dtSec);
    this.updateHazards(dtSec);
    this.updateTornadoEffect(dtMs);
    this.updateStork(dtMs);
    if (this.airSupportCooldownMs > 0) this.airSupportCooldownMs -= dtMs;

    for (const [id, ms] of this.superpowerCooldowns) {
      if (ms > 0) this.superpowerCooldowns.set(id, Math.max(0, ms - dtMs));
    }

    if (enemy?.deathPhase === 'done' && !this.levelWonHandled && this.celebratingEnemy !== enemy) {
      if (enemy.kind === 'boss') {
        this.handleEnemyDefeated(enemy);
      } else {
        // Point 2: the enemy has finished falling/lying/fading — give the
        // player a short, real celebration beat (fist-pump taunt pose) that
        // actually registers the kill before the level moves on.
        this.celebratingEnemy = enemy;
        this.celebrationTimerMs = 2600;
        player.setAnim('taunt', true);
        player.hitstunRemainingMs = Math.max(player.hitstunRemainingMs, this.celebrationTimerMs);
        player.body.vel.x = 0;
        audio.play('victory');
        this.showToast('SIEG!', this.celebrationTimerMs);
      }
    }
    if (this.celebratingEnemy) {
      this.celebrationTimerMs -= dtMs;
      if (this.celebrationTimerMs <= 0) {
        const defeated = this.celebratingEnemy;
        this.celebratingEnemy = null;
        this.handleEnemyDefeated(defeated);
      }
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
        // Root-cause fix (gameplay/animation pass): this used to also flip
        // to 'lying' once the timer ran out, even if the body was still
        // airborne (e.g. a critical-hit launch that takes longer than the
        // timer to actually land) — that rendered the "lying"/"fallen" pose
        // while the fighter still floated above groundY, reading as
        // "hanging in the air." The real ground contact (body.grounded) is
        // now the only real trigger; the timer is just a stuck-body
        // failsafe (e.g. wedged at an arena wall) that waits far longer.
        if (f.body.grounded && Math.abs(f.body.vel.x) < 10) {
          f.deathPhase = 'lying';
          f.deathTimerMs = 650;
          f.setAnim('fallen', true);
        } else if (f.deathTimerMs <= -3500) {
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

  // Point 12/14: kicks off the real lift once the growing funnel visually
  // reaches the enemy (called from fireSuperpowerVisual's 'tornado' case,
  // not immediately on button press) — a strong upward launch via the
  // normal physics body plus an orbiting x-position for updateTornadoCarry
  // to drive each frame, so gravity genuinely brings them back down rather
  // than the position being snapped.
  private beginTornadoLift(): void {
    const enemy = this.enemy;
    if (!enemy || enemy.isDead) return;
    if (enemy.kind === 'boss') {
      // Point 15: bosses resist the full lift — a firm push-back instead.
      const dir = Math.sign(enemy.body.pos.x - this.player.body.pos.x) || this.player.facing;
      applyKnockback(enemy.body, dir, 260, 0.22);
      enemy.setAnim('stagger', true);
      enemy.hitstunRemainingMs = Math.max(enemy.hitstunRemainingMs, 500);
      this.shake.add(0.35);
      return;
    }
    this.tornadoCarry = { target: enemy, ageMs: 0, totalMs: 950, centerX: enemy.body.pos.x };
    enemy.body.vel.y = -780;
    enemy.body.vel.x = 0;
    enemy.body.grounded = false;
    enemy.setAnim('knockback', true);
    enemy.hitstunRemainingMs = 1500;
    this.shake.add(0.5);
    audio.vibrate([20, 30, 60]);
  }

  private updateTornadoCarry(dtMs: number): void {
    const carry = this.tornadoCarry;
    if (!carry) return;
    carry.ageMs += dtMs;
    const t = Math.min(1, carry.ageMs / carry.totalMs);
    const spins = 2.5;
    const radius = 22 * Math.sin(Math.PI * Math.min(1, t * 1.15));
    const angle = t * spins * Math.PI * 2;
    const orbitedX = carry.centerX + Math.cos(angle) * radius;
    carry.target.body.pos.x = Math.max(this.layout.minX + 20, Math.min(this.layout.maxX - 20, orbitedX));
    if (carry.target.body.grounded || t >= 1) {
      this.tornadoCarry = null;
      if (carry.target.body.grounded && !carry.target.isDead) {
        // Point 14: a clear, real landing beat, not a silent stop — 'stagger'
        // (not 'fallen', which is the death-only lying pose and would never
        // get reset back to idle by the normal AI branch below) so control
        // hands back cleanly once hitstun expires.
        carry.target.setAnim('stagger', true);
        carry.target.hitstunRemainingMs = Math.max(carry.target.hitstunRemainingMs, 500);
        this.particles.burst(carry.target.body.pos, 10, { color: '#c9b28a', shape: 'dust', size: 6, life: 0.4, maxLife: 0.4, gravity: 150 });
        this.shake.add(0.3);
      }
    }
  }

  // How big the sweeping funnel is at a given point (0..1) through its
  // travel — starts as a small dust-devil and ends up towering over a
  // fighter by the time it reaches the far wall.
  private tornadoRadius(t: number): number {
    return 20 + t * 82;
  }

  // Point 12/17 (follow-up): advances the funnel one real frame at a
  // time — position sweeps linearly from where it was summoned to the far
  // arena wall, rotation keeps accumulating (and accelerates as it grows),
  // and it checks for the enemy continuously rather than at one scheduled
  // instant, so however fast or slow a run happens to tick, the lift fires
  // exactly when the funnel visually reaches them.
  private updateTornadoEffect(dtMs: number): void {
    const tornado = this.tornadoEffect;
    if (!tornado) return;
    tornado.ageMs += dtMs;
    const t = Math.min(1, tornado.ageMs / tornado.totalMs);
    tornado.x = tornado.startX + (tornado.endX - tornado.startX) * t;
    const spinSpeedRadPerSec = 5 + t * 10; // intensifying rotation as it grows
    tornado.rotation += spinSpeedRadPerSec * (dtMs / 1000);

    const radius = this.tornadoRadius(t);
    const groundY = this.layout.groundY;
    // Ambient dust/grass/debris kicked up continuously along its path.
    if (Math.random() < 0.65) {
      const a = tornado.rotation * 1.7 + Math.random() * Math.PI * 2;
      this.particles.burst({
        x: tornado.x + Math.cos(a) * radius * 0.75,
        y: groundY - Math.abs(Math.sin(a)) * radius * 0.85,
      }, 1, {
        color: Math.random() < 0.4 ? '#8d6e63' : Math.random() < 0.7 ? '#aed581' : '#cfd8dc',
        shape: Math.random() < 0.3 ? 'spark' : 'dust',
        size: 5 + radius * 0.12, life: 0.45, maxLife: 0.45, gravity: -25,
      });
    }

    if (!tornado.hasHitEnemy && this.enemy && !this.enemy.isDead) {
      if (Math.abs(this.enemy.body.pos.x - tornado.x) < radius * 0.6) {
        tornado.hasHitEnemy = true;
        this.beginTornadoLift();
      }
    }

    if (t >= 1) this.tornadoEffect = null;
  }

  // Follow-up ("nicht wie Kreise, sondern wie ein echter Wirbelwind"): the
  // old version was a stack of discrete ellipses, which read as a pile of
  // circles rather than one funnel. This draws ONE continuous, turbulent
  // cone silhouette (narrow where it touches the ground, wide at the top —
  // the classic 🌪️ shape) plus several spiral stripes that wind around it
  // and keep winding as `rotation` advances, so the whirling motion is
  // unmistakable rather than implied by offsetting flat ovals.
  private renderTornadoEffect(ctx: CanvasRenderingContext2D): void {
    const tornado = this.tornadoEffect;
    if (!tornado) return;
    const t = Math.min(1, tornado.ageMs / tornado.totalMs);
    const topRadius = this.tornadoRadius(t);
    const bottomRadius = Math.max(6, topRadius * 0.16);
    const groundY = this.layout.groundY;
    const height = topRadius * 2.5;
    const samples = 24;
    const edgeAt = (h: number, side: 1 | -1): number => {
      const r = bottomRadius + (topRadius - bottomRadius) * h;
      // A turbulent wobble on the silhouette itself — not a smooth cone —
      // so the outline never looks like a clean, static circle stack.
      const wobble = Math.sin(tornado.rotation * 2.6 + h * 8.5) * r * 0.14;
      return tornado.x + side * (r + wobble);
    };

    ctx.save();

    // Dust skirt where the funnel actually touches down.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(120,100,80,0.5)';
    ctx.beginPath();
    ctx.ellipse(tornado.x, groundY + 2, bottomRadius * 2.4, bottomRadius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // The funnel body: one filled path from the ground up the left edge,
    // across the top, and back down the right edge.
    ctx.globalAlpha = 0.5 + Math.min(0.3, t * 0.35);
    ctx.fillStyle = 'rgba(118,108,98,0.55)';
    ctx.beginPath();
    ctx.moveTo(tornado.x, groundY);
    for (let i = 0; i <= samples; i++) {
      const h = i / samples;
      ctx.lineTo(edgeAt(h, -1), groundY - h * height);
    }
    for (let i = samples; i >= 0; i--) {
      const h = i / samples;
      ctx.lineTo(edgeAt(h, 1), groundY - h * height);
    }
    ctx.closePath();
    ctx.fill();

    // A soft, wider cloud cap at the very top — the funnel's "head."
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = 'rgba(150,145,140,0.5)';
    ctx.beginPath();
    ctx.ellipse(tornado.x, groundY - height, topRadius * 1.05, topRadius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Spiral stripes winding around the cone — the actual "whirlwind" read,
    // continuously rotating rather than a static twist offset per band.
    const spiralCount = 3;
    for (let s = 0; s < spiralCount; s++) {
      const phase = tornado.rotation * 2.4 + (s / spiralCount) * Math.PI * 2;
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const h = i / samples;
        const r = (bottomRadius + (topRadius - bottomRadius) * h) * 0.8;
        const a = phase + h * Math.PI * 3.6; // several wraps bottom to top
        const px = tornado.x + Math.cos(a) * r;
        const py = groundY - h * height;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = s % 2 === 0 ? 'rgba(220,225,228,0.8)' : 'rgba(120,95,80,0.7)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    ctx.restore();
  }

  private handleEnemyDefeated(enemy: Fighter): void {
    this.levelWonHandled = true;
    this.enemiesDefeated += 1;
    this.addScore(BALANCE.score.kill);
    if (enemy.kind === 'boss') {
      this.bossesDefeated += 1;
      this.addScore(BALANCE.boss.scoreBonus);
      if (this.bossDefId) this.spawnBossRewards(enemy, BOSSES[this.bossDefId]);
    } else {
      this.addScore(enemy.scoreValue);
      // Balance pass: every normal kill now earns a small coin reward too
      // (previously only bosses dropped coins) — scaled down from the
      // enemy's own scoreValue so weaker enemies give a couple of coins and
      // tougher normal enemies a bit more, but deliberately small next to
      // shop prices (cheapest special weapon is 30 coins) so a couple of
      // early kills can never already afford one; coins stay a steady,
      // gradual reward, with bosses remaining the big lump-sum payout.
      this.spawnEnemyCoinDrop(enemy, Math.max(1, Math.round(enemy.scoreValue / 40)));
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
  // Persistent-progression pass: coin/heart pickups
  // ---------------------------------------------------------------------

  /** A single small coin pickup for a normal-enemy kill — same physics/
   * homing/collection path as a boss's coin pile (updatePickups below),
   * just one modest coin instead of a multi-coin scatter, so a routine
   * kill still feels rewarded without approaching boss-payout territory. */
  private spawnEnemyCoinDrop(enemy: Fighter, value: number): void {
    pickupCounter += 1;
    this.pickups.push({
      id: pickupCounter,
      kind: 'coin',
      pos: { x: enemy.body.pos.x, y: this.layout.groundY - 80 },
      vel: { x: (Math.random() - 0.5) * 60, y: -190 - Math.random() * 40 },
      ageMs: 0,
      value,
      homing: false,
    });
    this.particles.burst({ x: enemy.body.pos.x, y: this.layout.groundY - 70 }, 6, {
      color: '#ffd54f', shape: 'spark', size: 5, life: 0.35, maxLife: 0.35,
    });
  }

  /** Spawns a boss's rewards (section 1/13/16 of the brief): several
   * individual coins that pop up and briefly scatter before settling, worth
   * `def.coinReward` combined, plus — for bosses flagged `dropsHeart` — one
   * extra life pickup. Not every boss drops a heart, so boss fights stay
   * varied rather than every victory feeling identical. */
  private spawnBossRewards(enemy: Fighter, def: BossDef): void {
    const total = def.coinReward;
    const coinCount = Math.min(8, Math.max(4, Math.round(total / 22)));
    const baseValue = Math.floor(total / coinCount);
    const remainder = total - baseValue * coinCount;
    for (let i = 0; i < coinCount; i++) {
      const value = baseValue + (i < remainder ? 1 : 0);
      const angle = (i / coinCount) * Math.PI * 2;
      pickupCounter += 1;
      this.pickups.push({
        id: pickupCounter,
        kind: 'coin',
        pos: {
          x: enemy.body.pos.x + Math.cos(angle) * (14 + Math.random() * 20),
          y: this.layout.groundY - 90 - Math.random() * 30,
        },
        vel: { x: Math.cos(angle) * (60 + Math.random() * 40), y: -200 - Math.random() * 90 },
        ageMs: 0,
        value,
        homing: false,
      });
    }
    if (def.dropsHeart) {
      pickupCounter += 1;
      this.pickups.push({
        id: pickupCounter,
        kind: 'heart',
        pos: { x: enemy.body.pos.x, y: this.layout.groundY - 130 },
        vel: { x: 0, y: -170 },
        ageMs: 0,
        value: 1,
        homing: false,
      });
    }
    this.particles.burst({ x: enemy.body.pos.x, y: this.layout.groundY - 70 }, 16, {
      color: '#ffd54f', shape: 'spark', size: 8, life: 0.5, maxLife: 0.5,
    });
  }

  /** Runs every tick unconditionally (like particles/shake/comicTexts
   * below), regardless of `phase` — a boss's coin/heart drop must keep
   * animating and be guaranteed to reach the player even during the frozen
   * 'levelWon' overlay that follows the kill (see the Pickup interface's
   * comment). Pickups pop up under light gravity, settle briefly, then home
   * toward wherever the player currently stands; a 6s age cap forces
   * collection regardless, so a reward is never stranded off-screen. */
  private updatePickups(dtMs: number): void {
    const dtSec = dtMs / 1000;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.ageMs += dtMs;
      if (!p.homing) {
        p.vel.y += BALANCE.physics.gravity * 0.5 * dtSec;
        p.pos.x += p.vel.x * dtSec;
        p.pos.y += p.vel.y * dtSec;
        const floorY = this.layout.groundY - 20;
        if (p.pos.y >= floorY) {
          p.pos.y = floorY;
          p.vel.x *= 0.85;
          p.vel.y = 0;
        }
        if (p.ageMs > 650) p.homing = true;
      } else {
        const target = this.player.body.pos;
        const dx = target.x - p.pos.x;
        const dy = target.y - 60 - p.pos.y;
        const dist = Math.hypot(dx, dy) || 1;
        const speed = 230;
        p.pos.x += (dx / dist) * speed * dtSec;
        p.pos.y += (dy / dist) * speed * dtSec;
        if (dist < 26 || p.ageMs > 6000) {
          this.collectPickup(p);
          this.pickups.splice(i, 1);
        }
      }
    }
  }

  private collectPickup(p: Pickup): void {
    if (p.kind === 'coin') {
      useAppStore.getState().addCoins(p.value);
      this.coinFlashMs = 550;
      this.particles.burst(p.pos, 8, { color: '#ffd54f', shape: 'spark', size: 6 });
      audio.play('coinPickup');
    } else {
      // Section 13 of the brief: a heart must never simply be wasted once
      // the player already sits at max lives — it converts into a small
      // bonus-coin reward instead of vanishing for nothing.
      if (this.livesRemaining < GameEngine.MAX_LIVES) {
        this.livesRemaining += 1;
        this.showToast('❤️ LEBEN WIEDERHERGESTELLT!', 1400);
        audio.play('heartPickup');
        this.particles.burst(p.pos, 12, { color: '#ff5252', shape: 'circle', size: 7 });
      } else {
        useAppStore.getState().addCoins(15);
        this.coinFlashMs = 550;
        this.showToast('❤️ bereits voll → +15 🪙 BONUS!', 1400);
        audio.play('coinPickup');
        this.particles.burst(p.pos, 8, { color: '#ffd54f', shape: 'spark', size: 6 });
      }
    }
  }

  private renderPickups(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pickups) {
      ctx.save();
      ctx.translate(p.pos.x, p.pos.y);
      if (p.kind === 'coin') {
        const shine = 0.5 + Math.sin(performance.now() / 110 + p.id) * 0.5;
        ctx.fillStyle = '#ffca28';
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f57f17';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.25 + shine * 0.35})`;
        ctx.beginPath();
        ctx.arc(-3, -3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8d6e00';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 1);
      } else {
        const pulse = 1 + Math.sin(performance.now() / 150) * 0.14;
        ctx.scale(pulse, pulse);
        ctx.fillStyle = '#ff1744';
        ctx.beginPath();
        ctx.moveTo(0, 7);
        ctx.bezierCurveTo(-15, -7, -14, -17, 0, -6);
        ctx.bezierCurveTo(14, -17, 15, -7, 0, 7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#b71c1c';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
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
      if (h.kind === 'bonusBomb' || h.kind === 'diaperBomb' || h.kind === 'poopBomb' || h.kind === 'eggBomberEgg') {
        h.vel.y += BALANCE.physics.gravity * 0.7 * dtSec;
      }
      // Persistent-progression pass: the "Riesen-Bumerang" special weapon's
      // return leg homes on the player's current position every tick
      // (mirroring updateProjectiles' own boomerang-return math) rather than
      // flying a fixed line, since the player may have moved since it was
      // thrown — and it never re-triggers on the way back (see the target
      // loop below), matching the brief's "kommt garantiert zurück" flavor.
      if (h.kind === 'bigBoomerangBack') {
        const dx = this.player.body.pos.x - h.pos.x;
        const dy = (this.layout.groundY - 70) - h.pos.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed = 480;
        h.vel.x = (dx / len) * speed;
        h.vel.y = (dy / len) * speed;
        if (len < 40) {
          this.hazards.splice(i, 1);
          continue;
        }
      }
      h.pos.x += h.vel.x * dtSec;
      h.pos.y += h.vel.y * dtSec;
      if (h.kind === 'balloon') {
        h.pos.y += Math.sin(h.timer / 200) * 0.6;
      }

      if (h.kind !== 'bigBoomerangBack') {
        const targets = h.owner === 'enemy' ? [this.player] : this.enemy ? [this.enemy] : [];
        for (const target of targets) {
          if (!target || target.isDead || h.triggered) continue;
          const groundish = h.kind === 'banana' ? target.body.groundY : this.layout.groundY - 55;
          const dist = distance(h.pos, { x: target.body.pos.x, y: h.kind === 'banana' ? target.body.groundY : groundish });
          if (dist < h.radius) {
            this.triggerHazard(h, target);
          }
        }
      }

      if ((h.kind !== 'banana' && h.timer <= 0) || h.triggered) {
        const timerFired = ['egg', 'bonusBomb', 'frostNova', 'diaperBomb', 'tornado'] as Hazard['kind'][];
        if (timerFired.includes(h.kind) && h.timer <= 0 && !h.triggered) {
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
    if (h.kind === 'bigBoomerangOut') {
      // Deals its hit, then converts into the return leg instead of being
      // removed — see updateHazards' bigBoomerangBack homing above.
      audio.play('hit');
      this.particles.burst(h.pos, 14, { color: '#8d6e63', shape: 'spark', size: 7, life: 0.4, maxLife: 0.4 });
      this.shake.add(0.3);
      if (directTarget) {
        const dmg = Math.round(directTarget.maxHealth * 0.12);
        this.dealDamageTo(directTarget, applyDefense(dmg, directTarget.stats.defense), false);
        applyKnockback(directTarget.body, Math.sign(directTarget.body.pos.x - h.pos.x) || 1, 300, 0.4);
        directTarget.setAnim('knockback', true);
        directTarget.hitstunRemainingMs = 550;
        this.spawnComicText('WUMM!', h.pos.x, h.pos.y - 20, '#a1887f');
        this.addScore(450);
      }
      h.kind = 'bigBoomerangBack';
      h.timer = 1600;
      h.triggered = false;
      return;
    }
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
    } else if (h.kind === 'poopBomb') {
      // "Kot-Katapult" special weapon — a lobbed, mid-power distraction
      // hit: a real daze (matching the banana peel's own stun beat), not
      // just chip damage.
      this.particles.burst(h.pos, 18, { color: '#6d4c2f', shape: 'dust', size: 9, life: 0.5, maxLife: 0.5, gravity: 120 });
      audio.play('explosion');
      this.shake.add(0.3);
      if (directTarget) {
        const dmg = Math.round(directTarget.maxHealth * 0.08);
        this.dealDamageTo(directTarget, applyDefense(dmg, directTarget.stats.defense), false);
        directTarget.setAnim('dazed', true);
        directTarget.hitstunRemainingMs = 900;
        directTarget.dazedUntilMs = 900;
        this.spawnComicText('PLATSCH!', h.pos.x, h.pos.y - 10, '#a1887f');
        this.addScore(350);
        this.showToast('💩 VOLLTREFFER!', 900);
      }
    } else if (h.kind === 'explodingDuck') {
      // "Explodierende Ente" — waddles into range, then a real AoE
      // explosion, not a plain melee hit (matches its category as an aoe
      // special weapon, priced above the melee-flavoured ones).
      this.particles.burst(h.pos, 22, { color: '#fff59d', shape: 'circle', size: 6, life: 0.5, maxLife: 0.5, gravity: -40 });
      this.particles.burst(h.pos, 14, { color: '#616161', shape: 'dust', size: 9, life: 0.5, maxLife: 0.5, gravity: 100 });
      audio.play('explosion');
      this.shake.add(0.45);
      this.hitStop.trigger(80);
      if (directTarget) {
        const dmg = Math.round(directTarget.maxHealth * 0.14);
        this.dealDamageTo(directTarget, applyDefense(dmg, directTarget.stats.defense), false);
        applyKnockback(directTarget.body, Math.sign(directTarget.body.pos.x - h.pos.x) || 1, 340, 0.45);
        directTarget.setAnim('knockback', true);
        directTarget.hitstunRemainingMs = 700;
        this.spawnComicText('QUAK! BUMM!', h.pos.x, h.pos.y - 30, '#fff59d');
        this.addScore(500);
        this.showToast('🦆 QUAK-BOOM!', 900);
      }
    } else if (h.kind === 'tornado') {
      // "Mini-Tornado" — spawned right on top of the enemy (see
      // summonTornado), so it always fires via its own short fuse rather
      // than a proximity check. A single hit plus several quick alternating
      // knockback pulses so the enemy visibly gets "flung around" instead
      // of one flat shove.
      const target = this.enemy;
      if (target && !target.isDead) {
        const dmg = Math.round(target.maxHealth * 0.1);
        this.dealDamageTo(target, applyDefense(dmg, target.stats.defense), false);
        target.applySlow(0.55, 1400);
        target.setAnim('knockback', true);
        target.hitstunRemainingMs = 1200;
        this.spawnComicText('WIRBEL!', h.pos.x, h.pos.y - 40, '#cfd8dc');
        this.addScore(450);
        audio.play('hit');
        this.shake.add(0.5);
        let pulseDir: 1 | -1 = 1;
        for (let i = 0; i < 4; i++) {
          window.setTimeout(() => {
            const enemy = this.enemy;
            if (!enemy || enemy.isDead) return;
            applyKnockback(enemy.body, pulseDir, 220, 0.25);
            pulseDir = pulseDir === 1 ? -1 : 1;
            this.particles.burst(enemy.body.pos, 8, { color: '#eceff1', shape: 'dust', size: 6, life: 0.35, maxLife: 0.35, gravity: 0 });
          }, i * 160);
        }
      }
    } else if (h.kind === 'eggBomberEgg') {
      // One of several eggs dropped by the "Eier-Bomber" special weapon
      // (see launchEggBomber) — each a modest hit, several together add up
      // to a real payoff without any single egg being a huge swing.
      this.particles.burst(h.pos, 12, { color: '#fff8e1', shape: 'circle', size: 6, life: 0.4, maxLife: 0.4, gravity: 60 });
      audio.play('hit');
      if (directTarget) {
        const dmg = Math.round(directTarget.maxHealth * 0.045);
        this.dealDamageTo(directTarget, applyDefense(dmg, directTarget.stats.defense), false);
        directTarget.hitstunRemainingMs = Math.max(directTarget.hitstunRemainingMs, 300);
        this.spawnComicText('KRACH!', h.pos.x, h.pos.y - 10, '#fff8e1');
        this.addScore(200);
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
  private triggerFartEffect(f: Fighter, color: string, sizeMult = 1, shape: 'cloud' | 'ring' | 'drop' | 'flame' | 'shard' = 'cloud', towardFacing = false): void {
    // Section 7 (polish pass): active superpowers aim the effect at the
    // enemy (towardFacing=true — the character is oriented at them, so the
    // cloud/blast originates and drifts on that side), while the death-fart
    // keeps its original behind-the-back puff (towardFacing=false, default)
    // since nothing is being aimed at anyone there.
    const dir = towardFacing ? f.facing : -f.facing;
    const originX = f.body.pos.x + dir * 30;
    // Movement-quality pass 3 (root-cause fix): the gas must originate at
    // the actual crouched hip/diaper height, not a fixed chest-level point
    // — the old constant (-55) was tuned for a standing pose and made the
    // cloud visibly pop out of the belly/chest instead of the butt once the
    // character is genuinely bent over (see the 'fart' pose's shoulderDrop/
    // hipY). Scaled by f.scale so it also holds for any non-player fighter
    // that plays the death-fart (bosses/enemies at different sizes).
    const originY = f.body.groundY - 26 * f.scale;
    // Movement-quality pass 3: the burst now genuinely travels toward the
    // enemy (a tight jet for flame/shards, a wider puffy spread for the
    // plain gas cloud) instead of exploding evenly in every direction —
    // "die Wolke soll vom Charakter weg zum Gegner schweben."
    const dirAngle = dir > 0 ? 0 : Math.PI;
    const spread = shape === 'flame' || shape === 'shard' ? 0.32 : 0.85;
    this.particles.burstDirectional({ x: originX, y: originY }, Math.round(16 * sizeMult), dirAngle, spread, {
      color, shape, size: 10 * sizeMult, life: 0.75, maxLife: 0.75, gravity: shape === 'cloud' ? -35 : 20,
    });
    // A second, smaller layer of puffs at a different size so a plain gas
    // cloud reads as several soft cloud pieces merging rather than one
    // uniform blob.
    if (shape === 'cloud') {
      this.particles.burstDirectional({ x: originX, y: originY }, Math.round(9 * sizeMult), dirAngle, spread * 1.1, {
        color, shape, size: 6 * sizeMult, life: 0.6, maxLife: 0.6, gravity: -25,
      });
    }
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
        // Quality pass: the flame must actually reach and visually engulf
        // the enemy, not just flicker a short distance in front of the
        // character — sizes are ~6x the original (huge overlapping flame
        // shapes instead of small licks) and each wave's reach now scales
        // to the real distance to the enemy (capped so it never overshoots
        // past them) instead of a fixed short per-wave step, so the fire
        // genuinely travels the full gap and wraps around the target.
        const targetDist = this.enemy
          ? Math.min(280, Math.max(60, distance({ x: originX, y: originY }, this.enemy.body.pos)))
          : 140;
        const waveCount = 7;
        for (let wave = 0; wave < waveCount; wave++) {
          window.setTimeout(() => {
            if (!this.enemy) return;
            const reach = (targetDist * (wave + 1)) / waveCount;
            const wx = originX + Math.cos(dirAngle) * reach;
            const wy = originY + Math.sin(dirAngle) * reach;
            this.particles.burstDirectional({ x: wx, y: wy }, 8, dirAngle, 0.45, {
              color: wave % 2 === 0 ? '#ff5722' : '#ffc107',
              shape: 'flame', size: 90 - wave * 6, life: 0.55, maxLife: 0.55, gravity: -70,
            });
            this.particles.burstDirectional({ x: wx, y: wy }, 4, dirAngle, 0.6, {
              color: '#ffee58', shape: 'spark', size: 16, life: 0.3, maxLife: 0.3, gravity: -140,
            });
          }, wave * 55);
        }
        break;
      }
      case 'ice': {
        // Snow-cannon rework (point 10): "❄️ SCHNEE-KANONEN-FURZ" — a real
        // blast of snow + ice crystals that travels the gap to the enemy in
        // waves (same traveling-wave approach as chili's flame) and widens
        // as it nears them, so the impact reads as a real snow blast
        // burying them rather than a thin frost beam.
        const targetDist = this.enemy
          ? Math.min(260, Math.max(60, distance({ x: originX, y: originY }, this.enemy.body.pos)))
          : 130;
        const waveCount = 5;
        for (let wave = 0; wave < waveCount; wave++) {
          window.setTimeout(() => {
            const reach = (targetDist * (wave + 1)) / waveCount;
            const wx = originX + Math.cos(dirAngle) * reach;
            const wy = originY + Math.sin(dirAngle) * reach;
            const spread = 0.26 + wave * 0.14;
            this.particles.burstDirectional({ x: wx, y: wy }, 11, dirAngle, spread, {
              color: wave % 2 === 0 ? '#ffffff' : '#e1f5fe', shape: 'dust', size: 15 - wave, life: 0.6, maxLife: 0.6, gravity: 60,
            });
            this.particles.burstDirectional({ x: wx, y: wy }, 5, dirAngle, spread, {
              color: '#81d4fa', shape: 'shard', size: 8, life: 0.5, maxLife: 0.5, gravity: 20, rotSpeed: 5,
            });
          }, wave * 70);
        }
        break;
      }
      case 'electro':
        this.particles.burstDirectional({ x: originX, y: originY }, 10, dirAngle, 0.45, {
          color: '#ffeb3b', shape: 'spark', size: 10, life: 0.28, maxLife: 0.28, gravity: 0,
        });
        break;
      case 'tornado': {
        // Whirlwind-Furz follow-up: "über das ganze Spielfeld fegen und
        // dabei größer werden und sich animiert drehen" — a real world-space
        // funnel (see TornadoEffect/updateTornadoEffect/renderTornadoEffect)
        // that sweeps from where it's summoned all the way to the far arena
        // wall, growing larger and spinning faster the entire way, redrawn
        // fresh every frame — not a handful of scheduled particle puffs.
        // The physical lift fires once it actually reaches the enemy
        // (checked continuously in updateTornadoEffect), not immediately.
        const dir: 1 | -1 = Math.cos(dirAngle) >= 0 ? 1 : -1;
        this.tornadoEffect = {
          x: originX,
          startX: originX,
          endX: dir > 0 ? this.layout.maxX : this.layout.minX,
          ageMs: 0,
          totalMs: 2400,
          rotation: 0,
          hasHitEnemy: false,
        };
        break;
      }
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
    this.renderPickups(ctx);

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
    this.renderChickenRun(ctx);
    this.renderBeeSwarmEffect(ctx);
    this.renderRaven(ctx);
    this.renderBeamEffect(ctx);
    this.renderTornadoEffect(ctx);
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

  /** A real multi-layer laser/ice beam (brief section 6: "muss wirklich wie
   * ein Laserstrahl aussehen, nicht nur eine rote Linie") — a wide soft
   * glow, a bright core, and a thin white-hot center line, all sweeping out
   * from the source over the first third of the beam's lifetime so it
   * genuinely appears to travel across the screen before it fades. */
  private renderBeamEffect(ctx: CanvasRenderingContext2D): void {
    const beam = this.beamEffect;
    if (!beam) return;
    const growT = Math.min(1, beam.ageMs / (beam.totalMs * 0.35));
    const curX = lerp(beam.fromX, beam.toX, growT);
    const curY = lerp(beam.fromY, beam.toY, growT);
    const fadeStart = beam.totalMs * 0.7;
    const fadeT = beam.ageMs > fadeStart ? (beam.ageMs - fadeStart) / (beam.totalMs - fadeStart) : 0;
    const alpha = Math.max(0, 1 - fadeT);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.strokeStyle = beam.color;
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(beam.fromX, beam.fromY); ctx.lineTo(curX, curY); ctx.stroke();
    ctx.strokeStyle = beam.coreColor;
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(beam.fromX, beam.fromY); ctx.lineTo(curX, curY); ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(beam.fromX, beam.fromY); ctx.lineTo(curX, curY); ctx.stroke();
    // Muzzle flare at the source, cannon-mouth style.
    ctx.fillStyle = beam.coreColor;
    ctx.beginPath();
    ctx.arc(beam.fromX, beam.fromY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private renderChickenRun(ctx: CanvasRenderingContext2D): void {
    const run = this.chickenRun;
    if (!run) return;
    const t = Math.min(1, run.elapsedMs / run.totalMs);
    const x = lerp(run.startX, run.endX, t);
    const strideBob = Math.abs(Math.sin(run.elapsedMs / 40)) * 4;
    ctx.save();
    ctx.translate(x, this.layout.groundY - strideBob);
    ctx.scale(run.dir, 1);
    ctx.fillStyle = '#ff6f00';
    ctx.beginPath();
    ctx.moveTo(-3, -6); ctx.lineTo(3, -6); ctx.lineTo(0, 2); ctx.closePath(); ctx.fill();
    ctx.moveTo(9, -6); ctx.lineTo(15, -6); ctx.lineTo(12, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fdfdfd';
    ctx.beginPath();
    ctx.ellipse(0, -22, 16, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(11, -34, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.moveTo(8, -41); ctx.lineTo(11, -46); ctx.lineTo(14, -41); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff8f00';
    ctx.beginPath();
    ctx.moveTo(17, -34); ctx.lineTo(24, -32); ctx.lineTo(17, -30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#212121';
    ctx.beginPath();
    ctx.arc(14, -36, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private renderBeeSwarmEffect(ctx: CanvasRenderingContext2D): void {
    const swarm = this.beeSwarmEffect;
    const enemy = this.enemy;
    if (!swarm || !enemy) return;
    const cx = enemy.body.pos.x;
    const cy = this.layout.groundY - 100 * enemy.scale;
    for (let i = 0; i < 6; i++) {
      const angle = swarm.ageMs / 120 + (i / 6) * Math.PI * 2;
      const r = 34 + Math.sin(swarm.ageMs / 90 + i) * 6;
      const bx = cx + Math.cos(angle) * r;
      const by = cy + Math.sin(angle) * r * 0.6;
      ctx.save();
      ctx.translate(bx, by);
      ctx.fillStyle = '#ffca28';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212121';
      ctx.fillRect(-1, -2.5, 1.4, 5);
      ctx.restore();
    }
  }

  /** 🐦 The raven companion (brief section 7) — a genuine small character,
   * not a particle effect: wings that flap on `wingPhase`, a mini health
   * bar of its own, and a distinct facing/posture per phase. */
  private renderRaven(ctx: CanvasRenderingContext2D): void {
    const raven = this.raven;
    if (!raven) return;
    const flap = Math.sin(raven.wingPhase / 70);
    ctx.save();
    ctx.translate(raven.pos.x, raven.pos.y);
    ctx.scale(raven.facing, 1);
    ctx.fillStyle = '#212121';
    ctx.save();
    ctx.rotate(-0.3 - flap * 0.55);
    ctx.beginPath();
    ctx.ellipse(-2, 0, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(9, -4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8f00';
    ctx.beginPath();
    ctx.moveTo(14, -4); ctx.lineTo(20, -2); ctx.lineTo(14, -1); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(11, -6, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath(); ctx.arc(11.5, -6, 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const pct = Math.max(0, raven.health / raven.maxHealth);
    ctx.save();
    ctx.translate(raven.pos.x - 14, raven.pos.y - 24);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 28, 4);
    ctx.fillStyle = pct > 0.3 ? '#8bc34a' : '#ff5252';
    ctx.fillRect(0, 0, 28 * pct, 4);
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
    } else if (h.kind === 'poopBomb') {
      // "Kot-Katapult" — an absurd tumbling brown swirl, tabled visually
      // apart from bonusBomb (no fuse — it's not an explosive, it's gross).
      ctx.rotate(h.pos.x * 0.06);
      ctx.fillStyle = '#6d4c2f';
      ctx.beginPath();
      ctx.arc(0, 4, 8, 0, Math.PI * 2);
      ctx.arc(0, -2, 6, 0, Math.PI * 2);
      ctx.arc(0, -7, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (h.kind === 'explodingDuck') {
      // "Explodierende Ente" — a small yellow cartoon duck waddling toward
      // the enemy, legs bobbing, right up until it detonates.
      const bob = Math.sin(performance.now() / 60) * 2;
      ctx.translate(0, bob);
      ctx.fillStyle = '#ff8f00';
      ctx.beginPath();
      ctx.ellipse(-6, 8, 3, 2, 0, 0, Math.PI * 2);
      ctx.ellipse(6, 8, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fdd835';
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(9, -8, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff6f00';
      ctx.beginPath();
      ctx.moveTo(14, -8);
      ctx.lineTo(21, -6);
      ctx.lineTo(14, -4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#212121';
      ctx.beginPath();
      ctx.arc(11, -10, 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (h.kind === 'bigBoomerangOut' || h.kind === 'bigBoomerangBack') {
      // "Riesen-Bumerang" — a real oversized cross-blade, bigger and
      // chunkier than the normal boomerang weapon's thin arc.
      ctx.rotate(performance.now() / 90);
      ctx.fillStyle = '#8d6e63';
      ctx.strokeStyle = '#4e342e';
      ctx.lineWidth = 2;
      for (const angle of [0, Math.PI / 2]) {
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(0, 0, 26, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    } else if (h.kind === 'tornado') {
      // "Mini-Tornado" — a stack of rotating dashed rings, widening toward
      // the top, standing in for a funnel cloud.
      const spin = performance.now() / 130;
      for (let i = 0; i < 4; i++) {
        const ringY = -i * 14;
        const r = 14 + i * 7;
        ctx.strokeStyle = `rgba(207,216,220,${0.85 - i * 0.15})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, ringY, r, r * 0.4, 0, spin + i, spin + i + Math.PI * 1.5);
        ctx.stroke();
      }
    } else if (h.kind === 'eggBomberEgg') {
      // One of the "Eier-Bomber" eggs — simple and plain, deliberately
      // smaller/less detailed than the enemy 'egg' hazard so a volley of
      // several reads as a barrage, not a single big threat.
      ctx.fillStyle = '#fffde7';
      ctx.strokeStyle = '#bcaaa4';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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
      // Persistent-progression pass: read the coin balance fresh from the
      // store rather than this.save — the store replaces the save object
      // wholesale on every addCoins()/purchaseSpecialWeapon() call, so the
      // engine's own this.save reference (captured once at construction)
      // would otherwise go stale the moment the first coin is collected.
      coins: useAppStore.getState().save.coins,
      coinFlash: this.coinFlashMs > 0,
      specialWeaponId: this.player.hasSpecialWeaponId,
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
