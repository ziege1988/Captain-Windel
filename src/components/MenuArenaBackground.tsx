import { useEffect, useRef } from 'react';
import { Fighter } from '../game/entities/Fighter';
import { BALANCE } from '../data/balance';
import { BOW_LOOSE_MS, drawDentures, renderFighter } from '../game/engine/renderFighter';
import { renderArena, type ArenaLayout } from '../game/engine/renderArena';
import { ARENAS } from '../data/arenas';
import { pickRandomWeather, type WeatherState } from '../game/engine/weather';
import { CHARACTERS } from '../data/characters';
import type { AnimState, CapeColorId, CharacterId } from '../game/types';

interface Props {
  characterId: CharacterId;
  capeColorId: CapeColorId;
}

/** Menu-visual pass: a small live arena scene behind the main menu instead
 * of a flat gradient — the same renderArena/renderFighter functions the
 * real game uses, but driven by a scripted director rather than a real
 * GameEngine, since this is purely decorative and never needs
 * physics/combat/input.
 *
 * It used to be one 8-second loop: the same challenger jogged in, took the
 * same kick and jogged off again, forever. Now there are four separate
 * scenes — each with its own arena, its own weather, its own challenger and
 * its own gag — played in a shuffled order that never repeats a scene back
 * to back, with a short dissolve between them. Two visits to the menu no
 * longer look alike, and a single visit does not show the same beat twice.
 *
 * Kept deliberately calm (slow scenes, no UI of its own) so it reads as "a
 * living background", not something competing with the menu buttons. */

// ---------------------------------------------------------------------------
// Menu-only effects. The real game's particle system lives inside the engine
// and is entangled with combat; these are three tiny throwaway shapes that
// exist only to sell the scripted beats.
// ---------------------------------------------------------------------------
type MenuFx =
  | { kind: 'puff'; x: number; y: number; vx: number; vy: number; r: number; age: number; life: number; color: string }
  | { kind: 'ring'; x: number; y: number; r: number; age: number; life: number; color: string }
  | { kind: 'shot'; x: number; y: number; vx: number; stopX: number; age: number; life: number; color: string }
  | { kind: 'bite'; x: number; y: number; vx: number; stopX: number; age: number; life: number }
  | { kind: 'word'; x: number; y: number; text: string; age: number; life: number; color: string };

interface Beat {
  /** Progress through the scene, 0..1, at which this beat fires. */
  at: number;
  run: (s: SceneRuntime) => void;
}

interface SceneRuntime {
  w: number;
  h: number;
  groundY: number;
  player: Fighter;
  enemy: Fighter;
  playerX: number;
  /** Where the challenger stands when it is in range. */
  nearX: number;
  /** Off-screen right, where challengers come from and run back to. */
  farX: number;
  fx: MenuFx[];
  say: (text: string, x: number, y: number, color?: string) => void;
  /** Fire something exactly once per scene. Beats fire at a fixed point in
   * the scene; this is for moments that have to key off an animation's own
   * clock instead, because the animation decides when they happen. */
  once: (key: string, fn: () => void) => void;
  /** Scratch shared between frame() and the beats, cleared per scene. */
  mem: Record<string, number>;
}

interface MenuScene {
  id: string;
  arena: keyof typeof ARENAS;
  durationMs: number;
  /** Dress the stage: challenger look, the hero's weapon, starting poses. */
  setup: (s: SceneRuntime) => void;
  /** Continuous per-frame motion (positions, facings). */
  frame: (s: SceneRuntime, p: number) => void;
  /** One-shot moments, fired in order as the scene's progress crosses them. */
  beats: Beat[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// A scripted move only reads as running if the ground speed is in the range
// the gait is drawn for. The menu world is barely wider than the screen while
// the scenes are ten seconds long, so it is very easy to write a move that
// carries a fighter 70px over a second and a half — which is a glide, not a
// run, however correctly the legs cycle. Every walk and run below therefore
// states the ground it covers and lets this work out how long that should
// take, at whatever width the phone happens to be, instead of hard-coding a
// window that only holds on one screen.
const SCRIPT_RUN_SPEED = 190; // px/s, a little under the game's base 210
function runWindow(distance: number, durationMs: number): number {
  return ((Math.abs(distance) / SCRIPT_RUN_SPEED) * 1000) / durationMs;
}

/** Positions a fighter along one scripted run and keeps its 'run' state in
 * step with the motion. Anything else about its animation (the idle it
 * settles into, the hit it takes) stays with the scene's beats. */
/** A shove is fast at the moment of impact and then dies away. A constant-rate
 * lerp over the same window creeps instead, which looks like the fighter is
 * being dragged rather than hit. */
const easeOutShove = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function runLeg(
  f: Fighter, p: number, from: number, to: number, start: number, end: number,
): void {
  if (p <= start) { f.body.pos.x = from; return; }
  if (p >= end) { f.body.pos.x = to; return; }
  f.body.pos.x = lerp(from, to, (p - start) / (end - start));
  f.facing = to >= from ? 1 : -1;
  f.setAnim('run');
}

/** Signature move of the selected hero, so the menu shows off *your*
 * character rather than always Windelmann's. Mirrors the mapping in
 * GameEngine.useCharacterAbility. */
interface SignatureDef {
  anim: AnimState;
  word: string;
  color: string;
  shape: 'cloud' | 'ring' | 'dust' | 'bite';
  /** When the payload actually leaves the body, in ms into the animation.
   * Taken from the pose itself in renderFighter — the middle of the fart's
   * release window, the frame the dentures are spat, the strum, the slam.
   * The effect used to be pinned to a fixed point in the scene instead,
   * which for Windelmann put the cloud on screen a good half second after
   * he had finished and straightened back up. */
  releaseMs: number;
  /** Length of the whole pose, so he stands up when it is over. */
  totalMs: number;
}

const SIGNATURE: Record<CharacterId, SignatureDef> = {
  windelmann: { anim: 'fart', word: 'PFFFRT!', color: '#9ccc65', shape: 'cloud', releaseMs: 620, totalMs: 1250 },
  grandpa: { anim: 'dentures', word: 'KLACK!', color: '#eceff1', shape: 'bite', releaseMs: 560, totalMs: 1000 },
  punk: { anim: 'rockPose', word: 'WRÄÄH!', color: '#ce93d8', shape: 'ring', releaseMs: 620, totalMs: 1350 },
  brawler: { anim: 'stomp', word: 'RUMMS!', color: '#ffb74d', shape: 'dust', releaseMs: 540, totalMs: 1400 },
};

/** Everything the signature move throws out, spawned at the moment the body
 * actually releases it. */
function fireSignature(s: SceneRuntime, sig: SignatureDef): void {
  s.say(sig.word, s.playerX + 120, s.groundY - 150, sig.color);
  const ox = s.playerX + 40;
  const oy = s.groundY - 70;
  if (sig.shape === 'bite') {
    s.fx.push({
      kind: 'bite', x: s.playerX + 46, y: s.groundY - 112,
      vx: 260, stopX: s.enemy.body.pos.x - 24, age: 0, life: 1600,
    });
  } else if (sig.shape === 'ring') {
    for (let i = 0; i < 3; i++) {
      s.fx.push({ kind: 'ring', x: ox, y: oy, r: 14 + i * 10, age: -i * 90, life: 720, color: sig.color });
    }
  } else if (sig.shape === 'cloud') {
    for (let i = 0; i < 16; i++) {
      s.fx.push({
        kind: 'puff', x: ox, y: oy + (Math.random() - 0.5) * 34,
        vx: 70 + Math.random() * 150, vy: -30 + Math.random() * 60,
        r: 10 + Math.random() * 16, age: -i * 18, life: 1100, color: 'rgba(156,204,101,0.55)',
      });
    }
  } else {
    for (let i = 0; i < 14; i++) {
      s.fx.push({
        kind: 'puff', x: ox + Math.random() * 180, y: s.groundY - 10,
        vx: 30 + Math.random() * 150, vy: -140 - Math.random() * 90,
        r: 5 + Math.random() * 10, age: -i * 14, life: 820, color: 'rgba(210,180,140,0.65)',
      });
    }
  }
}

function dressEnemy(
  enemy: Fighter,
  look: { color: string; accessories: string[]; scale: number },
): void {
  enemy.color = look.color;
  enemy.accessories = look.accessories;
  enemy.scale = look.scale;
}

const SCENES: MenuScene[] = [
  // 1. The one that was always there, tightened up: a challenger sprints in
  //    and is kicked straight back out again.
  {
    id: 'sprint',
    arena: 'meadow',
    durationMs: 9000,
    setup: (s) => {
      dressEnemy(s.enemy, { color: '#37474f', accessories: ['boxingGloves'], scale: 1.3 });
      s.player.weaponId = 'fists';
      s.enemy.body.pos.x = s.farX;
      s.enemy.setAnim('idle', true);
      s.player.setAnim('idle', true);
    },
    frame: (s, p) => {
      const D = 9000;
      // The approach is timed to *end* on its beat, so it always finishes
      // before the kick however wide the screen is; only its start moves.
      const inEnd = 0.44;
      const inStart = inEnd - runWindow(s.farX - s.nearX, D);
      const outStart = 0.62;
      const outEnd = outStart + runWindow(s.farX - (s.nearX + s.w * 0.1), D);
      if (p < 0.52) {
        runLeg(s.enemy, p, s.farX, s.nearX, inStart, inEnd);
      } else if (p < outStart) {
        // Knocked back, not running: a slide is the whole point here.
        s.enemy.body.pos.x = lerp(s.nearX, s.nearX + s.w * 0.1, easeOutShove((p - 0.52) / (outStart - 0.52)));
      } else {
        runLeg(s.enemy, p, s.nearX + s.w * 0.1, s.farX, outStart, outEnd);
      }
      if (p <= inEnd) s.enemy.facing = -1;
    },
    beats: [
      { at: 0.44, run: (s) => s.enemy.setAnim('idle', true) },
      {
        at: 0.47,
        run: (s) => {
          s.player.setAnim('kick', true);
          s.say('WUMM!', (s.playerX + s.nearX) / 2, s.groundY - 130);
          for (let i = 0; i < 10; i++) {
            s.fx.push({
              kind: 'puff', x: s.nearX - 26, y: s.groundY - 74,
              vx: 60 + Math.random() * 190, vy: -80 + Math.random() * 120,
              r: 9 + Math.random() * 13, age: 0, life: 700, color: 'rgba(255,255,255,0.7)',
            });
          }
        },
      },
      { at: 0.52, run: (s) => s.enemy.setAnim('knockback', true) },
      { at: 0.58, run: (s) => s.player.setAnim('idle', true) },
      { at: 0.95, run: (s) => s.enemy.setAnim('idle', true) },
    ],
  },

  // 2. The hero's own signature move, whichever hero is selected.
  {
    id: 'signature',
    arena: 'forest',
    durationMs: 9600,
    setup: (s) => {
      dressEnemy(s.enemy, { color: '#4e342e', accessories: ['wizardHat'], scale: 1.28 });
      s.player.weaponId = 'fists';
      s.enemy.body.pos.x = s.farX;
      s.enemy.setAnim('idle', true);
      s.player.setAnim('idle', true);
    },
    frame: (s, p) => {
      // Further out than the melee scenes on purpose: all four signature
      // effects travel (a gas cone, a shockwave, a ground shake, a spat set
      // of dentures), and at punching distance there was nothing to watch
      // them cross.
      const D = 9600;
      const mark = s.nearX + s.w * 0.22;
      const shoved = s.nearX + s.w * 0.34;
      const inEnd = 0.34;
      const inStart = inEnd - runWindow(s.farX - mark, D);
      const outStart = 0.72;
      const outEnd = outStart + runWindow(s.farX - shoved, D);

      // The payload leaves the body when the *animation* says it does, never
      // at a fixed point in the scene. Each hero's signature has its own
      // wind-up, and pinning the effect to a progress number put Windelmann's
      // cloud on screen half a second after he had already straightened back
      // up. Standing up is driven the same way, off the pose's own length.
      const sig = SIGNATURE[s.player.characterId];
      if (s.player.anim === sig.anim) {
        if (s.player.animTimeMs >= sig.releaseMs) {
          s.once('release', () => {
            s.mem.releaseP = p;
            fireSignature(s, sig);
            s.enemy.setAnim('knockback', true);
          });
        }
        if (s.player.animTimeMs >= sig.totalMs) s.player.setAnim('idle', true);
      }

      const shoveStart = s.mem.releaseP ?? outStart;
      if (p < shoveStart) {
        runLeg(s.enemy, p, s.farX, mark, inStart, inEnd);
      } else if (p < outStart) {
        // Shoved backwards by the effect — a slide, not a walk.
        s.enemy.body.pos.x = lerp(mark, shoved, easeOutShove((p - shoveStart) / (outStart - shoveStart)));
      } else {
        runLeg(s.enemy, p, shoved, s.farX, outStart, outEnd);
      }
      if (p <= inEnd) s.enemy.facing = -1;
    },
    beats: [
      { at: 0.34, run: (s) => s.enemy.setAnim('idle', true) },
      {
        at: 0.46,
        run: (s) => {
          const sig = SIGNATURE[s.player.characterId];
          s.player.setAnim(sig.anim, true);
        },
      },
      { at: 0.68, run: (s) => s.enemy.setAnim('dazed', true) },
      { at: 0.97, run: (s) => s.enemy.setAnim('idle', true) },
    ],
  },

  // 3. The counter: the challenger swings, the hero rolls out from under it
  //    and comes straight back with a punch.
  {
    id: 'counter',
    arena: 'volcano',
    durationMs: 10200,
    setup: (s) => {
      dressEnemy(s.enemy, { color: '#263238', accessories: ['ninjaMask'], scale: 1.32 });
      s.player.weaponId = 'sword';
      s.enemy.body.pos.x = s.farX;
      s.enemy.setAnim('idle', true);
      s.player.setAnim('idle', true);
    },
    frame: (s, p) => {
      const D = 10200;
      // Hero: stands, rolls back, holds, then lunges back in. The roll window
      // is pinned to the 'dodge' pose's own 520ms — stretch it and the fighter
      // keeps sliding backwards after the somersault has finished, which reads
      // as moonwalking rather than a roll. The lunge is the move that made the
      // hero appear to glide: it used to take a second and a half to cross
      // seventy pixels, so the legs barely completed a single step while the
      // body drifted from left to right. It is now a short dash timed to land
      // exactly on the counter.
      const rollEnd = 0.4 + 520 / D;
      const backX = s.playerX - s.w * 0.13;
      const counterX = s.playerX + s.w * 0.05;
      const lungeEnd = 0.68;
      const lungeStart = lungeEnd - runWindow(counterX - backX, D);
      if (p < 0.4) s.player.body.pos.x = s.playerX;
      else if (p < rollEnd) s.player.body.pos.x = lerp(s.playerX, backX, (p - 0.4) / (rollEnd - 0.4));
      else runLeg(s.player, p, backX, counterX, lungeStart, lungeEnd);

      const mark = s.nearX - s.w * 0.03;
      const shoved = s.nearX + s.w * 0.08;
      const inEnd = 0.36;
      const inStart = inEnd - runWindow(s.farX - mark, D);
      const outStart = 0.78;
      const outEnd = outStart + runWindow(s.farX - shoved, D);
      if (p < 0.7) {
        runLeg(s.enemy, p, s.farX, mark, inStart, inEnd);
      } else if (p < outStart) {
        s.enemy.body.pos.x = lerp(mark, shoved, easeOutShove((p - 0.7) / (outStart - 0.7)));
      } else {
        runLeg(s.enemy, p, shoved, s.farX, outStart, outEnd);
      }
      if (p <= inEnd) s.enemy.facing = -1;
    },
    beats: [
      { at: 0.36, run: (s) => s.enemy.setAnim('idle', true) },
      { at: 0.4, run: (s) => { s.enemy.setAnim('attack', true); s.player.setAnim('dodge', true); } },
      {
        at: 0.47,
        run: (s) => {
          s.say('ZISCH!', s.nearX - 40, s.groundY - 160, '#ffe082');
          for (let i = 0; i < 8; i++) {
            s.fx.push({
              kind: 'puff', x: s.player.body.pos.x, y: s.groundY - 14,
              vx: -20 - Math.random() * 90, vy: -20 - Math.random() * 40,
              r: 4 + Math.random() * 8, age: 0, life: 480, color: 'rgba(255,240,220,0.45)',
            });
          }
        },
      },
      { at: 0.451, run: (s) => s.player.setAnim('idle', true) },
      {
        at: 0.68,
        run: (s) => {
          s.player.setAnim('attack', true);
          s.say('TOCK!', (s.player.body.pos.x + s.enemy.body.pos.x) / 2, s.groundY - 140);
        },
      },
      { at: 0.7, run: (s) => s.enemy.setAnim('knockback', true) },
      { at: 0.76, run: (s) => s.player.setAnim('idle', true) },
      { at: 0.97, run: (s) => s.enemy.setAnim('idle', true) },
    ],
  },

  // 4. Ranged: the hero draws the bow and drops the challenger from across
  //    the arena, which is also the only scene where nobody closes in.
  {
    id: 'archer',
    arena: 'ice',
    durationMs: 8600,
    setup: (s) => {
      dressEnemy(s.enemy, { color: '#455a64', accessories: ['shield'], scale: 1.3 });
      s.player.weaponId = 'bow';
      s.enemy.body.pos.x = s.farX;
      s.enemy.setAnim('idle', true);
      s.player.setAnim('idle', true);
    },
    frame: (s, p) => {
      // The challenger is barely ever still here: it jogs in behind its
      // shield, is stopped on its mark by the arrow, and walks straight back
      // out. An earlier cut had it standing there for four seconds before
      // the shot, which looked like the scene had frozen.
      const D = 8600;
      const postX = s.nearX + s.w * 0.2;
      const reeled = postX + s.w * 0.07;
      // The walk-in has to be finished before the string is let go, since
      // the arrow is aimed at wherever the challenger is standing.
      const inEnd = 0.40;
      const inStart = inEnd - runWindow(s.farX - postX, D);
      const outStart = 0.60;
      const outEnd = outStart + runWindow(s.farX - reeled, D);

      // The arrow leaves when the string does. BOW_LOOSE_MS is the moment
      // the bow's own draw animation snaps back (see drawWeaponInHand); the
      // shot used to be pinned to a progress number a whole second later,
      // so the bow had long since come down before anything flew.
      if (s.player.anim === 'attack' && s.player.animTimeMs >= BOW_LOOSE_MS) {
        s.once('loose', () => {
          s.fx.push({
            kind: 'shot', x: s.playerX + 50, y: s.groundY - 96,
            vx: 560, stopX: s.enemy.body.pos.x - 26, age: 0, life: 1400, color: '#f1c40f',
          });
          s.mem.looseP = p;
        });
      }
      // ...and it lands when the arrow actually gets there, rather than at
      // another guessed offset: the shot removes itself at stopX.
      if (s.mem.looseP !== undefined && !s.fx.some((f) => f.kind === 'shot')) {
        s.once('impact', () => {
          s.mem.impactP = p;
          s.enemy.setAnim('hit', true);
          s.say('ZACK!', s.enemy.body.pos.x - 30, s.groundY - 150, '#ffe082');
          for (let i = 0; i < 8; i++) {
            s.fx.push({
              kind: 'puff', x: s.enemy.body.pos.x - 26, y: s.groundY - 96,
              vx: 50 + Math.random() * 150, vy: -60 + Math.random() * 110,
              r: 8 + Math.random() * 11, age: 0, life: 640, color: 'rgba(255,255,255,0.65)',
            });
          }
        });
      }
      const reelStart = s.mem.impactP ?? outStart;
      if (p < reelStart) {
        runLeg(s.enemy, p, s.farX, postX, inStart, inEnd);
      } else if (p < outStart) {
        // Reeling from the arrow, not walking.
        s.enemy.body.pos.x = lerp(postX, reeled, easeOutShove((p - reelStart) / (outStart - reelStart)));
      } else {
        runLeg(s.enemy, p, reeled, s.farX, outStart, outEnd);
      }
      if (p <= inEnd) s.enemy.facing = -1;
    },
    beats: [
      { at: 0.40, run: (s) => s.enemy.setAnim('idle', true) },
      { at: 0.42, run: (s) => s.player.setAnim('attack', true) },
      { at: 0.49, run: (s) => s.player.setAnim('idle', true) },
      { at: 0.56, run: (s) => s.enemy.setAnim('stagger', true) },
      { at: 0.95, run: (s) => s.enemy.setAnim('idle', true) },
    ],
  },
];

// Beats fire by walking the list in order as the scene's progress crosses each
// timestamp, so one entry written out of sequence holds up every entry behind
// it. That is not a hypothetical: the archer's ZACK! sat behind a later beat
// and fired three hundred milliseconds after the arrow landed, which left the
// challenger sliding backwards in its standing pose. Sorting here means the
// order a scene is *written* in never has to be the order it plays in.
for (const scene of SCENES) scene.beats.sort((a, b) => a.at - b.at);

/** Fisher-Yates, then a rotation so the first scene of a visit is not always
 * the same one either. */
function shuffledOrder(n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const FADE_MS = 340;

export function MenuArenaBackground({ characterId, capeColorId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth || 360;
      h = canvas.clientHeight || 640;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const def = CHARACTERS[characterId];
    const player = new Fighter('menu_player', 'player', def.name, { ...BALANCE.player.baseStats }, 0, 0);
    player.characterId = characterId;
    player.color = def.bodyColor;
    player.capeColorId = capeColorId;
    player.accessories = characterId === 'windelmann' ? ['diaper', 'cape'] : ['cape'];
    player.scale = 1.4;
    player.facing = 1;
    player.setAnim('idle', true);

    const enemy = new Fighter('menu_enemy', 'enemy', 'Herausforderer', { ...BALANCE.player.baseStats, maxHealth: 60 }, 0, 0);
    enemy.facing = -1;
    enemy.setAnim('idle', true);

    const order = shuffledOrder(SCENES.length);
    let orderIdx = 0;
    let scene = SCENES[order[0]];
    // The weather is rolled per scene now, not per visit: four scenes in a
    // row under the same flat sunshine looked like one long take, which is
    // exactly the "Dauerschleife" this pass is meant to break.
    let weather: WeatherState = pickRandomWeather();
    let sceneStart = performance.now();
    let nextBeat = 0;
    let fx: MenuFx[] = [];
    let needsSetup = true;
    // Camera. The scene world is a little wider than the screen so there is
    // somewhere to pan to; it eases toward whatever the action's midpoint is.
    let cameraX = 0;
    let cameraReady = false;
    const prevX = new WeakMap<Fighter, number>();

    const say = (text: string, x: number, y: number, color = '#ffffff') => {
      fx.push({ kind: 'word', x, y, text, age: 0, life: 1000, color });
    };
    // Scene-local scratch for the moments a scene has to time off an
    // animation's own clock rather than off its progress. Both are cleared
    // whenever a scene starts, alongside the effects.
    let fired = new Set<string>();
    let mem: Record<string, number> = {};
    const once = (key: string, fn: () => void) => {
      if (fired.has(key)) return;
      fired.add(key);
      fn();
    };

    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      resize();

      const groundY = h * 0.47;
      const worldW = w * 1.3;
      const playerX = w * 0.3;
      // Close enough that a kick or a punch actually reaches: at the old
      // 0.62 the two stood about 125px apart and every strike swung
      // through open air with the challenger flinching at nothing.
      const nearX = w * 0.53;
      const farX = worldW + w * 0.2;

      const runtime: SceneRuntime = { w, h, groundY, player, enemy, playerX, nearX, farX, fx, say, once, mem };

      if (needsSetup) {
        player.body.pos.x = playerX;
        player.facing = 1;
        scene.setup(runtime);
        // A new scene teleports the cast into place; without dropping the
        // previous frame's position the derived velocity below would be a
        // few thousand px/s and every cape would snap flat for one frame.
        prevX.delete(player);
        prevX.delete(enemy);
        needsSetup = false;
      }

      const elapsed = now - sceneStart;
      const p = Math.min(1, elapsed / scene.durationMs);

      // Fire every beat we have crossed, in order — so a dropped frame (a
      // backgrounded tab, a slow paint) never silently skips the punch and
      // leaves the challenger walking away from nothing.
      while (nextBeat < scene.beats.length && p >= scene.beats[nextBeat].at) {
        scene.beats[nextBeat].run(runtime);
        nextBeat++;
      }
      scene.frame(runtime, p);

      // The hero's x is the scene's business in 'counter' and nobody else's,
      // so only pin it when the scene has not moved it itself.
      if (scene.id !== 'counter') player.body.pos.x = playerX;

      for (const f of [player, enemy]) {
        f.body.pos.y = groundY;
        f.body.groundY = groundY;
        f.body.grounded = true;
        // The cape, the hair and the run lean all read body.vel.x, and a
        // scripted scene sets positions rather than velocities — without
        // this the cape hung dead straight through a full sprint. Derive
        // the velocity from how far the scene actually moved them.
        const prev = prevX.get(f);
        f.body.vel.x = prev === undefined || dt <= 0 ? 0 : (f.body.pos.x - prev) / (dt / 1000);
        prevX.set(f, f.body.pos.x);
        f.updateTimers(dt);
      }

      // --- camera ---------------------------------------------------------
      // The hero is the anchor, and nothing else is. Framing on the midpoint
      // between the two fighters instead made the camera's target jump the
      // moment the challenger stepped on or off stage, and the ease that
      // followed dragged the whole world sideways under a hero who was
      // standing perfectly still. On screen that is a stickman gliding
      // backwards at the head of every scene and forwards again at its tail,
      // in an idle pose, without taking a step — measured at 284px of drift
      // across a single nine-second scene. Anchored to the hero the camera
      // moves only when he does, which in three of the four scenes means it
      // does not move at all.
      const target = Math.max(0, Math.min(worldW - w, player.body.pos.x - w * 0.28));
      if (!cameraReady) { cameraX = target; cameraReady = true; }
      cameraX += (target - cameraX) * Math.min(1, dt / 420);

      const layout: ArenaLayout = {
        width: worldW, height: h, groundY,
        minX: 0, maxX: worldW,
        viewWidth: w, cameraX,
      };

      ctx.clearRect(0, 0, w, h);
      renderArena(ctx, ARENAS[scene.arena], layout, now / 1000, weather);

      ctx.save();
      ctx.translate(-Math.round(cameraX), 0);
      const dtSec = dt / 1000;
      const cast = enemy.body.pos.x < player.body.pos.x ? [enemy, player] : [player, enemy];
      for (const f of cast) renderFighter(ctx, f, dtSec);
      drawFx(ctx, fx, dt, groundY);
      ctx.restore();

      // --- dissolve between scenes -----------------------------------------
      const remaining = scene.durationMs - elapsed;
      let veil = 0;
      if (elapsed < FADE_MS) veil = 1 - elapsed / FADE_MS;
      else if (remaining < FADE_MS) veil = 1 - Math.max(0, remaining) / FADE_MS;
      if (veil > 0.001) {
        ctx.fillStyle = `rgba(9,14,11,${(veil * 0.82).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }

      if (elapsed >= scene.durationMs) {
        orderIdx++;
        if (orderIdx >= order.length) {
          // Reshuffle, and keep the first scene of the new round different
          // from the one that just played.
          const last = order[order.length - 1];
          let reshuffled = shuffledOrder(SCENES.length);
          if (reshuffled[0] === last && reshuffled.length > 1) {
            [reshuffled[0], reshuffled[1]] = [reshuffled[1], reshuffled[0]];
          }
          order.splice(0, order.length, ...reshuffled);
          orderIdx = 0;
        }
        scene = SCENES[order[orderIdx]];
        weather = pickRandomWeather(weather.id);
        sceneStart = now;
        nextBeat = 0;
        fx = [];
        fired = new Set();
        mem = {};
        runtime.fx = fx;
        needsSetup = true;
        cameraReady = false;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [characterId, capeColorId]);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />;
}

function drawFx(ctx: CanvasRenderingContext2D, fx: MenuFx[], dt: number, groundY: number): void {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.age += dt;
    if (f.age >= f.life) { fx.splice(i, 1); continue; }
    if (f.age < 0) continue; // staggered spawn, not visible yet
    const k = f.age / f.life;
    const fade = 1 - k;
    ctx.save();
    switch (f.kind) {
      case 'puff': {
        f.x += f.vx * (dt / 1000);
        f.y += f.vy * (dt / 1000);
        f.vy += 190 * (dt / 1000);
        if (f.y > groundY - 4) { f.y = groundY - 4; f.vy *= -0.3; }
        ctx.globalAlpha = fade * 0.85;
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (0.6 + k * 1.5), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'ring': {
        ctx.globalAlpha = fade * 0.8;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 4 * fade + 1;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, f.r + k * 190, (f.r + k * 190) * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'shot': {
        f.x += f.vx * (dt / 1000);
        if (f.x >= f.stopX) { ctx.restore(); fx.splice(i, 1); continue; }
        // A thin shaft with a head and a streak behind it, i.e. the same
        // read as the arrow the real game fires.
        ctx.globalAlpha = Math.min(1, fade * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(f.x - 46, f.y);
        ctx.lineTo(f.x - 14, f.y);
        ctx.stroke();
        ctx.strokeStyle = '#6d4c2f';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(f.x - 22, f.y);
        ctx.lineTo(f.x + 8, f.y);
        ctx.stroke();
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.moveTo(f.x + 16, f.y);
        ctx.lineTo(f.x + 6, f.y - 3.4);
        ctx.lineTo(f.x + 6, f.y + 3.4);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'bite': {
        f.x += f.vx * (dt / 1000);
        if (f.x >= f.stopX) { ctx.restore(); fx.splice(i, 1); continue; }
        // Chattering end over end on its way across, the way the real one
        // does when Grandpa spits it out.
        drawDentures(ctx, f.x, f.y, f.age / 90, 0.85, 0.5 + 0.5 * Math.sin(f.age / 60));
        break;
      }
      case 'word': {
        // Comic impact word: pops up fast, hangs, drifts off.
        const pop = k < 0.18 ? k / 0.18 : 1;
        const rise = Math.min(1, k / 0.7);
        ctx.globalAlpha = k > 0.65 ? (1 - k) / 0.35 : 1;
        ctx.translate(f.x, f.y - rise * 34);
        ctx.scale(0.7 + pop * 0.45, 0.7 + pop * 0.45);
        ctx.rotate(-0.1);
        ctx.font = '900 30px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(12,18,14,0.85)';
        ctx.lineWidth = 7;
        ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, 0, 0);
        break;
      }
    }
    ctx.restore();
  }
}
