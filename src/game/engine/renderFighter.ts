import type { Fighter } from '../entities/Fighter';
import { WEAPONS } from '../../data/weapons';

interface Pose {
  bodyLean: number; // radians, forward lean of torso
  hipY: number; // offset from standing hip height (positive = lower/crouch)
  headOffsetX: number;
  headOffsetY: number;
  armFrontX: number; armFrontY: number;
  armBackX: number; armBackY: number;
  legFrontX: number; legFrontY: number;
  legBackX: number; legBackY: number;
  capeKick: number; // extra upward/outward cape flare 0..1
  flatten: number; // 0..1, 1 = lying on the ground
  turnedAway: number; // 0..1, 1 = facing away from camera (fart pose)
}

const STAND: Pose = {
  bodyLean: 0, hipY: 0, headOffsetX: 0, headOffsetY: 0,
  armFrontX: 6, armFrontY: 26, armBackX: -6, armBackY: 26,
  legFrontX: 8, legFrontY: 40, legBackX: -8, legBackY: 40,
  capeKick: 0, flatten: 0, turnedAway: 0,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blend(a: Pose, b: Pose, t: number): Pose {
  const out: Record<string, number> = {};
  for (const key of Object.keys(a) as (keyof Pose)[]) {
    out[key] = lerp(a[key], b[key], t);
  }
  return out as unknown as Pose;
}

// Section 2 (polish pass): computePose() below is a pure function of
// anim/animTimeMs, so switching anim used to make the drawn pose *jump*
// straight to the new target every frame — most visible on kicks/attacks,
// which read as an abrupt, disconnected frame rather than a motion. This
// cache holds the last *displayed* pose per fighter so render() can ease
// toward the target each frame instead of snapping to it. It's purely a
// rendering-layer smoothing pass: hit-checks and input handling still key
// off the real animTimeMs/anim in GameEngine, so nothing about combat
// timing or responsiveness changes — only how the motion in between reads.
const displayPoseCache = new WeakMap<Fighter, Pose>();
// Time constant in seconds: how quickly the displayed pose closes the gap
// to the target. Small enough to stay snappy (~80% closed within 60ms)
// while still smoothing out the jump-cut between poses.
const POSE_SMOOTHING_TAU = 0.035;

function smoothPose(f: Fighter, target: Pose, dtSec: number): Pose {
  const previous = displayPoseCache.get(f);
  if (!previous || dtSec <= 0 || dtSec > 0.5) {
    displayPoseCache.set(f, target);
    return target;
  }
  const amount = 1 - Math.exp(-dtSec / POSE_SMOOTHING_TAU);
  const out: Record<string, number> = {};
  for (const key of Object.keys(target) as (keyof Pose)[]) {
    out[key] = lerp(previous[key], target[key], amount);
  }
  const smoothed = out as unknown as Pose;
  displayPoseCache.set(f, smoothed);
  return smoothed;
}

function computePose(f: Fighter): Pose {
  const t = f.animTimeMs / 1000;
  const cycle = Math.sin(t * 9);
  switch (f.anim) {
    case 'idle': {
      const bob = Math.sin(t * 2.4) * 2;
      return { ...STAND, hipY: bob, headOffsetY: bob * 0.6 };
    }
    case 'run': {
      const s = Math.sin(t * 16);
      return {
        ...STAND,
        bodyLean: 0.12,
        hipY: Math.abs(s) * -3,
        armFrontX: 10 * s, armFrontY: 22,
        armBackX: -10 * s, armBackY: 22,
        legFrontX: 18 * s, legFrontY: 38,
        legBackX: -18 * s, legBackY: 38,
      };
    }
    case 'jump':
      return { ...STAND, bodyLean: -0.05, legFrontX: 10, legFrontY: 24, legBackX: -6, legBackY: 20, armFrontY: 10, armBackY: 10 };
    case 'fall':
      return { ...STAND, bodyLean: 0.05, legFrontX: 14, legFrontY: 30, legBackX: -4, legBackY: 34, armFrontY: 14, armBackY: 14 };
    case 'attack':
      return {
        ...STAND, bodyLean: 0.22,
        armFrontX: 34, armFrontY: 8, armBackX: -14, armBackY: 30,
        legFrontX: 16, legFrontY: 40, legBackX: -10, legBackY: 40,
      };
    case 'kick':
      return {
        ...STAND, bodyLean: -0.15,
        armFrontX: -8, armFrontY: 24, armBackX: -18, armBackY: 20,
        legFrontX: 34, legFrontY: 16, legBackX: -6, legBackY: 42,
      };
    case 'block':
      return { ...STAND, bodyLean: 0.05, armFrontX: 18, armFrontY: 4, armBackX: 14, armBackY: 8 };
    case 'dodge':
      return { ...STAND, bodyLean: -0.3, hipY: 8, armFrontX: -10, armBackX: -14, legFrontX: 4, legBackX: -14 };
    case 'hit':
      return { ...STAND, bodyLean: -0.25, armFrontX: -14, armFrontY: 18, armBackX: -18, armBackY: 14 };
    case 'knockback':
      return { ...STAND, bodyLean: -0.55, hipY: -4, armFrontX: -24, armFrontY: 10, armBackX: -26, armBackY: 6, legFrontX: 22, legFrontY: 28, legBackX: 18, legBackY: 30 };
    case 'stagger': {
      const s = Math.sin(t * 10);
      return { ...STAND, bodyLean: 0.15 * s, hipY: 2, armFrontX: 10 * s, armBackX: -10 * s };
    }
    case 'fallen':
      return { ...STAND, flatten: 1, bodyLean: 0, armFrontX: 20, armFrontY: 4, armBackX: -14, armBackY: -4 };
    case 'gettingUp':
      return blend(
        { ...STAND, flatten: 1 },
        { ...STAND, bodyLean: 0.3, hipY: 10 },
        Math.min(1, t / 0.6),
      );
    case 'vomit':
      return { ...STAND, bodyLean: 0.5, hipY: 4, armFrontX: 14, armFrontY: 30, armBackX: 12, armBackY: 32, headOffsetY: 10 };
    case 'superpower':
    case 'fart': {
      // Section 7 (polish pass): a clear three-beat motion instead of one
      // continuous ramp — Vorbereitung (turn+start crouching), then a
      // deliberate deep-crouch "letting it rip" beat, then a short ease
      // back toward neutral. Timed to land the GameEngine's actual
      // superpower payload (fired at 0.38s) right in the deep-crouch beat.
      const prepEnd = 0.15;
      const mainEnd = 0.42;
      const totalEnd = 0.68;
      let turned: number, crouch: number, cape: number, lean: number, armX: number, armY: number;
      if (t < prepEnd) {
        const p = t / prepEnd;
        // Section 7/8/9 (polish pass): a brief announcing flinch (a quick
        // backward lean) before the body actually bends into position —
        // "press button -> character performs a matching movement" rather
        // than snapping straight into the crouch.
        const windup = Math.sin(p * Math.PI) * 0.12;
        turned = p * 0.7;
        crouch = p * 5;
        cape = 0;
        lean = p * 0.3 - windup;
        armX = -16 * p;
        armY = 26 - 12 * p;
      } else if (t < mainEnd) {
        const p = (t - prepEnd) / (mainEnd - prepEnd);
        turned = 0.7 + p * 0.3;
        crouch = 5 + p * 9;
        cape = p;
        lean = 0.3;
        armX = -16;
        armY = 14;
      } else {
        const p = Math.min(1, (t - mainEnd) / (totalEnd - mainEnd));
        turned = 1 - p * 0.35;
        crouch = 14 - p * 9;
        cape = 1 - p * 0.6;
        lean = 0.3 - p * 0.3;
        armX = -16 + p * 16;
        armY = 14 + p * 12;
      }
      return {
        ...STAND, turnedAway: turned, bodyLean: lean, hipY: crouch,
        armFrontX: armX, armFrontY: armY, armBackX: armX, armBackY: armY,
        capeKick: cape,
      };
    }
    case 'taunt': {
      // Boss individuality polish pass: three lightweight gesture variants
      // reused across bosses (the clown cycles through all three; every
      // other boss also cycles, just less centrally, per f.tauntVariant).
      const variant = f.tauntVariant % 3;
      if (variant === 0) {
        // Lean forward, hands resting on the belly.
        return {
          ...STAND, bodyLean: 0.36, hipY: 3, headOffsetY: 3,
          armFrontX: -9, armFrontY: 22, armBackX: -13, armBackY: 22,
        };
      } else if (variant === 1) {
        // Point an arm forward, provoking the player.
        return {
          ...STAND, bodyLean: 0.1,
          armFrontX: 30, armFrontY: 2, armBackX: -10, armBackY: 26,
        };
      }
      // Arms thrown up, laughing, head tilted back a little.
      const laugh = Math.sin(t * 15) * 3;
      return {
        ...STAND, bodyLean: -0.12, headOffsetX: 3, headOffsetY: laugh,
        armFrontX: -6, armFrontY: -8, armBackX: -14, armBackY: -5,
      };
    }
    case 'dead':
      return { ...STAND, flatten: 1, hipY: 0 };
    case 'bossIntro':
      return { ...STAND, hipY: Math.sin(t * 3) * 4, armFrontY: 6, armBackY: 6 };
    case 'bossDeath':
      return blend({ ...STAND }, { ...STAND, flatten: 1, bodyLean: 0.4 }, Math.min(1, t / 1.2));
    default: {
      void cycle;
      return STAND;
    }
  }
}

// Section 3 (polish pass, revised): the physics ground position (pos.y ===
// groundY when grounded) sits *exactly* on the drawn ground line, but the
// pose rig's own leg lengths land the feet short of (or, for bosses, far
// short of) that line depending on the fighter's height/scale — a fixed
// pixel offset here can't work for every fighter size at once (it was tuned
// against the player's proportions and left tall/scaled-up bosses floating
// badly). Instead this now derives the exact local Y of the lowest foot
// from the same hip/leg numbers the pose rig already uses, so any fighter
// of any height/scale gets its feet planted precisely on the ground line —
// in every pose (idle, run, attack, hit, ...), since it reads the *current*
// pose each frame rather than assuming one fixed gap. A small safety
// margin keeps feet read as solidly planted rather than merely touching.
// Never applies mid-air, so jumping/falling still lifts and lands cleanly.
const FOOT_SAFETY_EMBED = 2;
// Fallen/dead poses go through a separate rotate+translate path below
// (the rig is drawn "on its side"), where the pose's leg numbers no longer
// correspond to vertical foot position — a modest scaled constant here
// keeps that case simple and stable rather than feeding it geometry that
// no longer means what it means while standing.
const GROUND_EMBED_FLATTEN = 4;

function lowestFootLocalY(f: Fighter, pose: Pose): number {
  const hipYLocal = -f.height * 0.45 + pose.hipY;
  const legReachLocal = Math.max(pose.legFrontY, pose.legBackY, 0);
  return hipYLocal + legReachLocal;
}

/** Draws Captain Windel / an enemy / a boss as a minimalist stick figure
 * with an animated cape and layered visual equipment (section 6/21). The
 * figure is always instantly readable as a stickman — spectacle comes from
 * effects layered around it, not from the figure itself (section 47/63).
 * `dtSec` drives the pose-smoothing pass (section 2) — pass 0 to snap
 * straight to the target pose (e.g. for a one-off static preview render). */
export function renderFighter(ctx: CanvasRenderingContext2D, f: Fighter, dtSec = 0): void {
  if (f.deathPhase === 'done') return;
  const target = computePose(f);
  const pose = smoothPose(f, target, dtSec);
  const scale = f.scale;
  const x = f.body.pos.x;
  const groundY = f.body.groundY;
  const airLift = groundY - f.body.pos.y;
  const groundEmbed = f.body.grounded
    ? (pose.flatten > 0.5
      ? GROUND_EMBED_FLATTEN * scale
      : (-lowestFootLocalY(f, pose) + FOOT_SAFETY_EMBED) * scale)
    : 0;

  ctx.save();
  ctx.translate(x, groundY - airLift + groundEmbed);
  ctx.scale(f.facing * scale, scale);

  if (pose.flatten > 0.5) {
    ctx.rotate(Math.PI / 2);
    ctx.translate(-f.height * 0.55, 6);
  }

  const flashInvuln = f.invulnerableMs > 0 && Math.floor(f.animTimeMs / 60) % 2 === 0;
  ctx.globalAlpha = flashInvuln ? 0.5 : 1;

  const headR = 12;
  const hipY = -f.height * 0.45 + pose.hipY;
  const shoulderY = -f.height * 0.78;
  const headY = shoulderY - headR - 2 + pose.headOffsetY;
  const headX = pose.headOffsetX;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 5;

  // Cape (drawn behind body).
  drawCape(ctx, f, shoulderY, pose);

  // Legs.
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(pose.legBackX, hipY + pose.legBackY);
  ctx.moveTo(0, hipY);
  ctx.lineTo(pose.legFrontX, hipY + pose.legFrontY);
  ctx.stroke();

  // Torso.
  const shoulderX = Math.sin(pose.bodyLean) * 10;
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(shoulderX, shoulderY);
  ctx.stroke();

  // Diaper (player only) at hip.
  if (f.accessories.includes('diaper')) {
    ctx.save();
    ctx.fillStyle = '#f5f5f5';
    ctx.strokeStyle = '#dcdcdc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-9, hipY - 4, 18, 14, 5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawBodyAccessories(ctx, f, shoulderX, shoulderY, hipY);
  if (f.kind === 'boss') drawBossFlair(ctx, f, shoulderX, shoulderY, hipY, f.animTimeMs / 1000);

  // Back arm (behind torso).
  drawArm(ctx, shoulderX, shoulderY, pose.armBackX, pose.armBackY, f, false);

  // Head.
  ctx.beginPath();
  ctx.fillStyle = f.color;
  ctx.arc(shoulderX + headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  drawHeadAccessories(ctx, f, shoulderX + headX, headY, headR);

  if (!pose.turnedAway) {
    // Section (polish pass): a single tiny, low-contrast eye used to read
    // as "no eyes at all" against most head colors. Bigger white with a
    // dark outline plus a friendly stroked smile keep the face instantly
    // readable and clearly comic/humorous rather than realistic.
    ctx.save();
    const eyeX = 5;
    const eyeY = -1;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(shoulderX + headX + eyeX, headY + eyeY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(shoulderX + headX + eyeX + 1.6, headY + eyeY, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(shoulderX + headX + 3, headY + 6, 4.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  // Front arm (in front of torso, holds weapon).
  drawArm(ctx, shoulderX, shoulderY, pose.armFrontX, pose.armFrontY, f, true);
  drawWeaponInHand(ctx, f, shoulderX + pose.armFrontX, shoulderY + pose.armFrontY, pose.armFrontX, pose.armFrontY);

  drawFeetAccessories(ctx, f, pose, hipY);
  drawStatusOverlay(ctx, f, shoulderY, hipY);

  ctx.restore();
}

function drawArm(ctx: CanvasRenderingContext2D, sx: number, sy: number, dx: number, dy: number, f: Fighter, front: boolean): void {
  ctx.save();
  ctx.lineWidth = f.accessories.includes('gloves') && front ? 7 : 5;
  ctx.strokeStyle = f.color;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + dx, sy + dy);
  ctx.stroke();
  if (f.accessories.includes('gloves') || f.accessories.includes('boxingGloves')) {
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(sx + dx, sy + dy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (front && f.weaponFlashMs > 0) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx + dx, sy + dy, 10, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Section (polish pass): weapons used to render as one undifferentiated
// line (plus a circle for the frypan) at a fixed angle unrelated to the
// arm — every weapon looked the same and could visibly clip through the
// arm whenever the arm pose changed. Each weapon now gets its own
// recognizable silhouette, drawn rotated to the actual shoulder->hand
// direction so it always extends naturally out of the hand instead of
// crossing the arm at an arbitrary angle.
function drawWeaponInHand(ctx: CanvasRenderingContext2D, f: Fighter, handX: number, handY: number, armDx: number, armDy: number): void {
  if (f.weaponId === 'fists' || f.weaponId === 'boxingGloves') return;
  const weapon = WEAPONS[f.weaponId];
  const angle = Math.atan2(armDy, armDx);

  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // From here on, +x runs along the arm's own direction (out of the hand)
  // and +y is perpendicular to it — every shape below is defined in that
  // local frame so it stays glued to the hand and arm angle.

  switch (weapon.id) {
    case 'sword': {
      ctx.strokeStyle = '#6d4c2f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();
      ctx.strokeStyle = '#2c2c2c';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(2, -8);
      ctx.lineTo(2, 8);
      ctx.stroke();
      ctx.fillStyle = weapon.color;
      ctx.beginPath();
      ctx.moveTo(2, -4.5);
      ctx.lineTo(38, -2.5);
      ctx.lineTo(44, 0);
      ctx.lineTo(38, 2.5);
      ctx.lineTo(2, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8f9a9c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(40, 0);
      ctx.stroke();
      break;
    }
    case 'axe': {
      ctx.strokeStyle = '#6d4c2f';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(26, 0);
      ctx.stroke();
      ctx.fillStyle = weapon.color;
      ctx.beginPath();
      ctx.moveTo(20, -3);
      ctx.quadraticCurveTo(36, -20, 22, -22);
      ctx.quadraticCurveTo(30, -6, 20, 8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#4a5556';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'club': {
      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(20, 0);
      ctx.stroke();
      ctx.fillStyle = weapon.color;
      ctx.beginPath();
      ctx.ellipse(28, 0, 11, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a2414';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(28, 0, 5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'frypan': {
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(18, 0);
      ctx.stroke();
      ctx.fillStyle = weapon.color;
      ctx.beginPath();
      ctx.arc(28, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5a5a5a';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(25, -3, 6, Math.PI * 1.1, Math.PI * 1.7);
      ctx.stroke();
      break;
    }
    case 'spear': {
      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(44, 0);
      ctx.stroke();
      ctx.fillStyle = weapon.trailColor ?? '#e8d8b0';
      ctx.beginPath();
      ctx.moveTo(40, -4);
      ctx.lineTo(58, 0);
      ctx.lineTo(40, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8a7350';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case 'branch': {
      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(28, -2);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(10, -1);
      ctx.lineTo(16, -8);
      ctx.moveTo(18, -1.5);
      ctx.lineTo(23, 5);
      ctx.stroke();
      break;
    }
    case 'boomerang': {
      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(10, 10, 16, Math.PI * 1.05, Math.PI * 1.75);
      ctx.stroke();
      break;
    }
    case 'bow': {
      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(4, 0, 20, Math.PI * 0.62, Math.PI * 1.38);
      ctx.stroke();
      ctx.strokeStyle = weapon.trailColor ?? '#f1c40f';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(4 + Math.cos(Math.PI * 0.62) * 20, Math.sin(Math.PI * 0.62) * 20);
      ctx.lineTo(4 + Math.cos(Math.PI * 1.38) * 20, Math.sin(Math.PI * 1.38) * 20);
      ctx.stroke();
      break;
    }
    default: {
      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(24, 0);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawCape(ctx: CanvasRenderingContext2D, f: Fighter, shoulderY: number, pose: Pose): void {
  if (!f.accessories.includes('cape') && !f.accessories.includes('fancyCape')) return;
  const t = f.animTimeMs / 1000;
  const sway = Math.sin(t * 4) * 6 + f.body.vel.x * -0.02;
  const kick = pose.capeKick * 40;
  const isMoving = f.anim === 'run';
  const flare = (isMoving ? 14 : 0) + kick;

  ctx.save();
  ctx.fillStyle = f.accessories.includes('fancyCape') ? '#8e24aa' : '#c0392b';
  ctx.beginPath();
  ctx.moveTo(-4, shoulderY + 2);
  ctx.lineTo(4, shoulderY + 2);
  ctx.quadraticCurveTo(-10 - sway - flare, shoulderY + 30 - kick * 0.6, -14 - sway * 1.5 - flare, shoulderY + 62 - kick);
  ctx.quadraticCurveTo(-2 - sway, shoulderY + 45, -4, shoulderY + 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHeadAccessories(ctx: CanvasRenderingContext2D, f: Fighter, hx: number, hy: number, r: number): void {
  const has = (id: string) => f.accessories.includes(id);
  if (has('pot')) {
    ctx.save();
    ctx.fillStyle = '#9e9e9e';
    ctx.beginPath();
    ctx.arc(hx, hy - 4, r + 3, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(hx - r - 3, hy - 6, (r + 3) * 2, 4);
    ctx.restore();
  }
  if (has('wizardHat')) {
    ctx.save();
    ctx.fillStyle = '#5e35b1';
    ctx.beginPath();
    ctx.moveTo(hx - r, hy - 4);
    ctx.lineTo(hx + 2, hy - r * 2.6);
    ctx.lineTo(hx + r + 2, hy - 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (has('ninjaMask')) {
    ctx.save();
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(hx - r, hy - 3, r * 2, 6);
    ctx.restore();
  }
  if (has('clownNose')) {
    ctx.save();
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(hx + r - 2, hy + 2, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (has('clownHat')) {
    ctx.save();
    ctx.fillStyle = '#fdd835';
    ctx.beginPath();
    ctx.moveTo(hx - r + 2, hy - 6);
    ctx.lineTo(hx + 4, hy - r * 3);
    ctx.lineTo(hx + r, hy - 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  if (has('chickenBeak')) {
    ctx.save();
    ctx.fillStyle = '#ff9800';
    ctx.beginPath();
    ctx.moveTo(hx + r - 2, hy);
    ctx.lineTo(hx + r + 8, hy + 2);
    ctx.lineTo(hx + r - 2, hy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.moveTo(hx - 2, hy - r - 1);
    ctx.lineTo(hx + 4, hy - r - 8);
    ctx.lineTo(hx + 8, hy - r - 1);
    ctx.fill();
    ctx.restore();
  }
}

function drawFeetAccessories(ctx: CanvasRenderingContext2D, f: Fighter, pose: Pose, hipY: number): void {
  if (!f.accessories.includes('bigShoes') && !f.accessories.includes('clownShoes')) return;
  ctx.save();
  ctx.fillStyle = f.accessories.includes('clownShoes') ? '#e53935' : '#5d4037';
  const size = f.accessories.includes('clownShoes') ? 14 : 10;
  ctx.beginPath();
  ctx.ellipse(pose.legFrontX, hipY + pose.legFrontY, size, size * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(pose.legBackX, hipY + pose.legBackY, size, size * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (f.accessories.includes('shield')) {
    ctx.save();
    ctx.fillStyle = '#607d8b';
    ctx.beginPath();
    ctx.ellipse(-16, hipY - 20, 8, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Section (polish pass): superpowers already apply their slow/freeze/
// stun/dot debuffs to `f.status` (unchanged — see GameEngine.fireSuperpower
// and Fighter.applySlow/applyFreeze/applyStun/applyDot); this only reads
// that existing state to draw a matching visual cue, so an enemy hit by
// ice/gas/electro/chili visibly reads as frozen/slowed/stunned/burning for
// as long as the (already-tuned) effect actually lasts — no new numbers,
// purely a readability pass on effects that already work.
function drawStatusOverlay(ctx: CanvasRenderingContext2D, f: Fighter, shoulderY: number, hipY: number): void {
  const s = f.status;
  const t = f.animTimeMs / 1000;
  if (s.frozenUntilMs > 0) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#b3e5fc';
    ctx.beginPath();
    ctx.roundRect(-13, shoulderY - 2, 26, hipY - shoulderY + 44, 8);
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#e1f5fe';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      const a = t * 1.6 + i * 2.1;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 9, shoulderY + 8 + i * 14, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (s.stunnedUntilMs > 0) {
    ctx.save();
    ctx.strokeStyle = '#ffd600';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = t * 7 + (i / 3) * Math.PI * 2;
      const cx = Math.cos(a) * 12;
      const cy = shoulderY - 24 + Math.sin(a) * 4;
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 3);
      ctx.lineTo(cx + 3, cy + 3);
      ctx.moveTo(cx + 3, cy - 3);
      ctx.lineTo(cx - 3, cy + 3);
      ctx.stroke();
    }
    ctx.restore();
  } else if (s.slowUntilMs > 0) {
    ctx.save();
    ctx.strokeStyle = 'rgba(139,195,74,0.6)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 2; i++) {
      const a = t * 1.4 + i * Math.PI;
      ctx.beginPath();
      ctx.ellipse(Math.sin(a) * 4, shoulderY - 22 - i * 6, 7, 3.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (s.dotUntilMs > 0) {
    ctx.save();
    ctx.fillStyle = s.dotColor;
    for (let i = 0; i < 3; i++) {
      const cycle = (t * 1.6 + i * 0.33) % 1;
      const fx = -6 + i * 6;
      const fy = hipY - 6 - cycle * 26;
      ctx.globalAlpha = 0.55 * (1 - cycle);
      ctx.beginPath();
      ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawBodyAccessories(ctx: CanvasRenderingContext2D, f: Fighter, shoulderX: number, shoulderY: number, hipY: number): void {
  if (!f.accessories.includes('heavyArmor')) return;
  ctx.save();
  ctx.fillStyle = '#5c6b73';
  ctx.strokeStyle = '#2f3a3e';
  ctx.lineWidth = 1.3;
  const plateW = 13;
  const plateTop = shoulderY + 6;
  const plateH = (hipY - plateTop) * 0.65;
  ctx.beginPath();
  ctx.roundRect(shoulderX - plateW / 2, plateTop, plateW, plateH, 3);
  ctx.fill();
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(shoulderX + side * 9, shoulderY + 2, 7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// Section (polish pass): bosses used to be normal-stickman-shaped enemies
// with a bigger health bar — same silhouette, same accessories pattern as
// regular enemies, nothing that read as "this is a unique character."
// Each boss now gets a small set of extra shapes keyed to its own def id,
// layered on top of the shared stick-figure rig so every boss keeps one
// consistent art style while still being instantly distinguishable from
// both normal enemies and every other boss.
function drawBossFlair(ctx: CanvasRenderingContext2D, f: Fighter, shoulderX: number, shoulderY: number, hipY: number, t: number): void {
  switch (f.bossDefId) {
    case 'clown': {
      ctx.save();
      const colors = ['#e53935', '#fdd835', '#1e88e5'];
      for (let i = -3; i <= 3; i++) {
        ctx.fillStyle = colors[(i + 9) % colors.length];
        ctx.beginPath();
        ctx.arc(shoulderX + i * 4.2, shoulderY + 4, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fdd835';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(shoulderX + 1, shoulderY + 14 + i * 10, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case 'ironTree': {
      ctx.save();
      ctx.strokeStyle = '#5d4630';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const y = shoulderY + 10 + i * 12;
        ctx.beginPath();
        ctx.moveTo(shoulderX - 5, y);
        ctx.lineTo(shoulderX + 5, y + 4);
        ctx.stroke();
      }
      ctx.fillStyle = '#4caf50';
      ctx.beginPath();
      ctx.ellipse(shoulderX + 10, shoulderY - 30, 5, 2.6, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'magmaBrute': {
      ctx.save();
      ctx.strokeStyle = '#ff7043';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(shoulderX - 4, shoulderY + 8);
      ctx.lineTo(shoulderX + 2, shoulderY + 16);
      ctx.lineTo(shoulderX - 2, shoulderY + 24);
      ctx.lineTo(shoulderX + 3, shoulderY + 32);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,171,64,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'frostQueen': {
      ctx.save();
      ctx.strokeStyle = '#81d4fa';
      ctx.lineWidth = 1.6;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(shoulderX + side * 7, shoulderY - 2);
        ctx.lineTo(shoulderX + side * 12, shoulderY - 14);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(129,212,250,0.3)';
      ctx.beginPath();
      ctx.arc(shoulderX, (shoulderY + hipY) / 2, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'chicken': {
      ctx.save();
      ctx.fillStyle = '#eeeeee';
      ctx.strokeStyle = '#bdbdbd';
      ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(shoulderX + side * 9, shoulderY + 10, 6, 3, side * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'stoneKnight': {
      ctx.save();
      ctx.strokeStyle = '#78716c';
      ctx.lineWidth = 1;
      const top = shoulderY + 4;
      const bottom = hipY - 4;
      for (let y = top; y < bottom; y += 7) {
        ctx.beginPath();
        ctx.moveTo(shoulderX - 8, y);
        ctx.lineTo(shoulderX + 8, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(shoulderX, top);
      ctx.lineTo(shoulderX, bottom);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'graveWraith': {
      ctx.save();
      ctx.fillStyle = 'rgba(69,90,100,0.55)';
      ctx.beginPath();
      ctx.moveTo(shoulderX - 8, shoulderY + 2);
      ctx.lineTo(shoulderX + 8, shoulderY + 2);
      for (let i = 0; i <= 5; i++) {
        const px = shoulderX + 8 - i * 3.2;
        const py = hipY + 6 + (i % 2 === 0 ? 6 : 0);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'stormTitan': {
      ctx.save();
      ctx.fillStyle = '#455a64';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(shoulderX + side * 6, shoulderY);
        ctx.lineTo(shoulderX + side * 13, shoulderY - 10);
        ctx.lineTo(shoulderX + side * 9, shoulderY + 3);
        ctx.closePath();
        ctx.fill();
      }
      if (Math.sin(t * 6) > 0.6) {
        ctx.strokeStyle = '#fff59d';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(shoulderX - 10, shoulderY + 20);
        ctx.lineTo(shoulderX - 4, shoulderY + 26);
        ctx.lineTo(shoulderX - 8, shoulderY + 32);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'chaosHydra': {
      ctx.save();
      ctx.globalAlpha = 0.45 + Math.sin(t * 3) * 0.15;
      ctx.strokeStyle = '#ce93d8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(shoulderX, (shoulderY + hipY) / 2, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(shoulderX - 14, shoulderY - 8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'windelNemesis': {
      ctx.save();
      ctx.fillStyle = 'rgba(120,20,140,0.5)';
      ctx.beginPath();
      ctx.moveTo(shoulderX - 6, shoulderY - 16);
      ctx.lineTo(shoulderX, shoulderY - 28);
      ctx.lineTo(shoulderX + 6, shoulderY - 16);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    default:
      break;
  }
}
