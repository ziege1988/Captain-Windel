import type { Fighter } from '../entities/Fighter';
import { drawWeaponInHand, drawSnowPile, drawToiletPaperWrap } from './renderFighter';

// Section (boss overhaul): bosses used to be rendered through the exact
// same thin stick-figure rig as every normal enemy, just bigger — nothing
// about the *shape* read as "this is a unique character," only the size
// and a few small accent doodles layered on top (see the old
// drawBossFlair in renderFighter.ts). This file is a dedicated renderer
// for kind==='boss' fighters only (players/normal enemies keep the
// original stick-figure look in renderFighter.ts): much thicker limbs and
// a real filled torso instead of thin lines, a bigger and fully
// custom-shaped head per boss, and a costume system (BOSS_COSTUMES below)
// that gives each boss its own silhouette, colors, props and gestures —
// a Clown, a Viking, a lava golem, an ice sorceress, a giant chicken, a
// knight, a ghost, a robot, an alien and a shadow ninja — while reusing
// the same ground-anchoring math and pose-smoothing approach already
// proven out for the stick-figure rig, so grounding/animation-fluidity
// fixes apply here too.

interface BossPose {
  bodyLean: number;
  hipY: number;
  headOffsetX: number;
  headOffsetY: number;
  armFrontX: number; armFrontY: number;
  armBackX: number; armBackY: number;
  legFrontX: number; legFrontY: number;
  legBackX: number; legBackY: number;
  flatten: number;
  capeKick: number;
  auraPulse: number; // 0..1 — charge-up glow intensity during a telegraphed special
}

const STAND: BossPose = {
  bodyLean: 0, hipY: 0, headOffsetX: 0, headOffsetY: 0,
  armFrontX: 11, armFrontY: 34, armBackX: -11, armBackY: 34,
  legFrontX: 13, legFrontY: 44, legBackX: -13, legBackY: 44,
  flatten: 0, capeKick: 0, auraPulse: 0,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blend(a: BossPose, b: BossPose, t: number): BossPose {
  const out: Record<string, number> = {};
  for (const key of Object.keys(a) as (keyof BossPose)[]) out[key] = lerp(a[key], b[key], t);
  return out as unknown as BossPose;
}

const displayPoseCache = new WeakMap<Fighter, BossPose>();
// Slightly slower than the player rig's smoothing — bosses read as heavier,
// weightier characters, so their motion should ease a touch more lazily.
const POSE_SMOOTHING_TAU = 0.05;

function smoothPose(f: Fighter, target: BossPose, dtSec: number): BossPose {
  const previous = displayPoseCache.get(f);
  if (!previous || dtSec <= 0 || dtSec > 0.5) {
    displayPoseCache.set(f, target);
    return target;
  }
  const amount = 1 - Math.exp(-dtSec / POSE_SMOOTHING_TAU);
  const out: Record<string, number> = {};
  for (const key of Object.keys(target) as (keyof BossPose)[]) out[key] = lerp(previous[key], target[key], amount);
  const smoothed = out as unknown as BossPose;
  displayPoseCache.set(f, smoothed);
  return smoothed;
}

function computeBossPose(f: Fighter): BossPose {
  const t = f.animTimeMs / 1000;
  switch (f.anim) {
    case 'idle': {
      const bob = Math.sin(t * 1.6) * 3;
      return { ...STAND, hipY: bob, headOffsetY: bob * 0.5 };
    }
    case 'run': {
      const s = Math.sin(t * 8);
      return {
        ...STAND, bodyLean: 0.14, hipY: Math.abs(s) * -4,
        armFrontX: 15 * s, armFrontY: 30, armBackX: -15 * s, armBackY: 30,
        legFrontX: 22 * s, legFrontY: 42, legBackX: -22 * s, legBackY: 42,
      };
    }
    case 'attack':
      return { ...STAND, bodyLean: 0.3, armFrontX: 40, armFrontY: 16, armBackX: -18, armBackY: 32 };
    case 'kick':
      return { ...STAND, bodyLean: -0.2, armFrontX: -12, armFrontY: 28, armBackX: -20, armBackY: 24, legFrontX: 40, legFrontY: 20, legBackX: -8, legBackY: 44 };
    case 'telegraph': {
      // Section (boss AI overhaul): a distinct, unmistakable "charging up"
      // pose — arms raised, slight crouch, pulsing aura (drawn behind the
      // body in renderBoss) — so a boss winding up a special reads utterly
      // differently from either a normal attack or getting hurt, giving
      // the player a real, readable window to react.
      const pulse = 0.5 + Math.sin(t * 11) * 0.5;
      return {
        ...STAND, bodyLean: -0.1, hipY: 5,
        armFrontX: -15, armFrontY: -8, armBackX: 15, armBackY: -8,
        auraPulse: pulse,
      };
    }
    case 'block':
      return { ...STAND, bodyLean: 0.05, armFrontX: 20, armFrontY: 2, armBackX: 16, armBackY: 6 };
    case 'dodge':
      return { ...STAND, bodyLean: -0.3, hipY: 8, armFrontX: -12, armBackX: -16, legFrontX: 4, legBackX: -16 };
    case 'hit':
      return { ...STAND, bodyLean: -0.22, armFrontX: -15, armFrontY: 20, armBackX: -19, armBackY: 16 };
    case 'knockback':
      return { ...STAND, bodyLean: -0.5, hipY: -4, armFrontX: -25, armFrontY: 12, armBackX: -27, armBackY: 8, legFrontX: 25, legFrontY: 30, legBackX: 20, legBackY: 32 };
    case 'stagger': {
      const s = Math.sin(t * 8);
      return { ...STAND, bodyLean: 0.14 * s, hipY: 3, armFrontX: 9 * s, armBackX: -9 * s };
    }
    case 'dazed': {
      // Humorous effects pass: a real banana-slip for bosses too — heavier
      // and shorter than the player-scale slip (a boss's bulk shouldn't
      // topple as dramatically), but still a clear stumble before it
      // settles into a woozy sway with circling birds (drawn separately).
      const slipEnd = 0.22;
      const settleStart = 0.42;
      if (t < slipEnd) {
        const p = t / slipEnd;
        return {
          ...STAND, bodyLean: -0.35 * p, hipY: 8 * p,
          legFrontX: 20 * p, legFrontY: 20 + 8 * p,
          legBackX: -16 * p, legBackY: 32 - 6 * p,
          armFrontX: -18 * p, armFrontY: -4 * p,
          armBackX: 20 * p, armBackY: -2 * p,
        };
      }
      const p = Math.min(1, (t - slipEnd) / (settleStart - slipEnd));
      const sway = Math.sin(t * 4.5) * 4 * (1 - p * 0.5);
      return blend(
        {
          ...STAND, bodyLean: -0.35, hipY: 8,
          legFrontX: 20, legFrontY: 28, legBackX: -16, legBackY: 26,
          armFrontX: -18, armFrontY: -4, armBackX: 20, armBackY: -2,
        },
        { ...STAND, bodyLean: 0.05 * sway, hipY: 4, headOffsetX: sway * 0.5 },
        p,
      );
    }
    case 'surprised': {
      // Humorous effects pass: the boss looks up/flinches at the stork or
      // diaper-bomb impact — arms fly up, head snaps back — same shape as
      // the player-scale startle, just proportioned for a bigger body.
      const p = Math.min(1, t / 0.25);
      const wobble = Math.sin(t * 6) * (1 - p) * 3;
      return {
        ...STAND, bodyLean: -0.18 * p, headOffsetY: -6 * p + wobble,
        armFrontX: -22 * p, armFrontY: -12 * p,
        armBackX: 22 * p, armBackY: -10 * p,
      };
    }
    case 'wrapped': {
      // Bound up in toilet paper: arms pinned to the body, legs together,
      // a constant struggle wobble. Same read as the stick-figure version,
      // proportioned for the bigger boss rig.
      const struggle = Math.sin(t * 12) * 3;
      return {
        ...STAND,
        bodyLean: Math.sin(t * 5) * 0.1,
        headOffsetX: struggle,
        headOffsetY: Math.abs(struggle) * 0.4,
        armFrontX: 4, armFrontY: 26,
        armBackX: -4, armBackY: 26,
        legFrontX: 4, legFrontY: 46,
        legBackX: -4, legBackY: 46,
        hipY: struggle * 0.5,
      };
    }
    case 'fallen':
      return { ...STAND, flatten: 1, bodyLean: 0, armFrontX: 22, armFrontY: 6, armBackX: -16, armBackY: -4 };
    case 'gettingUp':
      return blend({ ...STAND, flatten: 1 }, { ...STAND, bodyLean: 0.3, hipY: 12 }, Math.min(1, t / 0.7));
    case 'dead':
      return { ...STAND, flatten: 1 };
    case 'bossIntro':
      return { ...STAND, hipY: Math.sin(t * 2.4) * 5, armFrontY: -6, armBackY: -6, armFrontX: 18, armBackX: -18 };
    case 'bossDeath':
      return blend({ ...STAND }, { ...STAND, flatten: 1, bodyLean: 0.4 }, Math.min(1, t / 1.3));
    case 'taunt': {
      const variant = f.tauntVariant % 3;
      if (variant === 0) {
        return { ...STAND, bodyLean: 0.4, hipY: 4, headOffsetY: 4, armFrontX: -12, armFrontY: 26, armBackX: -16, armBackY: 26 };
      } else if (variant === 1) {
        return { ...STAND, bodyLean: 0.1, armFrontX: 36, armFrontY: 2, armBackX: -12, armBackY: 30 };
      }
      const laugh = Math.sin(t * 14) * 4;
      return { ...STAND, bodyLean: -0.14, headOffsetX: 3, headOffsetY: laugh, armFrontX: -8, armFrontY: -12, armBackX: -18, armBackY: -8 };
    }
    default:
      return STAND;
  }
}

const FOOT_SAFETY_EMBED = 2;
const GROUND_EMBED_FLATTEN = 4;
// Vertical nudge for the flattened (fallen/dead) rig. Applied on local-x,
// which the +90deg rotation maps to screen-down, so a negative value lifts
// the lying body: the spine ends up a few px above the ground line while
// the head circle overlaps it, i.e. the figure lies *in* the ground rather
// than hovering over it.
const FLATTEN_GROUND_LIFT = -8;

/** Ground offset for the rig, blended across the flatten range so a fighter
 * toppling over or getting back up never jumps vertically mid-animation.
 * Upright, the offset comes from the pose's actual lowest foot; flat on the
 * ground the leg numbers no longer mean anything vertical, so a small fixed
 * embed takes over. */
function flattenGroundEmbed(f: Fighter, pose: BossPose): number {
  const upright = -lowestFootLocalY(f, pose) + FOOT_SAFETY_EMBED;
  const flat = GROUND_EMBED_FLATTEN;
  const k = Math.max(0, Math.min(1, pose.flatten));
  return upright * (1 - k) + flat * k;
}

function lowestFootLocalY(f: Fighter, pose: BossPose): number {
  return -f.height * 0.45 + pose.hipY + Math.max(pose.legFrontY, pose.legBackY, 0);
}

// ---------------------------------------------------------------------
// Section (character-quality overhaul): the same filled tapered-limb /
// hand / shoe primitives added to renderFighter.ts, duplicated here per
// this file's own no-shared-code convention (see the top-of-file note).
// Every boss's own costume (silhouette/colors/head/props) stays exactly
// as designed — this only upgrades the generic limb/torso rig underneath
// from thin strokes to a real jointed, filled body.
// ---------------------------------------------------------------------

function bentJoint(x1: number, y1: number, x2: number, y2: number, bendFrac: number, sign: 1 | -1): { x: number; y: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * sign;
  const ny = (dx / len) * sign;
  const bend = bendFrac * len;
  return { x: mx + nx * bend, y: my + ny * bend };
}

function drawTaperedSegment(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w1: number, w2: number, color: string): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 + (nx * w1) / 2, y1 + (ny * w1) / 2);
  ctx.lineTo(x2 + (nx * w2) / 2, y2 + (ny * w2) / 2);
  ctx.lineTo(x2 - (nx * w2) / 2, y2 - (ny * w2) / 2);
  ctx.lineTo(x1 - (nx * w1) / 2, y1 - (ny * w1) / 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x1, y1, w1 / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x2, y2, w2 / 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawLimb(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number,
  wNear: number, wFar: number, bendFrac: number, sign: 1 | -1, color: string,
): { dirX: number; dirY: number } {
  if (wNear <= 0 && wFar <= 0) return { dirX: x2 - x1, dirY: y2 - y1 };
  const j = bentJoint(x1, y1, x2, y2, bendFrac, sign);
  const wMid = (wNear + wFar) / 2;
  drawTaperedSegment(ctx, x1, y1, j.x, j.y, wNear, wMid, color);
  drawTaperedSegment(ctx, j.x, j.y, x2, y2, wMid, wFar, color);
  return { dirX: x2 - j.x, dirY: y2 - j.y };
}

const HAND_COLOR = '#f7ede1';

function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number, dirX: number, dirY: number, size: number, color: string): void {
  const angle = Math.atan2(dirY, dirX);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(size * 0.15, 0, size * 1.05, size * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, -size * 0.55);
  ctx.lineTo(size * 1.15, -size * 0.42);
  ctx.moveTo(size * 0.6, size * 0.02);
  ctx.lineTo(size * 1.25, size * 0.05);
  ctx.moveTo(size * 0.5, size * 0.55);
  ctx.lineTo(size * 1.1, size * 0.48);
  ctx.stroke();
  ctx.restore();
}

type BossShoeStyle = 'clown' | 'boot' | 'armored' | 'metal' | 'claw' | 'none';

function drawBossShoe(ctx: CanvasRenderingContext2D, x: number, y: number, tiltAngle: number, style: BossShoeStyle, color: string): void {
  if (style === 'none') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tiltAngle);
  ctx.lineJoin = 'round';
  switch (style) {
    case 'clown':
      ctx.fillStyle = '#fdd835';
      ctx.strokeStyle = '#c9a800';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-11, -6);
      ctx.lineTo(5, -7);
      ctx.quadraticCurveTo(24, -5, 25, 4);
      ctx.quadraticCurveTo(24, 10, 7, 9);
      ctx.lineTo(-11, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'boot':
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-7, -11);
      ctx.lineTo(4, -11);
      ctx.lineTo(5, 2.5);
      ctx.quadraticCurveTo(16, 1, 17, 6);
      ctx.quadraticCurveTo(16, 9.5, 2, 9);
      ctx.lineTo(-7, 7.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'armored':
      ctx.fillStyle = color;
      ctx.strokeStyle = '#263238';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-7, -9);
      ctx.lineTo(4, -9);
      ctx.lineTo(5, 1);
      ctx.lineTo(18, 3.5);
      ctx.lineTo(16, 8.5);
      ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-3, -2);
      ctx.lineTo(8, -1);
      ctx.stroke();
      break;
    case 'metal':
      ctx.fillStyle = color;
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(-9, -8, 26, 14, 4);
      ctx.fill();
      ctx.stroke();
      break;
    case 'claw':
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-8, 8);
      ctx.moveTo(0, 0); ctx.lineTo(0, 10);
      ctx.moveTo(0, 0); ctx.lineTo(9, 8);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function footTiltAngle(dx: number, dy: number): number {
  return Math.atan2(dx, Math.abs(dy) + 0.001) * 0.5;
}

interface Metrics {
  hipY: number;
  shoulderY: number;
  shoulderX: number;
  headX: number;
  headY: number;
  headR: number;
  pose: BossPose;
  blinkClosed: boolean;
}

interface BossCostume {
  torsoColor: string;
  limbColor: string;
  torsoWidth: number;
  armWidth: number;
  legWidth: number;
  headColor: string;
  headScale: number;
  auraColor: string;
  skipDefaultHead?: boolean;
  // Section (character-quality overhaul): per-costume hand/shoe styling —
  // most bosses get the same friendly cartoon-glove hand as the player/
  // normal enemies (a unifying device), but a few override it (a robot's
  // metal hand, a ninja's dark glove, a wraith's translucent one) or skip
  // hands entirely (the wraith has no real arms below the sleeves).
  handColor?: string;
  noHands?: boolean;
  shoeStyle?: BossShoeStyle;
  shoeColor?: string;
  drawBack?: (ctx: CanvasRenderingContext2D, f: Fighter, m: Metrics, t: number) => void;
  drawTorsoDetail?: (ctx: CanvasRenderingContext2D, f: Fighter, m: Metrics, t: number) => void;
  drawHead: (ctx: CanvasRenderingContext2D, f: Fighter, hx: number, hy: number, r: number, t: number, m: Metrics) => void;
  drawExtras?: (ctx: CanvasRenderingContext2D, f: Fighter, m: Metrics, t: number) => void;
  // Character-quality overhaul pass 2: an escape hatch for a boss whose
  // whole body plan isn't humanoid (the chicken has no human torso/arms at
  // all) — when set, this entirely replaces the generic legs/torso/arms
  // drawing below with a custom silhouette, while still reading the exact
  // same pose numbers (legFrontX/Y drive its stride, armFrontY/armBackY
  // drive wing flaps, hipY drives body bob) so every existing animation
  // (idle/run/attack/hit/telegraph/death) keeps working with zero changes
  // to computeBossPose or GameEngine. Head/weapon/extras/status overlay
  // still draw normally on top.
  customBody?: (ctx: CanvasRenderingContext2D, f: Fighter, m: Metrics, t: number) => void;
}

function drawChargeAura(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, pulse: number, span: number): void {
  ctx.save();
  const r = span * 0.55 + pulse * 10;
  ctx.globalAlpha = 0.25 + pulse * 0.35;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.5 + pulse * 0.4;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Section (character-quality overhaul): boss blink timer — same idea as
// the player/normal-enemy face system, kept deliberately lighter (bosses'
// heads are custom-shaped per costume, so this only gates a closed-eye
// beat rather than driving a full brow/mouth expression system).
interface BossBlinkState { nextBlinkAt: number; blinkT: number; }
const bossBlinkCache = new WeakMap<Fighter, BossBlinkState>();

function updateBossBlink(f: Fighter, dtSec: number): boolean {
  let s = bossBlinkCache.get(f);
  if (!s) {
    s = { nextBlinkAt: 1.5 + Math.random() * 3.5, blinkT: 0 };
    bossBlinkCache.set(f, s);
  }
  if (dtSec > 0 && dtSec < 0.5) {
    if (s.blinkT > 0) {
      s.blinkT -= dtSec;
    } else {
      s.nextBlinkAt -= dtSec;
      if (s.nextBlinkAt <= 0) {
        s.blinkT = 0.13;
        s.nextBlinkAt = 2.5 + Math.random() * 4;
      }
    }
  }
  return s.blinkT > 0;
}

function glowEyes(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, color: string, closed = false, spacing = 0.42): void {
  if (closed) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const side of [-1, 1] as const) {
      const ex = hx + side * r * spacing * 0.4 + r * 0.25;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.16, hy - r * 0.05);
      ctx.lineTo(ex + r * 0.16, hy - r * 0.05);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 4;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.arc(hx + side * r * spacing * 0.4 + r * 0.25, hy - r * 0.05, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function simpleEyes(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, pupilColor = '#1a1a1a', closed = false): void {
  const backX = hx - r * 0.05;
  const frontX = hx + r * 0.5;
  const eyeY = hy - r * 0.08;
  if (closed) {
    ctx.save();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    for (const [ex, radius] of [[backX, r * 0.24], [frontX, r * 0.3]] as const) {
      ctx.beginPath();
      ctx.moveTo(ex - radius, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + radius * 0.5, ex + radius, eyeY);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  for (const [ex, radius, pupilR] of [[backX, r * 0.24, r * 0.11], [frontX, r * 0.3, r * 0.14]] as const) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(ex, eyeY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pupilColor;
    ctx.beginPath();
    ctx.arc(ex + radius * 0.35, eyeY, pupilR, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------
// Per-boss costumes
// ---------------------------------------------------------------------

const BOSS_COSTUMES: Record<string, BossCostume> = {
  clown: {
    torsoColor: '#e53935', limbColor: '#2b2140', torsoWidth: 24, armWidth: 13, legWidth: 15,
    headColor: '#f2d9c4', headScale: 1.15, auraColor: '#ff4081',
    shoeStyle: 'clown', handColor: '#ffffff',
    drawTorsoDetail(ctx, f, m) {
      // Ruffled colorful collar + big buttons down the front.
      const colors = ['#fdd835', '#1e88e5', '#e53935'];
      for (let i = -3; i <= 3; i++) {
        ctx.fillStyle = colors[(i + 9) % colors.length];
        ctx.beginPath();
        ctx.arc(m.shoulderX + i * 4.5, m.shoulderY + 5, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fdd835';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(m.shoulderX + 1, m.shoulderY + 16 + i * 11, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    drawHead(ctx, f, hx, hy, r, t, m) {
      // Big, bushy, colorful clown wig — two overlapping tones so it reads
      // as a real fright wig rather than a thin fringe of hair.
      ctx.fillStyle = '#ff6f00';
      for (const side of [-1, 1] as const) {
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(hx + side * (r * 0.7 + i * 3.4), hy - r * 0.2 + i * 3.2, r * 0.42, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = '#ffb300';
      for (const side of [-1, 1] as const) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(hx + side * (r * 0.55 + i * 4), hy - r * 0.65 - i * 1.5, r * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Pointed party hat.
      ctx.fillStyle = '#1e88e5';
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.7, hy - r * 0.5);
      ctx.lineTo(hx + r * 0.15, hy - r * 2.6);
      ctx.lineTo(hx + r * 0.9, hy - r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fdd835';
      ctx.beginPath();
      ctx.arc(hx + r * 0.15, hy - r * 2.6, 3, 0, Math.PI * 2);
      ctx.fill();
      // White face paint patches around the eyes.
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(hx + r * 0.35, hy - r * 0.05, r * 0.5, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      simpleEyes(ctx, hx, hy, r, '#1a1a1a', m.blinkClosed);
      // Big red nose.
      ctx.fillStyle = '#e53935';
      ctx.beginPath();
      ctx.arc(hx + r * 0.78, hy + r * 0.12, r * 0.3, 0, Math.PI * 2);
      ctx.fill();

      // Section (character-quality overhaul, point 12): the clown gets a
      // real, varying face instead of one permanent wide grin — angry
      // eyebrows while winding up an attack, a startled "o" the instant
      // it's hit, a worried look while dazed by a banana, back to the
      // laughing grin otherwise (idle/taunt/telegraph/superpower).
      if (!m.blinkClosed) {
        let browAngle = 0;
        let mouth: 'grin' | 'firm' | 'o' | 'worried' = 'grin';
        switch (f.anim) {
          case 'attack': case 'kick': browAngle = 0.4; mouth = 'firm'; break;
          case 'hit': case 'stagger': case 'knockback': case 'surprised': browAngle = -0.4; mouth = 'o'; break;
          case 'dazed': browAngle = -0.2; mouth = 'worried'; break;
          default: browAngle = 0.1; mouth = 'grin';
        }
        if (browAngle !== 0) {
          ctx.strokeStyle = '#6d1b13';
          ctx.lineWidth = 1.8;
          ctx.lineCap = 'round';
          for (const side of [-1, 1] as const) {
            const bx = hx + (side > 0 ? r * 0.55 : r * 0.05);
            const by = hy - r * 0.42;
            const tilt = browAngle * side * r * 0.14;
            ctx.beginPath();
            ctx.moveTo(bx - r * 0.18, by + tilt);
            ctx.lineTo(bx + r * 0.18, by - tilt);
            ctx.stroke();
          }
        }
        ctx.strokeStyle = '#c62828';
        ctx.lineWidth = 2;
        ctx.beginPath();
        switch (mouth) {
          case 'firm':
            ctx.moveTo(hx - r * 0.15, hy + r * 0.4);
            ctx.lineTo(hx + r * 0.55, hy + r * 0.34);
            ctx.stroke();
            break;
          case 'o':
            ctx.fillStyle = '#6d1b13';
            ctx.arc(hx + r * 0.25, hy + r * 0.4, r * 0.16, 0, Math.PI * 2);
            ctx.fill();
            break;
          case 'worried':
            ctx.arc(hx + r * 0.2, hy + r * 0.55, r * 0.35, 1.15 * Math.PI, 1.85 * Math.PI);
            ctx.stroke();
            break;
          default:
            ctx.arc(hx + r * 0.2, hy + r * 0.35, r * 0.5, 0.1 * Math.PI, 0.7 * Math.PI);
            ctx.stroke();
        }
      }
      void t;
    },
  },

  // ironTree data-id kept (avoids touching level/arena wiring) — reflavored
  // as a wild Viking berserker; see bosses.ts for the matching name/text.
  ironTree: {
    torsoColor: '#6d4c2f', limbColor: '#4a3520', torsoWidth: 26, armWidth: 15, legWidth: 17,
    headColor: '#d7a26a', headScale: 1.1, auraColor: '#8d6e63',
    shoeStyle: 'boot', shoeColor: '#3e2c18',
    drawTorsoDetail(ctx, f, m) {
      // Fur-trimmed vest with a jagged hem.
      ctx.fillStyle = '#efebe9';
      ctx.beginPath();
      ctx.moveTo(m.shoulderX - 12, m.shoulderY + 4);
      for (let i = 0; i <= 5; i++) {
        const px = m.shoulderX - 12 + i * 5;
        const py = m.shoulderY + 4 + (i % 2 === 0 ? 6 : 12);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(m.shoulderX + 13, m.shoulderY + 4);
      ctx.closePath();
      ctx.fill();
    },
    drawHead(ctx, f, hx, hy, r, t, m) {
      // Bushy braided beard.
      ctx.fillStyle = '#c9a876';
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.5, hy + r * 0.2);
      ctx.lineTo(hx + r * 0.1, hy + r * 1.3);
      ctx.lineTo(hx + r * 0.7, hy + r * 0.2);
      ctx.closePath();
      ctx.fill();
      simpleEyes(ctx, hx, hy - r * 0.15, r, '#1a1a1a', m.blinkClosed);
      void t;
      // Horned helmet.
      ctx.fillStyle = '#8d8d8d';
      ctx.beginPath();
      ctx.arc(hx, hy - r * 0.35, r * 0.85, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e0d8c8';
      ctx.lineWidth = 3;
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(hx + side * r * 0.7, hy - r * 0.55);
        ctx.quadraticCurveTo(hx + side * r * 1.5, hy - r * 1.1, hx + side * r * 1.1, hy - r * 1.5);
        ctx.stroke();
      }
    },
    drawExtras(ctx, f, m) {
      void f; void m;
    },
  },

  magmaBrute: {
    torsoColor: '#3a1210', limbColor: '#2b0d0c', torsoWidth: 30, armWidth: 18, legWidth: 20,
    headColor: '#3a1210', headScale: 1.05, auraColor: '#ff6d00',
    handColor: '#5d2b1f', shoeStyle: 'boot', shoeColor: '#2b0d0c',
    drawTorsoDetail(ctx, f, m, t) {
      // Glowing cracks pulsing along the rock body.
      const glow = 0.5 + Math.sin(t * 3) * 0.3;
      ctx.strokeStyle = `rgba(255,112,67,${glow})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(m.shoulderX - 6, m.shoulderY + 8);
      ctx.lineTo(m.shoulderX + 3, m.shoulderY + 20);
      ctx.lineTo(m.shoulderX - 3, m.shoulderY + 32);
      ctx.lineTo(m.shoulderX + 4, m.shoulderY + 42);
      ctx.stroke();
    },
    drawHead(ctx, f, hx, hy, r, t, m) {
      // No neck — a fused rock lump for a head, glowing eye pits, steam.
      ctx.fillStyle = '#2b0d0c';
      ctx.beginPath();
      ctx.moveTo(hx - r, hy + r * 0.3);
      ctx.lineTo(hx - r * 0.6, hy - r * 0.9);
      ctx.lineTo(hx + r * 0.5, hy - r);
      ctx.lineTo(hx + r, hy + r * 0.2);
      ctx.closePath();
      ctx.fill();
      glowEyes(ctx, hx, hy, r, '#ffab40', m.blinkClosed);
      const steam = (t * 20) % 20;
      ctx.globalAlpha = Math.max(0, 1 - steam / 20) * 0.4;
      ctx.fillStyle = '#bdbdbd';
      ctx.beginPath();
      ctx.arc(hx + r * 0.6, hy - r - steam, 3 + steam * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    drawExtras(ctx, f, m, t) {
      const glow = 0.5 + Math.sin(t * 4) * 0.3;
      ctx.fillStyle = `rgba(255,171,64,${glow})`;
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.arc(m.shoulderX + side * 10, m.shoulderY + 22, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },

  frostQueen: {
    torsoColor: '#4fc3f7', limbColor: '#0d47a1', torsoWidth: 22, armWidth: 12, legWidth: 13,
    headColor: '#dcefff', headScale: 1.1, auraColor: '#81d4fa',
    shoeStyle: 'boot', shoeColor: '#0d47a1',
    drawBack(ctx, f, m, t) {
      // Flowing icy cape.
      const sway = Math.sin(t * 2) * 6;
      ctx.fillStyle = 'rgba(179,229,252,0.55)';
      ctx.beginPath();
      ctx.moveTo(m.shoulderX - 6, m.shoulderY + 2);
      ctx.lineTo(m.shoulderX + 6, m.shoulderY + 2);
      ctx.quadraticCurveTo(m.shoulderX - 14 - sway, m.shoulderY + 36, m.shoulderX - 18 - sway * 1.4, m.shoulderY + 66);
      ctx.quadraticCurveTo(m.shoulderX - 2 - sway, m.shoulderY + 46, m.shoulderX - 6, m.shoulderY + 2);
      ctx.closePath();
      ctx.fill();
    },
    drawHead(ctx, f, hx, hy, r, t, m) {
      simpleEyes(ctx, hx, hy, r, '#0d47a1', m.blinkClosed);
      void t;
      // Ice-crystal crown.
      ctx.fillStyle = '#b3e5fc';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(hx + i * r * 0.5 - r * 0.15, hy - r * 0.75);
        ctx.lineTo(hx + i * r * 0.5, hy - r * (1.3 + Math.abs(i) * 0.2));
        ctx.lineTo(hx + i * r * 0.5 + r * 0.15, hy - r * 0.75);
        ctx.closePath();
        ctx.fill();
      }
    },
    drawExtras(ctx, f, m) {
      // Faint frost aura around the torso.
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#b3e5fc';
      ctx.beginPath();
      ctx.arc(m.shoulderX, (m.shoulderY + m.hipY) / 2, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  },

  chicken: {
    torsoColor: '#fafafa', limbColor: '#ff9800', torsoWidth: 30, armWidth: 8, legWidth: 10,
    headColor: '#fafafa', headScale: 1.0, auraColor: '#ffca28',
    noHands: true, shoeStyle: 'none',
    // Character-quality overhaul pass 2: "wenn ein Boss ein Huhn ist, soll
    // er auch wirklich wie ein Huhn aussehen" — a genuinely bird-shaped
    // body (a round feathered egg, no human torso silhouette at all) with
    // thin bird legs and flapping wing shapes, instead of the previous
    // human-proportioned torso/legs with feather decorations glued on.
    customBody(ctx, f, m, t) {
      const { hipY, shoulderY, shoulderX, pose } = m;
      const bodyCx = shoulderX * 0.4;
      const bodyCy = (hipY + shoulderY) / 2 + 6;
      const bodyW = 32;
      const bodyH = 25;

      // Thin bird legs — angled, ending where drawExtras' claws attach —
      // driven by the exact same stride/attack pose numbers as every other
      // boss, so walking/lunging/telegraphing all animate it correctly.
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 5.5;
      ctx.lineCap = 'round';
      for (const [lx, ly] of [[pose.legBackX, hipY + pose.legBackY], [pose.legFrontX, hipY + pose.legFrontY]] as const) {
        ctx.beginPath();
        ctx.moveTo(bodyCx, bodyCy + bodyH * 0.6);
        ctx.lineTo(lx * 0.7, bodyCy + bodyH * 0.6 + (ly - bodyCy) * 0.5);
        ctx.lineTo(lx, ly);
        ctx.stroke();
      }

      // Tail feathers, behind the body.
      ctx.fillStyle = '#eeeeee';
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bodyCx - bodyW * 0.6, bodyCy - 4);
      ctx.lineTo(bodyCx - bodyW * 1.5, bodyCy - 26);
      ctx.lineTo(bodyCx - bodyW * 0.9, bodyCy - 10);
      ctx.lineTo(bodyCx - bodyW * 1.3, bodyCy + 2);
      ctx.lineTo(bodyCx - bodyW * 0.6, bodyCy + 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // A short neck connecting the (separately-drawn) head down to the
      // round body, so there's no visible gap.
      ctx.strokeStyle = '#fafafa';
      ctx.lineWidth = bodyH * 0.55;
      ctx.beginPath();
      ctx.moveTo(m.shoulderX + m.headX, m.headY + m.headR * 0.5);
      ctx.lineTo(bodyCx, bodyCy - bodyH * 0.5);
      ctx.stroke();

      // The round, feathered body itself.
      ctx.fillStyle = '#fafafa';
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(bodyCx, bodyCy, bodyW, bodyH, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // A few feather-tuft strokes for texture.
      ctx.strokeStyle = '#e8e8e8';
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(bodyCx + i * 7, bodyCy - bodyH * 0.4);
        ctx.quadraticCurveTo(bodyCx + i * 7 + 2, bodyCy, bodyCx + i * 7, bodyCy + bodyH * 0.5);
        ctx.stroke();
      }

      // Wings — feather-fan shapes, flapping with the same arm-pose values
      // (armBackY/armFrontY) that drive a humanoid boss's arm swing, so
      // idle/run/attack/hit all still visibly animate the wings.
      const wingFlap = Math.sin(t * 6) * 4;
      for (const side of [-1, 1] as const) {
        const armY = side < 0 ? pose.armBackY : pose.armFrontY;
        const lift = (34 - armY) * 0.02; // raises the wing when the arm pose lifts (attack windup, hit reaction, ...)
        ctx.save();
        ctx.translate(bodyCx + side * bodyW * 0.85, bodyCy - 2);
        ctx.rotate(side * (0.35 + wingFlap * side * 0.01) - lift);
        ctx.fillStyle = '#f5f5f5';
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(0, 12, 10, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    },
    drawHead(ctx, f, hx, hy, r, t, m) {
      simpleEyes(ctx, hx, hy, r, '#1a1a1a', m.blinkClosed);
      void t;
      // Red comb.
      ctx.fillStyle = '#e53935';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(hx - r * 0.3 + i * r * 0.35, hy - r * 0.85, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      // Orange beak.
      ctx.fillStyle = '#ff9800';
      ctx.beginPath();
      ctx.moveTo(hx + r * 0.85, hy - r * 0.05);
      ctx.lineTo(hx + r * 1.5, hy + r * 0.1);
      ctx.lineTo(hx + r * 0.85, hy + r * 0.3);
      ctx.closePath();
      ctx.fill();
      // Red wattle.
      ctx.fillStyle = '#d32f2f';
      ctx.beginPath();
      ctx.moveTo(hx + r * 0.6, hy + r * 0.3);
      ctx.lineTo(hx + r * 0.7, hy + r * 0.75);
      ctx.lineTo(hx + r * 0.9, hy + r * 0.35);
      ctx.fill();
    },
    drawExtras(ctx, f, m) {
      // Clawed feet.
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 2;
      for (const [lx, ly] of [[m.pose.legFrontX, m.hipY + m.pose.legFrontY], [m.pose.legBackX, m.hipY + m.pose.legBackY]] as const) {
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + i * 6, ly + 8);
          ctx.stroke();
        }
      }
    },
  },

  stoneKnight: {
    torsoColor: '#78909c', limbColor: '#546e7a', torsoWidth: 27, armWidth: 15, legWidth: 17,
    headColor: '#90a4ae', headScale: 1.05, auraColor: '#b0bec5',
    handColor: '#78909c', shoeStyle: 'armored', shoeColor: '#78909c',
    drawTorsoDetail(ctx, f, m) {
      // Armor plate lines.
      ctx.strokeStyle = '#37474f';
      ctx.lineWidth = 1.4;
      for (let y = m.shoulderY + 6; y < m.hipY - 4; y += 8) {
        ctx.beginPath();
        ctx.moveTo(m.shoulderX - 10, y);
        ctx.lineTo(m.shoulderX + 10, y);
        ctx.stroke();
      }
    },
    drawHead(ctx, f, hx, hy, r) {
      // Full helmet with a T-shaped visor slit.
      ctx.fillStyle = '#607d8b';
      ctx.beginPath();
      ctx.arc(hx, hy, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#263238';
      ctx.fillRect(hx - r * 0.5, hy - r * 0.12, r, r * 0.24);
      ctx.fillRect(hx - r * 0.1, hy - r * 0.5, r * 0.2, r * 0.7);
      // Plume.
      ctx.fillStyle = '#c62828';
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.1, hy - r * 0.9);
      ctx.quadraticCurveTo(hx + r * 0.6, hy - r * 1.6, hx + r * 0.2, hy - r * 2.1);
      ctx.quadraticCurveTo(hx - r * 0.1, hy - r * 1.3, hx - r * 0.3, hy - r * 0.9);
      ctx.closePath();
      ctx.fill();
    },
    drawExtras(ctx, f, m) {
      // Shield on the back arm.
      ctx.save();
      ctx.fillStyle = '#607d8b';
      ctx.strokeStyle = '#37474f';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(m.shoulderX + m.pose.armBackX - 4, m.shoulderY + m.pose.armBackY, 8, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },
  },

  graveWraith: {
    torsoColor: 'rgba(69,90,100,0.75)', limbColor: 'rgba(69,90,100,0.7)', torsoWidth: 20, armWidth: 10, legWidth: 0,
    headColor: '#37474f', headScale: 1.1, auraColor: '#66bb6a', skipDefaultHead: false,
    handColor: 'rgba(197,225,165,0.55)',
    drawBack(ctx, f, m, t) {
      // Tattered hem instead of legs — the wraith floats.
      const sway = Math.sin(t * 1.6) * 5;
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#455a64';
      ctx.beginPath();
      ctx.moveTo(-16, m.hipY);
      ctx.lineTo(16, m.hipY);
      for (let i = 0; i <= 5; i++) {
        const px = 16 - i * 6.4 + sway * 0.3;
        const py = m.hipY + 10 + (i % 2 === 0 ? 14 : 4);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
    drawTorsoDetail(ctx) {
      void ctx;
    },
    drawHead(ctx, f, hx, hy, r, t, m) {
      glowEyes(ctx, hx, hy, r, '#a5d6a7', m.blinkClosed);
      void t;
      // Hood.
      ctx.fillStyle = 'rgba(55,71,79,0.85)';
      ctx.beginPath();
      ctx.arc(hx, hy - r * 0.1, r * 1.15, Math.PI * 0.95, Math.PI * 2.05);
      ctx.fill();
    },
    drawExtras(ctx, f, m, t) {
      // Wisps drifting off the body.
      ctx.save();
      ctx.fillStyle = 'rgba(165,214,167,0.35)';
      for (let i = 0; i < 3; i++) {
        const y = m.hipY - (t * 20 + i * 15) % 45;
        ctx.beginPath();
        ctx.arc(-4 + i * 4, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
  },

  // stormTitan data-id kept — reflavored as a storm-charged robot golem.
  stormTitan: {
    torsoColor: '#37474f', limbColor: '#455a64', torsoWidth: 30, armWidth: 16, legWidth: 18,
    headColor: '#607d8b', headScale: 1.0, auraColor: '#fff59d', skipDefaultHead: true,
    handColor: '#78909c', shoeStyle: 'metal', shoeColor: '#455a64',
    drawTorsoDetail(ctx, f, m) {
      // Rivets + a chest core light.
      ctx.fillStyle = '#263238';
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.arc(m.shoulderX + side * 9, m.shoulderY + 6, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff59d';
      ctx.beginPath();
      ctx.arc(m.shoulderX, m.shoulderY + 18, 4, 0, Math.PI * 2);
      ctx.fill();
    },
    drawHead(ctx, f, hx, hy, r, t) {
      // Boxy metal head instead of a circle.
      ctx.fillStyle = '#607d8b';
      ctx.beginPath();
      ctx.roundRect(hx - r * 0.95, hy - r * 0.85, r * 1.9, r * 1.7, r * 0.25);
      ctx.fill();
      // Glowing visor bar.
      const flicker = Math.sin(t * 8) > -0.7 ? 1 : 0.3;
      ctx.fillStyle = `rgba(255,245,157,${flicker})`;
      ctx.fillRect(hx - r * 0.65, hy - r * 0.15, r * 1.3, r * 0.28);
      // Antenna.
      ctx.strokeStyle = '#455a64';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx, hy - r * 0.85);
      ctx.lineTo(hx, hy - r * 1.5);
      ctx.stroke();
      ctx.fillStyle = flicker === 1 ? '#fff59d' : '#8d6e63';
      ctx.beginPath();
      ctx.arc(hx, hy - r * 1.5, 2.4, 0, Math.PI * 2);
      ctx.fill();
    },
    drawExtras(ctx, f, m, t) {
      if (Math.sin(t * 7) > 0.55) {
        ctx.strokeStyle = '#fff59d';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(m.shoulderX - 12, m.shoulderY + 18);
        ctx.lineTo(m.shoulderX - 6, m.shoulderY + 24);
        ctx.lineTo(m.shoulderX - 11, m.shoulderY + 30);
        ctx.stroke();
      }
    },
  },

  // chaosHydra data-id kept — reflavored as a chaotic alien.
  chaosHydra: {
    torsoColor: '#4a148c', limbColor: '#6a1b9a', torsoWidth: 16, armWidth: 9, legWidth: 10,
    headColor: '#ba68c8', headScale: 1.3, auraColor: '#ce93d8',
    handColor: '#ce93d8', shoeStyle: 'claw', shoeColor: '#6a1b9a',
    drawHead(ctx, f, hx, hy, r) {
      // Big bald head, huge black almond eyes, no nose/mouth.
      ctx.fillStyle = '#1a1a1a';
      for (const side of [-1, 1] as const) {
        ctx.beginPath();
        ctx.ellipse(hx + side * r * 0.32, hy, r * 0.28, r * 0.4, side * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
      // Small psychic third eye above.
      ctx.fillStyle = '#e1bee7';
      ctx.beginPath();
      ctx.arc(hx, hy - r * 0.85, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    },
    drawExtras(ctx, f, m, t) {
      // Pulsing psychic aura + a faint second-head silhouette (twin motif).
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(t * 3) * 0.15;
      ctx.strokeStyle = '#ce93d8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(m.shoulderX, (m.shoulderY + m.hipY) / 2, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ba68c8';
      ctx.beginPath();
      ctx.arc(m.shoulderX - 16, m.shoulderY - 6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  },

  // windelNemesis data-id kept — reflavored as a shadow ninja doppelganger.
  windelNemesis: {
    torsoColor: '#0d0d10', limbColor: '#0d0d10', torsoWidth: 20, armWidth: 11, legWidth: 12,
    headColor: '#161618', headScale: 1.0, auraColor: '#7c1fa2',
    // A touch lighter than the near-black torso so the gripping hand
    // still reads as its own shape against the shadow-ninja silhouette.
    handColor: '#3a3a42', shoeStyle: 'boot', shoeColor: '#0d0d10',
    drawBack(ctx, f, m, t) {
      const sway = Math.sin(t * 3) * 5;
      ctx.fillStyle = 'rgba(60,10,80,0.5)';
      ctx.beginPath();
      ctx.moveTo(m.shoulderX - 5, m.shoulderY + 2);
      ctx.lineTo(m.shoulderX + 5, m.shoulderY + 2);
      ctx.quadraticCurveTo(m.shoulderX - 12 - sway, m.shoulderY + 34, m.shoulderX - 16 - sway * 1.3, m.shoulderY + 60);
      ctx.quadraticCurveTo(m.shoulderX - 2 - sway, m.shoulderY + 42, m.shoulderX - 5, m.shoulderY + 2);
      ctx.closePath();
      ctx.fill();
    },
    drawHead(ctx, f, hx, hy, r, t, m) {
      // Mask covering the lower face, glowing red eyes in the slit.
      ctx.fillStyle = '#161618';
      ctx.fillRect(hx - r, hy - r * 0.15, r * 2, r * 0.9);
      glowEyes(ctx, hx, hy - r * 0.1, r, '#ff1744', m.blinkClosed);
      void t;
    },
    drawExtras(ctx, f, m, t) {
      ctx.save();
      ctx.globalAlpha = 0.3 + Math.sin(t * 4) * 0.15;
      ctx.strokeStyle = '#ab47bc';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(m.shoulderX, (m.shoulderY + m.hipY) / 2, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },
  },
};

const DEFAULT_COSTUME: BossCostume = {
  torsoColor: '#2c2c2c', limbColor: '#2c2c2c', torsoWidth: 18, armWidth: 10, legWidth: 11,
  headColor: '#2c2c2c', headScale: 1, auraColor: '#ffffff',
  shoeStyle: 'boot', shoeColor: '#2c2c2c',
  drawHead(ctx, f, hx, hy, r, t, m) {
    simpleEyes(ctx, hx, hy, r, '#1a1a1a', m.blinkClosed);
    void t;
  },
};

// Humorous effects pass: same cartoon "seeing birds" gag as renderFighter's
// drawCirclingBirds, duplicated here per this file's own no-shared-code
// convention. Orbit sized up a little for a boss's bigger head.
function drawCirclingBirds(ctx: CanvasRenderingContext2D, f: Fighter, shoulderY: number): void {
  const t = f.animTimeMs / 1000;
  const orbitY = shoulderY - 34;
  ctx.save();
  ctx.strokeStyle = '#3e2723';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = t * 4 + (i / 3) * Math.PI * 2;
    const bx = Math.cos(a) * 17;
    const by = orbitY + Math.sin(a) * 5.5;
    const flap = Math.sin(t * 17 + i * 2) * 4;
    ctx.beginPath();
    ctx.moveTo(bx - 6, by - flap);
    ctx.quadraticCurveTo(bx - 2.4, by - 2, bx, by);
    ctx.quadraticCurveTo(bx + 2.4, by - 2, bx + 6, by - flap);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBossStatusOverlay(ctx: CanvasRenderingContext2D, f: Fighter, shoulderY: number, hipY: number): void {
  const s = f.status;
  const t = f.animTimeMs / 1000;
  if (f.wrappedUntilMs > 0) {
    drawToiletPaperWrap(ctx, f.wrappedUntilMs, f.wrappedTotalMs, shoulderY, hipY, 17, t);
  } else if (f.dazedUntilMs > 0) {
    drawCirclingBirds(ctx, f, shoulderY);
  } else if (s.frozenUntilMs > 0) {
    drawSnowPile(ctx, s.frozenUntilMs, shoulderY, hipY, t);
  } else if (s.stunnedUntilMs > 0) {
    ctx.save();
    ctx.strokeStyle = '#ffd600';
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 3; i++) {
      const a = t * 7 + (i / 3) * Math.PI * 2;
      const cx = Math.cos(a) * 15;
      const cy = shoulderY - 30 + Math.sin(a) * 5;
      ctx.beginPath();
      ctx.moveTo(cx - 3.5, cy - 3.5);
      ctx.lineTo(cx + 3.5, cy + 3.5);
      ctx.moveTo(cx + 3.5, cy - 3.5);
      ctx.lineTo(cx - 3.5, cy + 3.5);
      ctx.stroke();
    }
    ctx.restore();
  } else if (s.slowUntilMs > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(139,195,74,0.55)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 2; i++) {
      const a = t * 1.4 + i * Math.PI;
      ctx.beginPath();
      ctx.ellipse(Math.sin(a) * 5, shoulderY - 26 - i * 7, 8, 4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (s.dotUntilMs > 0) {
    ctx.save();
    ctx.fillStyle = s.dotColor;
    for (let i = 0; i < 3; i++) {
      const cycle = (t * 1.6 + i * 0.33) % 1;
      ctx.globalAlpha = 0.5 * (1 - cycle);
      ctx.beginPath();
      ctx.arc(-8 + i * 8, hipY - 8 - cycle * 30, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function renderBoss(ctx: CanvasRenderingContext2D, f: Fighter, dtSec = 0): void {
  if (f.deathPhase === 'done') return;
  const target = computeBossPose(f);
  const pose = smoothPose(f, target, dtSec);
  const scale = f.scale;
  const x = f.body.pos.x;
  const groundY = f.body.groundY;
  const airLift = groundY - f.body.pos.y;
  const groundEmbed = f.body.grounded ? flattenGroundEmbed(f, pose) * scale : 0;

  ctx.save();
  ctx.translate(x, groundY - airLift + groundEmbed);
  ctx.scale(f.facing * scale, scale);
  if (pose.flatten > 0.001) {
    // Death/knockdown ground-anchor fix, two parts.
    // (1) A translate applied *after* a rotate operates in the rotated
    //     frame. With +90deg, local (a, b) lands at screen (-b, a) — so the
    //     old (-height*0.55, 6) pushed the whole lying body ~50px
    //     *upwards*, which is why corpses appeared to float above the
    //     ground. Local-y is now the along-the-body axis (centering the
    //     figure on its own x position) and local-x the vertical one (a few
    //     px, so the spine rests just above the ground line while the head
    //     circle nestles into it).
    // (2) Scaling by pose.flatten instead of thresholding at 0.5 makes
    //     falling over and climbing back up a continuous topple around the
    //     feet, rather than a hard snap the instant the blend crosses the
    //     halfway mark ('gettingUp' and 'bossDeath' both blend flatten).
    ctx.rotate((Math.PI / 2) * pose.flatten);
    ctx.translate(FLATTEN_GROUND_LIFT * pose.flatten, f.height * 0.45 * pose.flatten);
  }

  const flashInvuln = f.invulnerableMs > 0 && Math.floor(f.animTimeMs / 60) % 2 === 0;
  ctx.globalAlpha = flashInvuln ? 0.5 : 1;

  const headR = 15;
  const hipY = -f.height * 0.45 + pose.hipY;
  const shoulderY = -f.height * 0.78;
  const shoulderX = Math.sin(pose.bodyLean) * 12;
  const headY = shoulderY - headR - 3 + pose.headOffsetY;
  const headX = pose.headOffsetX;
  const t = f.animTimeMs / 1000;

  const costume = BOSS_COSTUMES[f.bossDefId ?? ''] ?? DEFAULT_COSTUME;
  const blinkClosed = updateBossBlink(f, dtSec);
  const m: Metrics = { hipY, shoulderY, shoulderX, headX, headY, headR: headR * costume.headScale, pose, blinkClosed };

  if (pose.auraPulse > 0) {
    drawChargeAura(ctx, shoulderX, (shoulderY + hipY) / 2, costume.auraColor, pose.auraPulse, hipY - shoulderY);
  }

  costume.drawBack?.(ctx, f, m, t);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const handColor = costume.handColor ?? HAND_COLOR;

  if (costume.customBody) {
    costume.customBody(ctx, f, m, t);
  } else {
    // Legs — filled, tapered, jointed at the knee, each ending in a real
    // shoe silhouette per costume (viking boots, knight sabatons, robot
    // feet, ...) instead of the old bare thin-line ends.
    const shoeStyle = costume.shoeStyle ?? 'none';
    const shoeColor = costume.shoeColor ?? costume.limbColor;
    if (costume.legWidth > 0) {
      drawLimb(ctx, 0, hipY, pose.legBackX, hipY + pose.legBackY, costume.legWidth, costume.legWidth * 0.72, 0.15, -1, costume.limbColor);
      drawBossShoe(ctx, pose.legBackX, hipY + pose.legBackY, footTiltAngle(pose.legBackX, pose.legBackY), shoeStyle, shoeColor);
      drawLimb(ctx, 0, hipY, pose.legFrontX, hipY + pose.legFrontY, costume.legWidth, costume.legWidth * 0.72, 0.15, -1, costume.limbColor);
      drawBossShoe(ctx, pose.legFrontX, hipY + pose.legFrontY, footTiltAngle(pose.legFrontX, pose.legFrontY), shoeStyle, shoeColor);
    }

    // Torso (thick fill-read tapered shape — a real body, not a thin wire).
    drawTaperedSegment(ctx, 0, hipY, shoulderX, shoulderY, costume.torsoWidth * 0.92, costume.torsoWidth, costume.torsoColor);
    costume.drawTorsoDetail?.(ctx, f, m, t);

    // Back arm + hand.
    const backArm = drawLimb(ctx, shoulderX, shoulderY, shoulderX + pose.armBackX, shoulderY + pose.armBackY, costume.armWidth, costume.armWidth * 0.75, 0.13, 1, costume.limbColor);
    if (!costume.noHands) drawHand(ctx, shoulderX + pose.armBackX, shoulderY + pose.armBackY, backArm.dirX, backArm.dirY, costume.armWidth * 0.45, handColor);
  }

  // Head.
  if (!costume.skipDefaultHead) {
    ctx.fillStyle = costume.headColor;
    ctx.beginPath();
    ctx.arc(shoulderX + headX, headY, headR * costume.headScale, 0, Math.PI * 2);
    ctx.fill();
  }
  costume.drawHead(ctx, f, shoulderX + headX, headY, headR * costume.headScale, t, m);

  // Front arm + hand + weapon (weapon drawn on top of the hand so it
  // reads as gripped, matching the player/normal-enemy rig) — skipped for
  // a customBody boss, which draws its own limbs/wings entirely itself.
  if (!costume.customBody) {
    const frontArm = drawLimb(ctx, shoulderX, shoulderY, shoulderX + pose.armFrontX, shoulderY + pose.armFrontY, costume.armWidth, costume.armWidth * 0.75, 0.13, 1, costume.limbColor);
    if (!costume.noHands) drawHand(ctx, shoulderX + pose.armFrontX, shoulderY + pose.armFrontY, frontArm.dirX, frontArm.dirY, costume.armWidth * 0.45, handColor);
  }
  drawWeaponInHand(ctx, f, shoulderX + pose.armFrontX, shoulderY + pose.armFrontY, pose.armFrontX, pose.armFrontY);

  costume.drawExtras?.(ctx, f, m, t);
  drawBossStatusOverlay(ctx, f, shoulderY, hipY);

  ctx.restore();
}
