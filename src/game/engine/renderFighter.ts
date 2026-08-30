import type { Fighter } from '../entities/Fighter';
import { WEAPONS } from '../../data/weapons';
import { CAPE_COLORS, CHARACTERS } from '../../data/characters';
import type { CharacterDef } from '../types';
import { windGust } from './renderArena';

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
  // Character/movement-quality pass: knee/elbow bend used to be one fixed
  // constant (0.16) for every pose, so a leg mid-stride and a leg planted
  // flat on the ground bent by exactly the same amount — a big part of why
  // walking read as "sliding" rather than genuine weight-bearing steps.
  // These let individual poses (run's mid-swing leg especially) call for a
  // deeper bend, while everything that doesn't care keeps the old default.
  bendFront: number;
  bendBack: number;
}

const STAND: Pose = {
  bodyLean: 0, hipY: 0, headOffsetX: 0, headOffsetY: 0,
  armFrontX: 6, armFrontY: 26, armBackX: -6, armBackY: 26,
  legFrontX: 8, legFrontY: 40, legBackX: -8, legBackY: 40,
  capeKick: 0, flatten: 0, turnedAway: 0,
  bendFront: 0.16, bendBack: 0.16,
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
      // Movement-quality pass: a believable gait needs (a) arms swinging
      // opposite the leg on the same side (contralateral, the way people
      // actually walk/run — the old version swung them in lockstep with
      // the legs, which reads as marching-in-place rather than running),
      // (b) the swinging leg's knee bending deepest as it passes under the
      // body (mid-stride) and straightening as it reaches out to plant,
      // and (c) a touch of hip/shoulder counter-rotation and a head that
      // stays basically level but still visibly rides along with the gait.
      const s = Math.sin(t * 16);
      const strideK = 1 - Math.abs(s); // 0 at full extension, 1 at mid-stride
      return {
        ...STAND,
        bodyLean: 0.12 + s * 0.03,
        hipY: Math.abs(s) * -3,
        headOffsetY: Math.abs(s) * -1.2,
        armFrontX: -11 * s, armFrontY: 20 - strideK * 4,
        armBackX: 11 * s, armBackY: 20 - strideK * 4,
        legFrontX: 18 * s, legFrontY: 38 - strideK * 6,
        legBackX: -18 * s, legBackY: 38 - strideK * 6,
        bendFront: 0.16 + strideK * 0.26,
        bendBack: 0.16 + strideK * 0.26,
      };
    }
    case 'jump': {
      // A brief crouch-and-launch beat right as the jump starts (even
      // though the physics impulse already fired instantly) so the push-
      // off actually reads as a push-off, easing into a tucked airborne
      // pose with the legs drawn up rather than dangling straight down.
      const launchP = Math.min(1, t / 0.14);
      const crouch = (1 - launchP) * 9;
      return {
        ...STAND, bodyLean: -0.05 - crouch * 0.01, hipY: crouch,
        legFrontX: lerp(4, 11, launchP), legFrontY: lerp(30, 22, launchP),
        legBackX: lerp(-3, -7, launchP), legBackY: lerp(26, 18, launchP),
        armFrontY: lerp(20, 8, launchP), armBackY: lerp(20, 8, launchP),
        bendFront: 0.32, bendBack: 0.3,
      };
    }
    case 'fall': {
      // Legs tucked while rising/at the apex, then visibly reaching back
      // out toward the ground (readying to plant) the faster the fighter
      // is actually falling — driven by the real physics velocity rather
      // than a single static airborne pose.
      const fallSpeed = Math.max(0, f.body.vel.y) / 700; // 0 near apex, ~1 in a fast fall
      const reach = Math.min(1, fallSpeed);
      return {
        ...STAND, bodyLean: 0.05 + reach * 0.05,
        legFrontX: lerp(11, 15, reach), legFrontY: lerp(24, 34, reach),
        legBackX: lerp(-6, -4, reach), legBackY: lerp(20, 32, reach),
        armFrontY: lerp(9, 16, reach), armBackY: lerp(9, 16, reach),
        bendFront: lerp(0.3, 0.18, reach), bendBack: lerp(0.28, 0.18, reach),
      };
    }
    case 'attack':
      return computeAttackPose(f, t);
    case 'kick':
      return {
        ...STAND, bodyLean: -0.15,
        armFrontX: -8, armFrontY: 24, armBackX: -18, armBackY: 20,
        legFrontX: 34, legFrontY: 16, legBackX: -6, legBackY: 42,
        bendFront: 0.08, bendBack: 0.16,
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
    case 'dazed': {
      // Humorous effects pass: a real banana-slip stagger, not a pose-swap —
      // legs shoot out from under the body, arms flail for balance, then it
      // settles into a woozy sway with circling birds (drawn separately)
      // above the head. slipEnd/settleStart tuned against the ~1.1s daze
      // window set in GameEngine's banana trigger.
      const slipEnd = 0.22;
      const settleStart = 0.45;
      if (t < slipEnd) {
        const p = t / slipEnd;
        return {
          ...STAND, bodyLean: -0.5 * p, hipY: 10 * p,
          legFrontX: 26 * p, legFrontY: 14 + 10 * p,
          legBackX: -20 * p, legBackY: 30 - 8 * p,
          armFrontX: -22 * p, armFrontY: -6 * p,
          armBackX: 24 * p, armBackY: -4 * p,
        };
      }
      const p = Math.min(1, (t - slipEnd) / (settleStart - slipEnd));
      const sway = Math.sin(t * 5) * 5 * (1 - p * 0.5);
      return blend(
        {
          ...STAND, bodyLean: -0.5, hipY: 10,
          legFrontX: 26, legFrontY: 24, legBackX: -20, legBackY: 22,
          armFrontX: -22, armFrontY: -6, armBackX: 24, armBackY: -4,
        },
        { ...STAND, bodyLean: 0.06 * sway, hipY: 6, headOffsetX: sway * 0.6 },
        p,
      );
    }
    case 'surprised': {
      // Humorous effects pass: a quick cartoon "whoa!" startle — arms fly
      // up and out, head snaps back — used for the air-support stork
      // distraction and the diaper-bomb impact. Settles into a brief
      // wobbly hold rather than an instant snap, so it reads as a real
      // reaction rather than a pose-swap.
      const p = Math.min(1, t / 0.22);
      const wobble = Math.sin(t * 7) * (1 - p) * 3;
      return {
        ...STAND, bodyLean: -0.22 * p, headOffsetY: -5 * p + wobble,
        armFrontX: -20 * p, armFrontY: -14 * p,
        armBackX: 20 * p, armBackY: -12 * p,
      };
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
      // Section (quality pass): four clearly readable beats, slower overall
      // than before so the bend genuinely reads as a body movement rather
      // than a pose-swap — stand -> brief announce -> a real, visible
      // forward bend (torso leans, hips crouch low, the character turns so
      // the rear faces the enemy) -> a short held beat right as the gas/
      // fire actually releases -> standing back up. Timed so GameEngine's
      // actual payload (fired at 0.6s, see useSuperpower) lands inside the
      // held-release beat, not before the bend has actually completed.
      const announceEnd = 0.18;
      const bendEnd = 0.5;
      const releaseEnd = 0.68;
      const totalEnd = 1.0;
      let turned: number, crouch: number, cape: number, lean: number, armX: number, armY: number;
      if (t < announceEnd) {
        const p = t / announceEnd;
        // A brief announcing flinch (quick backward lean) before the body
        // actually starts bending — "press button -> character performs a
        // matching movement" rather than snapping straight into the crouch.
        const flinch = Math.sin(p * Math.PI) * 0.14;
        turned = p * 0.2;
        crouch = p * 2;
        cape = 0;
        lean = p * 0.1 - flinch;
        armX = -6 * p;
        armY = 26 - 4 * p;
      } else if (t < bendEnd) {
        const p = (t - announceEnd) / (bendEnd - announceEnd);
        turned = 0.2 + p * 0.8;
        crouch = 2 + p * 15;
        cape = p * 0.8;
        lean = 0.1 + p * 0.35;
        armX = -6 - p * 12;
        armY = 22 - p * 10;
      } else if (t < releaseEnd) {
        const p = (t - bendEnd) / (releaseEnd - bendEnd);
        turned = 1;
        crouch = 17 + Math.sin(p * Math.PI) * 2;
        cape = 0.8 + p * 0.2;
        lean = 0.45;
        armX = -18;
        armY = 12;
      } else {
        const p = Math.min(1, (t - releaseEnd) / (totalEnd - releaseEnd));
        turned = 1 - p * 0.6;
        crouch = 17 - p * 17;
        cape = 1 - p * 0.7;
        lean = 0.45 - p * 0.45;
        armX = -18 + p * 24;
        armY = 12 + p * 14;
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

// ---------------------------------------------------------------------
// Weapon-quality pass: every weapon used to share one identical "attack"
// pose (arm swings to one fixed angle) regardless of what was actually
// equipped — a spear thrust and a sword swing looked the same, and a bow
// never visibly drew a string at all. Each weapon family now gets its own
// multi-phase choreography (windup -> strike/thrust/release -> follow-
// through -> recover-to-guard) that moves the whole body, not just the
// hand, matching real weapon handling far more closely.
// ---------------------------------------------------------------------

function computeAttackPose(f: Fighter, t: number): Pose {
  if (f.weaponId === 'spear') return computeSpearThrust(t);
  if (f.weaponId === 'bow') return computeBowShot(t);
  return computeSwingAttack(t, f.weaponId);
}

function computeSwingAttack(t: number, weaponId: Fighter['weaponId']): Pose {
  const heavy = weaponId === 'axe' || weaponId === 'club' || weaponId === 'frypan';
  const windupEnd = heavy ? 0.13 : 0.1;
  const strikeEnd = heavy ? 0.28 : 0.22;
  const followEnd = heavy ? 0.42 : 0.36;
  const totalEnd = heavy ? 0.66 : 0.58;
  // Windup: torso winds back and the weapon arm pulls up and behind —
  // "holt aus" — with the off arm counter-balancing forward.
  const windupPose: Pose = {
    ...STAND, bodyLean: -0.18, armFrontX: -20, armFrontY: -8, armBackX: -8, armBackY: 30,
    legFrontX: 6, legFrontY: 40, legBackX: -12, legBackY: 40, bendFront: 0.13,
  };
  // Strike: torso snaps forward hard, weight shifts onto the front leg,
  // the weapon arm sweeps through in front of the body.
  const strikePose: Pose = {
    ...STAND, bodyLean: heavy ? 0.42 : 0.34, armFrontX: heavy ? 38 : 36, armFrontY: 6,
    armBackX: -18, armBackY: 20, legFrontX: 24, legFrontY: 38, legBackX: -8, legBackY: 42,
    bendFront: 0.24, bendBack: 0.16,
  };
  // Follow-through: the weapon's own weight keeps carrying the arm a touch
  // further past the strike point before it can be reined back in — a
  // heavier weapon (axe/club/pan) overswings noticeably further.
  const followPose: Pose = {
    ...STAND, bodyLean: heavy ? 0.32 : 0.22, armFrontX: heavy ? 46 : 39, armFrontY: 15,
    armBackX: -10, armBackY: 26, legFrontX: 18, legFrontY: 40, legBackX: -10, legBackY: 40,
  };
  const guardPose: Pose = { ...STAND, bodyLean: 0.06, armFrontX: 10, armFrontY: 20, armBackX: -8, armBackY: 26 };

  if (t < windupEnd) return blend(STAND, windupPose, t / windupEnd);
  if (t < strikeEnd) return blend(windupPose, strikePose, (t - windupEnd) / (strikeEnd - windupEnd));
  if (t < followEnd) return blend(strikePose, followPose, (t - strikeEnd) / (followEnd - strikeEnd));
  return blend(followPose, guardPose, Math.min(1, (t - followEnd) / (totalEnd - followEnd)));
}

// Spear: a real two-handed-reading thrust — pull back and load weight onto
// the back leg, then drive forward off a stabilizing front leg with both
// arms extending together (the back arm trails close behind the front one
// rather than swinging independently, selling the two-hand grip) instead
// of the weapon arm alone swinging like a sword.
function computeSpearThrust(t: number): Pose {
  const drawEnd = 0.12;
  const thrustEnd = 0.26;
  const holdEnd = 0.36;
  const totalEnd = 0.58;
  const drawPose: Pose = {
    ...STAND, bodyLean: -0.22, hipY: 2, armFrontX: -14, armFrontY: 8, armBackX: -20, armBackY: 12,
    legFrontX: -2, legFrontY: 40, legBackX: -18, legBackY: 40, bendFront: 0.12, bendBack: 0.22,
  };
  const thrustPose: Pose = {
    ...STAND, bodyLean: 0.32, armFrontX: 42, armFrontY: 2, armBackX: 22, armBackY: 8,
    legFrontX: 27, legFrontY: 36, legBackX: -20, legBackY: 42, bendFront: 0.08, bendBack: 0.2,
  };
  const guardPose: Pose = { ...STAND, bodyLean: 0.05, armFrontX: 8, armFrontY: 18, armBackX: -6, armBackY: 22 };
  if (t < drawEnd) return blend(STAND, drawPose, t / drawEnd);
  if (t < thrustEnd) return blend(drawPose, thrustPose, (t - drawEnd) / (thrustEnd - drawEnd));
  if (t < holdEnd) return thrustPose;
  return blend(thrustPose, guardPose, Math.min(1, (t - holdEnd) / (totalEnd - holdEnd)));
}

// Bow: raise -> draw the string back to the shoulder (the back "string"
// hand pulls in while the bow arm stays extended) -> a held beat at full
// draw -> release, where the string hand snaps forward. drawWeaponInHand
// mirrors these exact phase boundaries to actually animate the string
// itself, so the two stay in lockstep.
function computeBowShot(t: number): Pose {
  const raiseEnd = 0.12;
  const drawEnd = 0.32;
  const releaseEnd = 0.4;
  const totalEnd = 0.6;
  const raisePose: Pose = { ...STAND, bodyLean: 0.04, armFrontX: 23, armFrontY: -1, armBackX: 6, armBackY: 12 };
  const drawnPose: Pose = { ...STAND, bodyLean: 0.08, armFrontX: 26, armFrontY: -3, armBackX: -15, armBackY: 6 };
  const releasePose: Pose = { ...STAND, bodyLean: 0.1, armFrontX: 24, armFrontY: -1, armBackX: 12, armBackY: 15 };
  const guardPose: Pose = { ...STAND, bodyLean: 0.05, armFrontX: 10, armFrontY: 20, armBackX: -8, armBackY: 24 };
  if (t < raiseEnd) return blend(STAND, raisePose, t / raiseEnd);
  if (t < drawEnd) return blend(raisePose, drawnPose, (t - raiseEnd) / (drawEnd - raiseEnd));
  if (t < releaseEnd) return blend(drawnPose, releasePose, (t - drawEnd) / (releaseEnd - drawEnd));
  return blend(releasePose, guardPose, Math.min(1, (t - releaseEnd) / (totalEnd - releaseEnd)));
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

// ---------------------------------------------------------------------
// Section (character-quality overhaul): shared filled-shape primitives.
// The rig used to be pure thin strokes (a literal stick figure) — arms
// and legs were single straight lines with no joints, hands were nothing
// but the end of a line (a circle only appeared for the glove/boxing-
// glove accessory), and every character's feet were either invisible or
// one plain oval. None of that changes computePose/smoothPose/the ground
// -anchoring math above — this only changes how the *same* pose numbers
// get drawn, so every existing animation keeps its exact timing/shape.
// ---------------------------------------------------------------------

/** Elbow/knee position: not true inverse kinematics, just a fixed
 * fraction of the limb's own length offset perpendicular to the
 * shoulder/hip -> hand/foot line, with a constant per-limb sign so the
 * joint always bends the same anatomically-plausible way in every pose
 * instead of flipping unpredictably. */
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

/** A full two-segment limb (upper + lower, rounded joint) from a fixed
 * start point to the pose-driven end point. Returns the joint position
 * (used to anchor sleeve/armor detail) and the end-point direction (used
 * to orient the hand/shoe drawn at the tip). */
function drawLimb(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number,
  wNear: number, wFar: number, bendFrac: number, sign: 1 | -1, color: string,
): { jointX: number; jointY: number; dirX: number; dirY: number } {
  const j = bentJoint(x1, y1, x2, y2, bendFrac, sign);
  const wMid = (wNear + wFar) / 2;
  drawTaperedSegment(ctx, x1, y1, j.x, j.y, wNear, wMid, color);
  drawTaperedSegment(ctx, j.x, j.y, x2, y2, wMid, wFar, color);
  return { jointX: j.x, jointY: j.y, dirX: x2 - j.x, dirY: y2 - j.y };
}

// A friendly off-white cartoon "glove" hand — reads clearly as a hand
// against any body/limb color instead of fighting with each character's
// own palette (classic cartoon device: dark silhouette body, pale hands).
const HAND_COLOR = '#f7ede1';

/** A simplified cartoon hand: a rounded mitt plus a couple of finger
 * creases — per the brief, "vereinfachte Cartoon-Finger sind vollkommen
 * ausreichend." Oriented along the forearm so it reads as actually
 * attached, and weapons are drawn on top of this same anchor point so
 * they read as gripped rather than floating beside the arm. */
function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number, dirX: number, dirY: number, big: boolean, color = HAND_COLOR): void {
  const angle = Math.atan2(dirY, dirX);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const r = big ? 7.5 : 5;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(r * 0.15, 0, r * 1.05, r * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(r * 0.5, -r * 0.55);
  ctx.lineTo(r * 1.15, -r * 0.42);
  ctx.moveTo(r * 0.6, r * 0.02);
  ctx.lineTo(r * 1.25, r * 0.05);
  ctx.moveTo(r * 0.5, r * 0.55);
  ctx.lineTo(r * 1.1, r * 0.48);
  ctx.stroke();
  ctx.restore();
}

export type ShoeStyle = 'player' | 'default' | 'big' | 'boot' | 'ninja' | 'armored' | 'claw' | 'metal' | 'none';

/** A per-character shoe silhouette (toe/heel/sole) instead of the old
 * plain oval — `tiltAngle` is derived from the foot's own horizontal
 * offset so a forward-swung foot (running/kicking) visibly tilts, but
 * the shoe never inherits the leg's own steep near-vertical angle. */
function drawShoe(ctx: CanvasRenderingContext2D, x: number, y: number, tiltAngle: number, style: ShoeStyle): void {
  if (style === 'none') return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tiltAngle);
  ctx.lineJoin = 'round';
  switch (style) {
    case 'player': {
      ctx.fillStyle = '#fafafa';
      ctx.strokeStyle = '#bdbdbd';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-6, -6);
      ctx.lineTo(2, -6.5);
      ctx.quadraticCurveTo(11, -5, 12, 1.5);
      ctx.quadraticCurveTo(10, 5.5, -1, 5);
      ctx.lineTo(-6, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-3, -2);
      ctx.quadraticCurveTo(4, -1, 8, 1.5);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-6, 5);
      ctx.lineTo(11, 3.8);
      ctx.stroke();
      break;
    }
    case 'big': {
      ctx.fillStyle = '#fdd835';
      ctx.strokeStyle = '#c9a800';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-9, -5);
      ctx.lineTo(4, -6);
      ctx.quadraticCurveTo(20, -4, 21, 3);
      ctx.quadraticCurveTo(20, 8, 6, 7);
      ctx.lineTo(-9, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-4, 6.5);
      ctx.lineTo(-4, 8.5);
      ctx.moveTo(1, 7);
      ctx.lineTo(1, 9);
      ctx.stroke();
      break;
    }
    case 'boot': {
      ctx.fillStyle = '#5d4037';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-6, -9);
      ctx.lineTo(3, -9);
      ctx.lineTo(4, 2);
      ctx.quadraticCurveTo(13, 1, 14, 5);
      ctx.quadraticCurveTo(13, 8, 2, 7.5);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'ninja': {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.moveTo(-5, -3);
      ctx.lineTo(2, -4);
      ctx.quadraticCurveTo(11, -3, 12, 2);
      ctx.quadraticCurveTo(10, 5, 0, 4.5);
      ctx.lineTo(-5, 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'armored': {
      ctx.fillStyle = '#78909c';
      ctx.strokeStyle = '#37474f';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-6, -7);
      ctx.lineTo(3, -7);
      ctx.lineTo(4, 1);
      ctx.lineTo(15, 3);
      ctx.lineTo(13, 7);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-3, -2);
      ctx.lineTo(6, -1);
      ctx.stroke();
      break;
    }
    case 'claw': {
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(-6, 6);
      ctx.moveTo(0, 0); ctx.lineTo(0, 8);
      ctx.moveTo(0, 0); ctx.lineTo(7, 6);
      ctx.stroke();
      break;
    }
    case 'metal': {
      ctx.fillStyle = '#607d8b';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(-7, -6, 20, 11, 3);
      ctx.fill();
      ctx.stroke();
      break;
    }
    default: {
      ctx.fillStyle = '#3a3a3a';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-6, -6);
      ctx.lineTo(2, -6);
      ctx.quadraticCurveTo(10, -5, 11, 1);
      ctx.quadraticCurveTo(9, 5, -1, 4.5);
      ctx.lineTo(-6, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-6, 4.5);
      ctx.lineTo(10, 3.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function resolveShoeStyle(f: Fighter): ShoeStyle {
  const has = (id: string) => f.accessories.includes(id);
  if (f.kind === 'player') return 'player';
  if (has('clownShoes') || has('bigShoes')) return 'big';
  if (has('chickenBeak')) return 'claw';
  if (has('ninjaMask')) return 'ninja';
  if (has('heavyArmor') || has('shield')) return 'armored';
  return 'default';
}

function footTiltAngle(dx: number, dy: number): number {
  return Math.atan2(dx, Math.abs(dy) + 0.001) * 0.5;
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

  // Character-system overhaul: the four playable heroes share this exact
  // rig/animation — only proportions and palette differ. Everyone else
  // (normal enemies, bosses render through renderBoss.ts) uses the
  // original slim proportions untouched.
  const charDef = f.kind === 'player' ? CHARACTERS[f.characterId] : null;
  const bw = charDef?.build === 'heavy' ? 1.55 : 1; // body-width multiplier
  const headMult = charDef?.build === 'heavy' ? 1.22 : 1;

  const headR = 12 * headMult;
  const hipY = -f.height * 0.45 + pose.hipY;
  const shoulderY = -f.height * 0.78;
  const headY = shoulderY - headR - 2 + pose.headOffsetY;
  const headX = pose.headOffsetX;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Cape (drawn behind body).
  drawCape(ctx, f, shoulderY, pose, dtSec);

  // Legs — filled, tapered, jointed at the knee, each ending in a real
  // shoe silhouette instead of a bare line-end or a plain oval. Knee bend
  // now comes from the pose itself (deeper mid-stride) instead of one
  // fixed constant for every pose.
  const shoeStyle = resolveShoeStyle(f);
  drawLimb(ctx, 0, hipY, pose.legBackX, hipY + pose.legBackY, 7.5 * bw, 5.5 * bw, pose.bendBack, -1, f.color);
  drawShoe(ctx, pose.legBackX, hipY + pose.legBackY, footTiltAngle(pose.legBackX, pose.legBackY), shoeStyle);
  drawLimb(ctx, 0, hipY, pose.legFrontX, hipY + pose.legFrontY, 7.5 * bw, 5.5 * bw, pose.bendFront, -1, f.color);
  drawShoe(ctx, pose.legFrontX, hipY + pose.legFrontY, footTiltAngle(pose.legFrontX, pose.legFrontY), shoeStyle);

  // Torso — tapered slightly wider at the shoulders than the hips for a
  // heroic cartoon silhouette instead of a uniform-width wire.
  const shoulderX = Math.sin(pose.bodyLean) * 10;
  drawTaperedSegment(ctx, 0, hipY, shoulderX, shoulderY, 13 * bw, 16 * bw, f.color);

  // Diaper (Windelmann only) at hip.
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

  if (charDef) drawPlayerClothing(ctx, charDef, shoulderX, shoulderY, hipY, bw);
  drawBodyAccessories(ctx, f, shoulderX, shoulderY, hipY);

  // Back arm (behind torso).
  drawArm(ctx, shoulderX, shoulderY, pose.armBackX, pose.armBackY, f, false, pose.bendBack, bw);

  // Head.
  ctx.beginPath();
  ctx.fillStyle = f.color;
  ctx.arc(shoulderX + headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  if (charDef) drawPlayerHair(ctx, charDef, shoulderX + headX, headY, headR, f.animTimeMs);
  drawHeadAccessories(ctx, f, shoulderX + headX, headY, headR);
  drawFace(ctx, f, shoulderX + headX, headY, headR, pose, dtSec);
  if (charDef) drawPlayerFaceExtras(ctx, charDef, shoulderX + headX, headY, headR, f.animTimeMs);

  // Front arm (in front of torso, holds weapon).
  drawArm(ctx, shoulderX, shoulderY, pose.armFrontX, pose.armFrontY, f, true, pose.bendFront, bw);
  drawWeaponInHand(ctx, f, shoulderX + pose.armFrontX, shoulderY + pose.armFrontY, pose.armFrontX, pose.armFrontY);

  drawExtraAccessories(ctx, f, hipY);
  drawStatusOverlay(ctx, f, shoulderY, hipY);

  ctx.restore();
}

function drawArm(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, dx: number, dy: number, f: Fighter, front: boolean,
  bend = 0.15, widthMult = 1,
): void {
  const isGlove = f.accessories.includes('gloves') || f.accessories.includes('boxingGloves');
  const limb = drawLimb(ctx, sx, sy, sx + dx, sy + dy, 6 * widthMult, 4.5 * widthMult, bend, 1, f.color);
  if (isGlove) {
    ctx.save();
    ctx.fillStyle = '#c0392b';
    ctx.strokeStyle = '#8e2318';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx + dx, sy + dy, front ? 7.5 : 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else {
    drawHand(ctx, sx + dx, sy + dy, limb.dirX, limb.dirY, false);
  }
  if (front && f.weaponFlashMs > 0) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx + dx, sy + dy, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// Section (polish pass): weapons used to render as one undifferentiated
// line (plus a circle for the frypan) at a fixed angle unrelated to the
// arm — every weapon looked the same and could visibly clip through the
// arm whenever the arm pose changed. Each weapon now gets its own
// recognizable silhouette, drawn rotated to the actual shoulder->hand
// direction so it always extends naturally out of the hand instead of
// crossing the arm at an arbitrary angle.
export function drawWeaponInHand(ctx: CanvasRenderingContext2D, f: Fighter, handX: number, handY: number, armDx: number, armDy: number): void {
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
      // Section (quality pass): the spear used to just inherit the same
      // shallow downward angle as every other weapon (the idle arm's own
      // resting direction), which for a ~70-unit-long shaft read as a limp
      // dangle down past the leg rather than something actually held. Only
      // the thrust (the 'attack' pose, whose arm already swings to a
      // natural forward-thrust angle) keeps the arm's own direction; at
      // rest it's carried near-vertical, tip up, the way a spear actually
      // is — anchored at the same hand position either way, so the grip
      // never floats free of the hand.
      ctx.save();
      if (f.anim !== 'attack') {
        ctx.rotate(-1.15 - angle);
      }
      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(44, 0);
      ctx.stroke();
      // Hand-grip band: the hand visibly wraps the shaft instead of the
      // shaft merely passing behind an otherwise-empty hand.
      ctx.strokeStyle = '#3a2a18';
      ctx.lineWidth = 6.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(6, 0);
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
      ctx.restore();
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
      // Weapon-quality pass: the string now genuinely moves — pulled back
      // through the attack's draw phase, held at full draw, then snapping
      // forward again on release — with a nocked arrow visible while
      // drawn, instead of a permanently flat string.
      const bowRadius = 20;
      const topAngle = Math.PI * 0.62;
      const botAngle = Math.PI * 1.38;
      const topX = 4 + Math.cos(topAngle) * bowRadius;
      const topY = Math.sin(topAngle) * bowRadius;
      const botX = 4 + Math.cos(botAngle) * bowRadius;
      const botY = Math.sin(botAngle) * bowRadius;

      let pull = 0;
      if (f.anim === 'attack') {
        const at = f.animTimeMs / 1000;
        const raiseEnd = 0.12;
        const drawEnd = 0.32;
        const releaseEnd = 0.4;
        if (at < raiseEnd) pull = 0;
        else if (at < drawEnd) pull = (at - raiseEnd) / (drawEnd - raiseEnd);
        else if (at < releaseEnd) pull = Math.max(0, 1 - (at - drawEnd) / (releaseEnd - drawEnd));
        else pull = 0;
      }
      const stringMidX = -pull * 16;

      ctx.strokeStyle = weapon.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(4, 0, bowRadius, topAngle, botAngle);
      ctx.stroke();
      ctx.strokeStyle = weapon.trailColor ?? '#f1c40f';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(stringMidX, 0);
      ctx.lineTo(botX, botY);
      ctx.stroke();
      if (pull > 0.05) {
        ctx.strokeStyle = '#6d4c2f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(stringMidX, 0);
        ctx.lineTo(stringMidX + 26, 0);
        ctx.stroke();
        ctx.fillStyle = '#9e9e9e';
        ctx.beginPath();
        ctx.moveTo(stringMidX + 26, 0);
        ctx.lineTo(stringMidX + 20, -3);
        ctx.lineTo(stringMidX + 20, 3);
        ctx.closePath();
        ctx.fill();
      }
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

interface CapeState { angle: number; angVel: number; }
const capeStateCache = new WeakMap<Fighter, CapeState>();

// Section (character-quality overhaul): the cape used to be a fixed sine
// wave plus a flat "is it running, yes/no" flare — it swung the same way
// whether the character had just started sprinting or had been standing
// still for ten seconds, and stopping snapped it back with no follow-
// through. This is a small spring/lag simulation instead: the cape eases
// toward a target lean (a gentle idle wind + how fast the body is
// actually moving in its own facing direction + a touch of lift while
// airborne) and — because it's a real spring, not an interpolation —
// naturally overshoots and settles when that target changes abruptly
// (stopping, landing, a knockback), which is exactly the "kurz
// nachschwingen" the brief asks for, for free.
function updateCapePhysics(f: Fighter, dtSec: number): CapeState {
  let s = capeStateCache.get(f);
  if (!s) {
    s = { angle: 0, angVel: 0 };
    capeStateCache.set(f, s);
  }
  if (dtSec <= 0 || dtSec > 0.5) return s;
  const t = f.animTimeMs / 1000;
  // Character-quality overhaul pass 2: the same rare-gust rhythm the
  // meadow grass sways on also gives the cape (and hair, see
  // drawPlayerHair) an occasional stronger flutter — one shared "wind"
  // moment across the whole scene rather than the cape's own private sway.
  const gust = windGust(performance.now() / 1000);
  const idleWind = Math.sin(t * 2.1 + f.body.pos.x * 0.01) * (0.15 + gust * 0.35);
  const localFwdSpeed = f.body.vel.x * f.facing;
  const speedFlare = Math.max(-0.3, Math.min(1.2, localFwdSpeed * 0.0022));
  const airLift = f.body.grounded ? 0 : 0.35;
  const target = idleWind + speedFlare + airLift;
  const stiffness = 70;
  const damping = 8.5;
  const accel = (target - s.angle) * stiffness - s.angVel * damping;
  s.angVel += accel * dtSec;
  s.angle += s.angVel * dtSec;
  return s;
}

function drawCape(ctx: CanvasRenderingContext2D, f: Fighter, shoulderY: number, pose: Pose, dtSec: number): void {
  if (!f.accessories.includes('cape') && !f.accessories.includes('fancyCape')) return;
  const spring = updateCapePhysics(f, dtSec);
  const sway = spring.angle * 14;
  // The fart/superpower pose's own deliberate rear-facing flare stays a
  // direct pose-driven kick rather than routed through the spring — it
  // needs to reliably read every time regardless of the body's velocity.
  const kick = pose.capeKick * 40;
  const flare = kick;

  // Character-system overhaul: a player's cape is a cosmetic color choice
  // (see MEIN CHARAKTER / CAPE_COLORS) rather than one fixed red — enemies/
  // bosses with the plain 'cape'/'fancyCape' accessory keep their original
  // fixed colors untouched.
  const capePlayerColors = f.kind === 'player' ? CAPE_COLORS[f.capeColorId] : null;
  const primary = capePlayerColors?.primary ?? (f.accessories.includes('fancyCape') ? '#8e24aa' : '#c0392b');
  const secondary = capePlayerColors?.secondary ?? (f.accessories.includes('fancyCape') ? '#6a1b9a' : '#8e2318');

  ctx.save();
  ctx.fillStyle = primary;
  ctx.strokeStyle = secondary;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-4, shoulderY + 2);
  ctx.lineTo(4, shoulderY + 2);
  ctx.quadraticCurveTo(-10 - sway - flare, shoulderY + 30 - kick * 0.6, -14 - sway * 1.5 - flare, shoulderY + 62 - kick);
  ctx.quadraticCurveTo(-2 - sway, shoulderY + 45, -4, shoulderY + 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------
// Character-system overhaul: per-hero clothing, hair and small face
// accessories (glasses/mustache) — layered onto the shared rig above so
// all four heroes are drawn by the exact same pose/animation code, only
// differing in these cosmetic passes plus the proportion multipliers
// already applied to the limb/torso widths above.
// ---------------------------------------------------------------------

/** A simple torso garment patch per hero, drawn over the plain silhouette
 * torso — visible "Kleidung" without needing a whole separate clothing
 * rig. Windelmann stays bare-chested (his diaper + cape are already his
 * whole costume); the other three each get a distinct, readable garment. */
function drawPlayerClothing(ctx: CanvasRenderingContext2D, def: CharacterDef, shoulderX: number, shoulderY: number, hipY: number, bw: number): void {
  ctx.save();
  switch (def.id) {
    case 'grandpa': {
      // A buttoned shirt with crossed suspenders over it.
      ctx.fillStyle = def.clothColor;
      ctx.beginPath();
      ctx.moveTo(shoulderX - 11 * bw, shoulderY + 4);
      ctx.lineTo(shoulderX + 11 * bw, shoulderY + 4);
      ctx.lineTo(shoulderX + 8 * bw, hipY - 2);
      ctx.lineTo(shoulderX - 8 * bw, hipY - 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = def.clothColor2;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(shoulderX - 8 * bw, shoulderY + 5);
      ctx.lineTo(shoulderX + 4 * bw, hipY - 3);
      ctx.moveTo(shoulderX + 8 * bw, shoulderY + 5);
      ctx.lineTo(shoulderX - 4 * bw, hipY - 3);
      ctx.stroke();
      ctx.fillStyle = '#ffd54f';
      for (const by of [shoulderY + 12, shoulderY + 22]) {
        ctx.beginPath();
        ctx.arc(shoulderX + 1, by, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'punk': {
      // An open jacket: dark leather patch with a bright zipper line and a
      // couple of studs, popped collar at the shoulders.
      ctx.fillStyle = def.clothColor;
      ctx.beginPath();
      ctx.moveTo(shoulderX - 12 * bw, shoulderY + 2);
      ctx.lineTo(shoulderX + 12 * bw, shoulderY + 2);
      ctx.lineTo(shoulderX + 9 * bw, hipY);
      ctx.lineTo(shoulderX - 9 * bw, hipY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = def.clothColor2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY + 5);
      ctx.lineTo(shoulderX, hipY - 1);
      ctx.stroke();
      ctx.fillStyle = '#bdbdbd';
      for (const by of [shoulderY + 9, shoulderY + 17, shoulderY + 25]) {
        ctx.beginPath();
        ctx.arc(shoulderX - 7 * bw, by, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Popped collar.
      ctx.fillStyle = def.clothColor;
      ctx.beginPath();
      ctx.moveTo(shoulderX - 10 * bw, shoulderY + 1);
      ctx.lineTo(shoulderX - 4, shoulderY - 6);
      ctx.lineTo(shoulderX - 2, shoulderY + 4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(shoulderX + 10 * bw, shoulderY + 1);
      ctx.lineTo(shoulderX + 4, shoulderY - 6);
      ctx.lineTo(shoulderX + 2, shoulderY + 4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'brawler': {
      // Snug overalls with one big front pocket and shoulder straps, sized
      // up with the character's own wider proportions.
      ctx.fillStyle = def.clothColor;
      ctx.beginPath();
      ctx.moveTo(shoulderX - 13 * bw, shoulderY + 8);
      ctx.lineTo(shoulderX + 13 * bw, shoulderY + 8);
      ctx.lineTo(shoulderX + 11 * bw, hipY + 2);
      ctx.lineTo(shoulderX - 11 * bw, hipY + 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = def.clothColor2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(shoulderX - 7 * bw, shoulderY + 8);
      ctx.lineTo(shoulderX - 7 * bw, shoulderY - 4);
      ctx.moveTo(shoulderX + 7 * bw, shoulderY + 8);
      ctx.lineTo(shoulderX + 7 * bw, shoulderY - 4);
      ctx.stroke();
      ctx.fillStyle = def.clothColor2;
      ctx.beginPath();
      ctx.roundRect(shoulderX - 6 * bw, (shoulderY + hipY) / 2, 12 * bw, 9, 2);
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** A real drawn hairstyle per hero instead of a color-blob — always
 * drawn immediately after the plain head fill and before drawFace/
 * drawHeadAccessories, so it frames the head (crown/sides/back) without
 * ever covering the eyes or mouth (drawFace is always the last thing
 * drawn on top, per the section above this fixed for Windelmann). */
function drawPlayerHair(ctx: CanvasRenderingContext2D, def: CharacterDef, hx: number, hy: number, r: number, animTimeMs: number): void {
  const t = animTimeMs / 1000;
  const gust = windGust(performance.now() / 1000);
  const jitter = Math.sin(t * 6) * 0.06 + gust * 0.22; // a little life during movement, plus the shared wind gust
  ctx.save();
  ctx.fillStyle = def.hairColor;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.8;
  switch (def.id) {
    case 'windelmann': {
      // A short, cheeky tuft of spikes on top.
      for (const [dx, h] of [[-0.35, 0.5], [0, 0.68], [0.4, 0.48]] as const) {
        ctx.beginPath();
        ctx.moveTo(hx + r * (dx - 0.16), hy - r * 0.78);
        ctx.lineTo(hx + r * dx + r * jitter, hy - r * (0.78 + h));
        ctx.lineTo(hx + r * (dx + 0.16), hy - r * 0.78);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'grandpa': {
      // Bald on top — just soft grey tufts above the ears and around the
      // back of the head, never touching the crown/face region.
      ctx.beginPath();
      ctx.ellipse(hx - r * 0.85, hy + r * 0.05, r * 0.4, r * 0.32, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx + r * 0.55, hy + r * 0.55, r * 0.55, r * 0.32, -0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'punk': {
      // A tall, jagged mohawk strip running front-to-back along the crown.
      const spikes = 5;
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.55, hy - r * 0.7);
      for (let i = 0; i <= spikes; i++) {
        const p = i / spikes;
        const px = hx + lerp(-r * 0.55, r * 0.75, p);
        const spikeH = r * (0.85 + (i % 2 === 0 ? 0.35 : 0) + jitter);
        ctx.lineTo(px, hy - r * 0.7 - spikeH);
        ctx.lineTo(px + r * 0.12, hy - r * 0.7);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'brawler': {
      // A broad, rounded flat-top — reads as a big, distinct head shape
      // rather than more spikes, matching his heavier proportions.
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.95, hy - r * 0.55);
      ctx.lineTo(hx - r * 0.85, hy - r * 1.15);
      ctx.lineTo(hx + r * 0.85, hy - r * 1.15);
      ctx.lineTo(hx + r * 0.95, hy - r * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** Small per-hero face accessories drawn on top of drawFace (so glasses
 * sit correctly over already-visible eyes rather than hiding them, and a
 * mustache sits over an already-drawn mouth). */
function drawPlayerFaceExtras(ctx: CanvasRenderingContext2D, def: CharacterDef, hx: number, hy: number, r: number, animTimeMs: number): void {
  if (def.id !== 'grandpa') return;
  const t = animTimeMs / 1000;
  // Occasional "richtet Brille" nudge — a tiny vertical bob every few
  // seconds, purely cosmetic idle flavor.
  const nudge = Math.max(0, Math.sin(t * 0.7)) > 0.97 ? -0.6 : 0;
  ctx.save();
  // Round spectacles over both eyes.
  ctx.strokeStyle = '#3e2723';
  ctx.lineWidth = 1.3;
  const backX = hx - r * 0.05;
  const frontX = hx + r * 0.55;
  const eyeY = hy - r * 0.08 + nudge;
  ctx.beginPath();
  ctx.arc(backX, eyeY, r * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(frontX, eyeY, r * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(backX + r * 0.3, eyeY);
  ctx.lineTo(frontX - r * 0.32, eyeY);
  ctx.stroke();
  // Bushy mustache under the nose.
  ctx.fillStyle = '#e0e0e0';
  ctx.beginPath();
  ctx.moveTo(hx - r * 0.05, hy + r * 0.32);
  ctx.quadraticCurveTo(hx + r * 0.25, hy + r * 0.18, hx + r * 0.6, hy + r * 0.34);
  ctx.quadraticCurveTo(hx + r * 0.28, hy + r * 0.5, hx - r * 0.05, hy + r * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Section (quality pass): root-cause fix, not another eye bolted on top.
// The previous code gated drawing on `!pose.turnedAway`, but pose.turnedAway
// is a smoothed *number* (0..1), not a boolean — after any fart/superpower
// (the only anim that ever sets it above 0) the pose-smoothing lerp decays
// it toward 0 asymptotically, so it lingers as a tiny non-zero float for a
// beat afterwards. `!0.003` is `false`, so the eyes silently stayed hidden
// for a stretch after every single superpower use. A proper threshold
// (mid-turn or further) fixes that outright. The head also now gets two
// eyes — a near one at full size/contrast and a smaller far one peeking
// past the head silhouette, the classic cartoon-profile way of reading as
// "two eyes" without pretending the figure is drawn front-on — plus a
// friendly mouth, so the face reads correctly in every pose except the
// ones that actually mean to hide it (turning away to fart).
// Section (character-quality overhaul): mimicry pass. Characters used to
// stand around with one unchanging smiling face regardless of what was
// actually happening to them. This adds a lightweight per-fighter blink
// timer (a real closed-eye beat every few seconds, not decoration), a
// small idle eye-wander so the gaze isn't a dead stare, and an expression
// (brows + mouth shape) derived from the current anim + health fraction —
// determined while attacking, shocked when hit, worried at low health,
// a mischievous grin during the superpower announce. None of this touches
// the *eyes themselves staying correctly positioned/visible* fix below
// (still gated on the same pose.turnedAway threshold) — it only adds
// expression on top of eyes that were already root-cause-fixed to work.
interface FaceState {
  nextBlinkAt: number;
  blinkT: number;
  wanderPhase: number;
}
const faceStateCache = new WeakMap<Fighter, FaceState>();

function updateFaceState(f: Fighter, dtSec: number): FaceState {
  let s = faceStateCache.get(f);
  if (!s) {
    s = { nextBlinkAt: 1.2 + Math.random() * 3, blinkT: 0, wanderPhase: Math.random() * Math.PI * 2 };
    faceStateCache.set(f, s);
  }
  if (dtSec > 0 && dtSec < 0.5) {
    if (s.blinkT > 0) {
      s.blinkT -= dtSec;
    } else {
      s.nextBlinkAt -= dtSec;
      if (s.nextBlinkAt <= 0) {
        s.blinkT = 0.12;
        s.nextBlinkAt = 2.2 + Math.random() * 3.2;
      }
    }
  }
  return s;
}

type MouthShape = 'smile' | 'firm' | 'o' | 'worried' | 'grin';

interface Expression {
  browAngle: number; // 0 = relaxed; magnitude/sign shapes a "^" (determined/shocked) or softened brow
  browRaise: number; // 0..1 extra lift, e.g. surprise
  mouth: MouthShape;
  eyeWiden: number; // 0..1 extra eye-white scale (shock)
  lookY: number; // -1..1 extra pupil vertical offset (negative = look up)
}

/** One state per anim (plus a low-health override for the otherwise-
 * neutral states) — matches the brief's list: idle/neutral, attack
 * (concentrated), hit (shocked), low health (worried), superpower
 * (confident/mischievous), taunt (laughing). Victory/defeat read through
 * the existing 'taunt'/'fallen'/'dead' anims rather than new ones, so no
 * gameplay state machine changes are needed. */
function computeExpression(f: Fighter): Expression {
  switch (f.anim) {
    case 'attack':
    case 'kick':
      return { browAngle: 0.4, browRaise: 0, mouth: 'firm', eyeWiden: 0, lookY: 0 };
    case 'block':
      return { browAngle: 0.22, browRaise: 0, mouth: 'firm', eyeWiden: 0, lookY: 0 };
    case 'hit':
    case 'stagger':
    case 'knockback':
      return { browAngle: -0.35, browRaise: 0.8, mouth: 'o', eyeWiden: 0.6, lookY: 0 };
    case 'surprised':
      return { browAngle: -0.45, browRaise: 1, mouth: 'o', eyeWiden: 0.9, lookY: -0.7 };
    case 'dazed':
      return { browAngle: -0.25, browRaise: 0.5, mouth: 'worried', eyeWiden: 0.25, lookY: -0.3 };
    case 'fart':
    case 'superpower':
      return { browAngle: 0.18, browRaise: 0.2, mouth: 'grin', eyeWiden: 0, lookY: 0 };
    case 'taunt':
      return { browAngle: 0.12, browRaise: 0.15, mouth: 'grin', eyeWiden: 0, lookY: 0 };
    case 'fallen':
    case 'gettingUp':
    case 'dead':
    case 'bossDeath':
      return { browAngle: -0.2, browRaise: 0, mouth: 'worried', eyeWiden: 0, lookY: 0 };
    default: {
      const lowHealth = f.maxHealth > 0 && f.health / f.maxHealth < 0.25;
      if (lowHealth) return { browAngle: -0.16, browRaise: 0.15, mouth: 'worried', eyeWiden: 0.1, lookY: 0 };
      return { browAngle: 0, browRaise: 0, mouth: 'smile', eyeWiden: 0, lookY: 0 };
    }
  }
}

function drawFace(ctx: CanvasRenderingContext2D, f: Fighter, hx: number, hy: number, r: number, pose: Pose, dtSec: number): void {
  if (pose.turnedAway > 0.5) return;
  // Fade the face out smoothly right around the turn instead of an abrupt
  // pop, since turnedAway itself now animates continuously through the
  // fart wind-up/return beats.
  const faceAlpha = 1 - Math.max(0, (pose.turnedAway - 0.3) / 0.2);
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, faceAlpha));

  const state = updateFaceState(f, dtSec);
  const expr = computeExpression(f);
  const t = f.animTimeMs / 1000;
  const closed = state.blinkT > 0;

  // Two genuinely separate eyes (not two overlapping circles that just
  // blur into one blob at small render scale) — a back eye and a front
  // eye, spaced clearly apart along the head, both looking the same
  // direction. Front one is drawn slightly bigger/higher-contrast since
  // it's closer to camera; back one is still fully sized and legible on
  // its own, not a token afterthought.
  const backX = hx - r * 0.05;
  const frontX = hx + r * 0.55;
  const eyeY = hy - r * 0.08;
  // Gentle idle look-around wander, replaced by a fixed forward-locked
  // gaze the instant there's something to actually focus on.
  const wander = f.anim === 'idle' ? Math.sin(t * 0.6 + state.wanderPhase) * 0.2 : 0;
  const lookX = (expr.mouth === 'firm' ? 0.5 : 0.35) + wander;

  for (const [ex, radius, pupilR] of [[backX, 3.0, 1.4], [frontX, 3.6, 1.7]] as const) {
    if (closed) {
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - radius, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + radius * 0.5, ex + radius, eyeY);
      ctx.stroke();
      continue;
    }
    const widen = radius * (1 + expr.eyeWiden * 0.4);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(ex, eyeY, widen, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(ex + radius * lookX, eyeY + expr.lookY * radius * 0.3, pupilR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Brows — short angled strokes above each eye, only drawn when the
  // expression actually calls for them (a relaxed idle face stays clean).
  if (!closed && (expr.browAngle !== 0 || expr.browRaise > 0)) {
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const [ex, sign] of [[backX, -1], [frontX, 1]] as const) {
      const by = eyeY - r * (0.32 + expr.browRaise * 0.12);
      const tilt = expr.browAngle * sign * r * 0.12;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.16, by + tilt);
      ctx.lineTo(ex + r * 0.16, by - tilt);
      ctx.stroke();
    }
  }

  // Mouth — shape driven by the current expression instead of one fixed
  // friendly arc for every situation.
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  switch (expr.mouth) {
    case 'o':
      ctx.fillStyle = '#6d3b2a';
      ctx.arc(hx + 3, hy + 7, 2.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'firm':
      ctx.moveTo(hx - 1, hy + 7);
      ctx.lineTo(hx + 7, hy + 6.5);
      ctx.stroke();
      break;
    case 'worried':
      ctx.arc(hx + 3, hy + 10, 4, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
      break;
    case 'grin':
      ctx.arc(hx + 3, hy + 5.5, 5.5, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
      break;
    default:
      ctx.arc(hx + 3, hy + 6, 4.5, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
  }
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

// Section (character-quality overhaul): shoes are now drawn inline with
// the legs in renderFighter() via drawShoe/resolveShoeStyle above — this
// only handles the remaining non-foot equipment accessory (a shield worn
// on the back arm's side).
function drawExtraAccessories(ctx: CanvasRenderingContext2D, f: Fighter, hipY: number): void {
  if (!f.accessories.includes('shield')) return;
  ctx.save();
  ctx.fillStyle = '#607d8b';
  ctx.strokeStyle = '#37474f';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(-16, hipY - 20, 8, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Section (polish pass): superpowers already apply their slow/freeze/
// stun/dot debuffs to `f.status` (unchanged — see GameEngine.fireSuperpower
// and Fighter.applySlow/applyFreeze/applyStun/applyDot); this only reads
// that existing state to draw a matching visual cue, so an enemy hit by
// ice/gas/electro/chili visibly reads as frozen/slowed/stunned/burning for
// as long as the (already-tuned) effect actually lasts — no new numbers,
// purely a readability pass on effects that already work.
// Humorous effects pass: classic cartoon "seeing birds" gag — 3 small
// bird silhouettes (simple flapping "M" wings) circling above the head on
// a tilted orbit while dazed. Shared shape used by renderFighter and (a
// duplicate, matching the file's own no-shared-code convention) renderBoss.
function drawCirclingBirds(ctx: CanvasRenderingContext2D, f: Fighter, shoulderY: number): void {
  const t = f.animTimeMs / 1000;
  // Section (character-quality overhaul): orbits a bit higher/wider than
  // before so the birds read as clearly separate from the new worried-
  // expression eyebrows drawn just above the eyes in the same head-top
  // region, instead of visually blending into them.
  const orbitY = shoulderY - 36;
  ctx.save();
  ctx.strokeStyle = '#3e2723';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = t * 4.2 + (i / 3) * Math.PI * 2;
    const bx = Math.cos(a) * 15;
    const by = orbitY + Math.sin(a) * 4.5;
    const flap = Math.sin(t * 18 + i * 2) * 3.5;
    ctx.beginPath();
    ctx.moveTo(bx - 5, by - flap);
    ctx.quadraticCurveTo(bx - 2, by - 1.5, bx, by);
    ctx.quadraticCurveTo(bx + 2, by - 1.5, bx + 5, by - flap);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStatusOverlay(ctx: CanvasRenderingContext2D, f: Fighter, shoulderY: number, hipY: number): void {
  const s = f.status;
  const t = f.animTimeMs / 1000;
  if (f.dazedUntilMs > 0) {
    drawCirclingBirds(ctx, f, shoulderY);
  } else if (s.frozenUntilMs > 0) {
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

