import type { SuperpowerId, WeaponDef, WeaponId } from '../types';
import { Fighter } from '../entities/Fighter';
import { createBoss, createEnemy, createPlayer } from '../entities/factory';
import { ENEMIES } from '../../data/enemies';
import { BOSSES } from '../../data/bosses';
import { ARENAS } from '../../data/arenas';
import { getLevel } from '../../data/levels';
import { BALANCE } from '../../data/balance';
import { WEAPONS } from '../../data/weapons';
import { SUPERPOWERS } from '../../data/superpowers';
import type { SaveData } from '../../storage/saveData';
import { decideAiAction } from '../ai/aiTypes';
import { tickBossAbilities } from '../ai/bossBehavior';
import { applyKnockback, distance, stepPhysics } from '../physics/physics';
import { ParticleSystem } from '../effects/particles';
import { HitStop, ScreenShake } from '../effects/screenEffects';
import { audio } from '../audio/audioManager';
import { renderArena, type ArenaLayout } from './renderArena';
import { renderFighter } from './renderFighter';
import { applyDefense, resolveHit, scoreForHit } from './combatMath';

export type GamePhase = 'bossIntro' | 'playing' | 'levelWon' | 'gameOver' | 'paused' | 'arenaTransition';

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
  kind: 'egg' | 'balloon' | 'banana';
  pos: { x: number; y: number };
  vel: { x: number; y: number };
  timer: number;
  radius: number;
  owner: 'player' | 'enemy';
  triggered: boolean;
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

  phase: GamePhase = 'playing';
  bossIntroTimerMs = 0;
  levelWonHandled = false;

  score = 0;
  combo = 0;
  enemiesDefeated = 0;
  bossesDefeated = 0;
  highestCombo = 0;
  chaosMode = false;

  particles = new ParticleSystem();
  shake = new ScreenShake();
  hitStop = new HitStop();

  projectiles: Projectile[] = [];
  hazards: Hazard[] = [];

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
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.layout = {
      width: cssWidth,
      height: cssHeight,
      groundY: cssHeight * GROUND_FRACTION,
      minX: ARENA_SIDE_PADDING,
      maxX: cssWidth - ARENA_SIDE_PADDING,
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
    if (paused && this.phase !== 'gameOver') this.phase = 'paused';
    else if (!paused && this.phase === 'paused') this.phase = this.isBossLevel && !this.enemy?.introPlayed ? 'bossIntro' : 'playing';
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

    this.player.body.pos.x = this.layout.minX + 130;
    this.player.body.pos.y = this.layout.groundY;
    this.player.body.vel = { x: 0, y: 0 };
    this.player.setAnim('idle', true);

    if (level.isBoss && level.bossId) {
      const def = BOSSES[level.bossId];
      this.enemy = createBoss(def, this.layout.maxX - 140, this.layout.groundY, level.difficultyScale, level.sizeScale);
      this.enemy.setAnim('bossIntro', true);
      this.phase = 'bossIntro';
      this.bossIntroTimerMs = 2600;
      audio.play('bossIntro');
      audio.vibrate([40, 60, 80]);
    } else {
      const def = ENEMIES[level.enemyId] ?? ENEMIES.standard;
      this.enemy = createEnemy(def, this.layout.maxX - 140, this.layout.groundY, level.difficultyScale, level.sizeScale);
      this.phase = 'playing';
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
    if (this.phase !== 'playing') return;
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

  useSuperpower(id: SuperpowerId): void {
    if (this.phase !== 'playing') return;
    if (!this.save.unlockedSuperpowers.includes(id)) return;
    if ((this.superpowerCooldowns.get(id) ?? 0) > 0) return;
    const def = SUPERPOWERS[id];
    this.superpowerCooldowns.set(id, def.cooldownMs);
    this.player.setAnim('fart', true);
    this.player.hitstunRemainingMs = 500;
    audio.play('superpower');
    audio.vibrate([30, 40, 60, 40, 90]);
    this.shake.add(0.5);

    window.setTimeout(() => this.fireSuperpower(id), 260);
  }

  private fireSuperpower(id: SuperpowerId): void {
    if (!this.enemy || this.enemy.isDead) return;
    const def = SUPERPOWERS[id];
    const dir = -this.player.facing;
    const originX = this.player.body.pos.x + dir * 30;
    const originY = this.layout.groundY - 40;

    this.particles.burst({ x: originX, y: originY }, 22, {
      color: def.color, shape: id === 'nuclear' ? 'ring' : 'cloud', size: 10, life: 0.6, maxLife: 0.6, gravity: -40,
    });
    audio.play('fart');

    const hitsEnemy = distance(this.player.body.pos, this.enemy.body.pos) < 340;
    if (!hitsEnemy) return;

    const dmg = applyDefense(def.damage, this.enemy.stats.defense);
    this.dealDamageTo(this.enemy, dmg, false);
    this.addScore(BALANCE.score.superpowerHit);

    switch (id) {
      case 'gasCloud':
        this.enemy.applySlow(0.55, def.effectDurationMs);
        break;
      case 'chili':
        this.enemy.applyDot(6, def.effectDurationMs, '#ff5722');
        break;
      case 'ice':
        this.enemy.applyFreeze(def.effectDurationMs);
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

    if (this.phase === 'bossIntro') {
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

    if (this.toastTimerMs > 0) {
      this.toastTimerMs -= rawDtMs;
      if (this.toastTimerMs <= 0) this.toastMessage = null;
    }

    this.render();
    this.emitHud(rawDtMs);
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
        enemy.setAnim('stagger', true);
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
    }

    const decision = decideAiAction(enemy, this.player);
    if (decision.moveDir !== 0) {
      enemy.body.vel.x = decision.moveDir * enemy.effectiveMoveSpeed();
      enemy.facing = decision.moveDir;
      enemy.setAnim('run');
    } else {
      enemy.body.vel.x *= 0.7;
      if (enemy.anim === 'run') enemy.setAnim('idle');
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
    }
  }

  private resolveAttackHitFrame(attacker: Fighter, defender: Fighter | null): void {
    if (!defender || defender.isDead) return;
    if (attacker.anim !== 'attack' && attacker.anim !== 'kick') return;
    const applied = (attacker as Fighter & { pendingHitApplied?: boolean }).pendingHitApplied;
    if (applied) return;
    if (attacker.animTimeMs < 140) return;

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
          audio.play('fart');
          this.particles.burst({ x: f.body.pos.x - f.facing * 20, y: f.body.groundY - 8 }, 12, { color: '#9ccc65', shape: 'cloud', size: 8, life: 0.8, maxLife: 0.8, gravity: -20 });
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
  }

  private handlePlayerDefeated(): void {
    this.phase = 'gameOver';
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
        if (h.kind === 'egg' && h.timer <= 0 && !h.triggered) {
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
        this.particles.burst(h.pos, 8, { color: '#fdd835', shape: 'spark' });
        audio.play('hit');
        directTarget.setAnim('stagger', true);
        directTarget.hitstunRemainingMs = 700;
        applyKnockback(directTarget.body, directTarget.facing, 180, 0.5);
        this.addScore(400);
        this.showToast('AUSGERUTSCHT!');
      }
    }
  }

  // ---------------------------------------------------------------------
  // Score / toast helpers
  // ---------------------------------------------------------------------

  private addScore(amount: number): void {
    this.score += Math.max(0, Math.round(amount));
  }

  private showToast(msg: string): void {
    this.toastMessage = msg;
    this.toastTimerMs = 1100;
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  private render(): void {
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
    for (const f of fighters) renderFighter(ctx, f);

    this.particles.render(ctx);
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
