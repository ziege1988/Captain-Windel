import type { Fighter } from '../entities/Fighter';
import { floorY } from '../physics/physics';
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
  turnFlip: number; // 0..1, 1 = fully turned to face away from the camera (fart/chili/ice pose) — drives an actual mirror-flip in renderFighter, not just a face fade
  // Movement-quality pass 3 (root-cause fix): the shoulder anchor used to be
  // a fixed height no pose could ever move, so any pose that lowered the
  // hip (a crouch/bend) stretched the torso segment longer instead of the
  // whole upper body sinking with it. This offsets the shoulder to move
  // together with a crouch, keeping the torso a believable constant length.
  shoulderDrop: number;
  // Character/movement-quality pass: knee/elbow bend used to be one fixed
  // constant (0.16) for every pose, so a leg mid-stride and a leg planted
  // flat on the ground bent by exactly the same amount — a big part of why
  // walking read as "sliding" rather than genuine weight-bearing steps.
  // These let individual poses (run's mid-swing leg especially) call for a
  // deeper bend, while everything that doesn't care keeps the old default.
  bendFront: number;
  bendBack: number;
  /** Whole-body rotation in radians, about a point roughly at the centre
   * of mass. Only the dodge roll uses it — a rolling fighter is the one
   * case where the rig turns as one object rather than posing its joints. */
  spin: number;
}

const STAND: Pose = {
  bodyLean: 0, hipY: 0, headOffsetX: 0, headOffsetY: 0,
  armFrontX: 6, armFrontY: 26, armBackX: -6, armBackY: 26,
  legFrontX: 8, legFrontY: 40, legBackX: -8, legBackY: 40,
  capeKick: 0, flatten: 0, turnFlip: 0, shoulderDrop: 0,
  bendFront: 0.16, bendBack: 0.16, spin: 0,
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
  // Everything else eases; the roll's rotation does not. It finishes a
  // whole turn from where it began, and easing -2PI back to 0 at the end
  // would whip the fighter backwards through a second, wrong-way spin.
  smoothed.spin = target.spin;
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
    case 'dodge': {
      // A real backward roll. What was here before was a single static
      // crouch that the movement code overwrote on the very next frame, so
      // on screen it was a flicker and nothing else — no roll ever
      // happened. This tucks the whole body into a ball and turns it once,
      // all the way round, while it travels; GameEngine.dodge() now holds
      // the animation for its own length so it can actually play.
      const total = 0.52;
      const k = Math.min(1, t / total);
      // Tight through the middle, standing at both ends, so the roll opens
      // out of a stance and lands back in one.
      const tuck = Math.pow(Math.sin(Math.min(1, k / 0.88) * Math.PI), 0.55);
      // Eased so the turn is quickest while the body is smallest, which is
      // how a real roll reads.
      const turn = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const crouch = 30 * tuck;
      return {
        ...STAND,
        // Negative: away from the way the fighter is facing. The whole rig
        // is already mirrored by facing, so this comes out as a backward
        // roll whichever way they are turned.
        spin: -Math.PI * 2 * turn,
        bodyLean: 0.95 * tuck,
        hipY: crouch,
        shoulderDrop: crouch * 0.85,
        headOffsetX: 7 * tuck, headOffsetY: 11 * tuck,
        armFrontX: lerp(6, 12, tuck), armFrontY: lerp(26, 0, tuck),
        armBackX: lerp(-6, 7, tuck), armBackY: lerp(26, -3, tuck),
        legFrontX: lerp(8, 15, tuck), legFrontY: lerp(40, 9, tuck),
        legBackX: lerp(-8, 11, tuck), legBackY: lerp(40, 13, tuck),
        capeKick: 0.9 * tuck,
        bendFront: 0.16 + 0.55 * tuck, bendBack: 0.16 + 0.55 * tuck,
      };
    }
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
    case 'wrapped': {
      // Bound up: both arms pinned flat against the body, legs together,
      // and a constant struggle wobble — the figure is visibly straining
      // against the paper rather than standing calmly inside it.
      const struggle = Math.sin(t * 13) * 2.4;
      const lurch = Math.sin(t * 5.5) * 0.09;
      return {
        ...STAND,
        bodyLean: lurch,
        headOffsetX: struggle * 0.8,
        headOffsetY: Math.abs(struggle) * 0.4,
        armFrontX: 3, armFrontY: 22,
        armBackX: -3, armBackY: 22,
        legFrontX: 3, legFrontY: 40,
        legBackX: -3, legBackY: 40,
        hipY: struggle * 0.5,
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
    case 'poop': {
      // Kacken: the same turn-away as the fart, but it goes all the way
      // down into a real squat and holds there — knees out, hands on the
      // knees, a little strain wobble — instead of the fart's hip-hinge
      // lean. Reuses turnFlip so the 180 is the same genuine mirror-flip
      // the fart does, not a fade.
      const turnEnd = 0.3;
      const squatEnd = 0.62;
      const holdEnd = 1.5;
      const totalEnd = 1.95;
      let turn: number, crouch: number, shoulderDrop: number, legSpread: number, lean: number;
      if (t < turnEnd) {
        const p = t / turnEnd;
        turn = p; crouch = p * 5; shoulderDrop = p * 4; legSpread = p * 2; lean = p * 0.05;
      } else if (t < squatEnd) {
        const p = (t - turnEnd) / (squatEnd - turnEnd);
        turn = 1; crouch = 5 + p * 29; shoulderDrop = 4 + p * 26; legSpread = 2 + p * 7; lean = 0.05 + p * 0.2;
      } else if (t < holdEnd) {
        const p = (t - squatEnd) / (holdEnd - squatEnd);
        // The strain: a slow push with a couple of sharper shudders.
        const strain = Math.sin(p * Math.PI * 3) * 2.2 + Math.sin(p * Math.PI) * 2;
        turn = 1; crouch = 34 + strain; shoulderDrop = 30 + strain * 0.7; legSpread = 9; lean = 0.25;
      } else {
        const p = Math.min(1, (t - holdEnd) / (totalEnd - holdEnd));
        turn = 1 - p;
        crouch = 34 - p * 34; shoulderDrop = 30 - p * 30; legSpread = 9 - p * 9; lean = 0.25 - p * 0.25;
      }
      return {
        ...STAND, turnFlip: turn, bodyLean: lean, hipY: crouch, shoulderDrop,
        // Hands braced on the knees.
        armFrontX: 10, armFrontY: 20 - crouch * 0.25,
        armBackX: -10, armBackY: 20 - crouch * 0.25,
        legFrontX: 8 + legSpread, legFrontY: 40 - crouch * 0.75,
        legBackX: -8 - legSpread, legBackY: 40 - crouch * 0.75,
        capeKick: 0.25 + crouch * 0.012,
        bendFront: 0.16 + crouch * 0.02, bendBack: 0.16 + crouch * 0.02,
      };
    }
    case 'dentures': {
      // Grandpa's signature: he spits his dentures at you. So there is no
      // hand work in this at all — the whole motion is head and torso.
      // Cock back, mouth wide open (the dentures visible in it), then whip
      // everything forward and let them fly. The recoil afterwards is what
      // sells how hard he spat.
      const readyEnd = 0.2;   // notices, starts to open up
      const gapeEnd = 0.44;   // head cocked back, mouth wide
      const spitEnd = 0.56;   // the whip forward — this is the frame they leave
      const totalEnd = 1.0;
      let lean: number, headX: number, headY: number, hip: number;
      let armX: number, armY: number, backX: number, backY: number;
      if (t < readyEnd) {
        const p = t / readyEnd;
        lean = p * 0.1; headX = p * 2; headY = p * 1;
        hip = p * 3;
        armX = lerp(6, 10, p); armY = lerp(26, 22, p);
        backX = lerp(-6, -9, p); backY = lerp(26, 23, p);
      } else if (t < gapeEnd) {
        const p = (t - readyEnd) / (gapeEnd - readyEnd);
        // Cocking back: chin up and away, chest opens, knees soften. The
        // further back he goes here, the harder the spit reads.
        lean = lerp(0.1, -0.32, p);
        headX = lerp(2, -6, p); headY = lerp(1, -4, p);
        hip = lerp(3, 6, p);
        armX = lerp(10, -8, p); armY = lerp(22, 16, p);
        backX = lerp(-9, -16, p); backY = lerp(23, 18, p);
      } else if (t < spitEnd) {
        const p = (t - gapeEnd) / (spitEnd - gapeEnd);
        // PTOO. Head leads, torso follows, arms fly back behind him.
        lean = lerp(-0.32, 0.5, p);
        headX = lerp(-6, 9, p); headY = lerp(-4, 4, p);
        hip = lerp(6, 2, p);
        armX = lerp(-8, -18, p); armY = lerp(16, 24, p);
        backX = lerp(-16, -22, p); backY = lerp(18, 26, p);
      } else {
        const p = Math.min(1, (t - spitEnd) / (totalEnd - spitEnd));
        // Settling, with one small residual bob — an old man who just put
        // his whole neck into that.
        const bob = Math.sin(p * Math.PI * 2.5) * 2 * (1 - p);
        lean = lerp(0.5, 0, p);
        headX = lerp(9, 0, p) + bob; headY = lerp(4, 0, p);
        hip = lerp(2, 0, p);
        armX = lerp(-18, 6, p); armY = lerp(24, 26, p);
        backX = lerp(-22, -6, p); backY = lerp(26, 26, p);
      }
      return {
        ...STAND, bodyLean: lean, hipY: hip, shoulderDrop: hip * 0.6,
        headOffsetX: headX, headOffsetY: headY,
        armFrontX: armX, armFrontY: armY, armBackX: backX, armBackY: backY,
        legFrontX: 9, legFrontY: 40 - hip * 0.5, legBackX: -9, legBackY: 40 - hip * 0.5,
        capeKick: Math.max(0, lean) * 1.1,
      };
    }
    case 'annoyed': {
      // Hit in the back of the head by his own returning dentures. A snap
      // forward, then a hand up rubbing the spot with a grumpy little
      // head-shake — comic, not a real stagger.
      const snapEnd = 0.18;
      const totalEnd = 0.95;
      if (t < snapEnd) {
        const p = t / snapEnd;
        return {
          ...STAND, bodyLean: p * 0.3, headOffsetX: p * 5, headOffsetY: p * 3,
          armFrontX: lerp(6, 2, p), armFrontY: lerp(26, 16, p),
        };
      }
      const p = Math.min(1, (t - snapEnd) / (totalEnd - snapEnd));
      const shake = Math.sin(p * Math.PI * 5) * 2.5 * (1 - p);
      const rub = Math.sin(p * Math.PI * 3) * 3;
      return {
        ...STAND, bodyLean: lerp(0.3, 0, p),
        headOffsetX: shake, headOffsetY: lerp(3, 0, p),
        // Hand up behind the head, rubbing.
        armFrontX: lerp(-4, 6, p * p), armFrontY: lerp(-10 + rub, 26, p * p),
        armBackX: -8, armBackY: 24,
      };
    }
    case 'rockPose': {
      // Punk's signature. Not a punch and not a spell: a stance. Legs go
      // wide and stay wide, the body coils back over the rear foot, and the
      // strumming arm travels a long way so the chord reads as one huge
      // physical motion rather than a button press.
      const stanceEnd = 0.26;
      const chargeEnd = 0.5;
      const strumEnd = 0.62;
      const holdEnd = 0.98;
      const totalEnd = 1.35;
      let lean: number, hip: number, frontX: number, frontY: number;
      let backX: number, backY: number, headX: number, headY: number, spread: number;
      if (t < stanceEnd) {
        const p = t / stanceEnd;
        // Dropping into the stance — knees bend, feet plant apart.
        lean = p * 0.1; hip = p * 8; spread = p * 8;
        frontX = lerp(6, 20, p); frontY = lerp(26, 12, p);   // fretting hand out front
        backX = lerp(-6, -14, p); backY = lerp(26, 18, p);   // strumming hand back
        headX = 0; headY = p * 2;
      } else if (t < chargeEnd) {
        const p = (t - stanceEnd) / (chargeEnd - stanceEnd);
        // Coiling: weight back, strumming arm hauled up and behind, head
        // dropping forward — the breath before the chord.
        lean = lerp(0.1, -0.26, p); hip = lerp(8, 12, p); spread = 8 + p * 3;
        frontX = lerp(20, 26, p); frontY = lerp(12, 6, p);
        backX = lerp(-14, -26, p); backY = lerp(18, -12, p);
        headX = lerp(0, -3, p); headY = lerp(2, 5, p);
      } else if (t < strumEnd) {
        const p = (t - chargeEnd) / (strumEnd - chargeEnd);
        // THE CHORD. Arm smashes down through the strings, head thrown
        // back, whole body arches open.
        lean = lerp(-0.26, 0.18, p); hip = lerp(12, 4, p); spread = 11 + p * 3;
        frontX = lerp(26, 22, p); frontY = lerp(6, 14, p);
        backX = lerp(-26, 20, p); backY = lerp(-12, 26, p);
        headX = lerp(-3, 2, p); headY = lerp(5, -6, p);
      } else if (t < holdEnd) {
        const p = (t - strumEnd) / (holdEnd - strumEnd);
        // Held: horns up, chin high, vibrating with the note.
        const buzz = Math.sin(p * Math.PI * 8) * (1 - p) * 2;
        lean = 0.18 - p * 0.1; hip = 4; spread = 14;
        frontX = 22 + buzz; frontY = 14;
        backX = lerp(20, 8, p) + buzz; backY = lerp(26, -18, p);
        headX = 2; headY = -6 + buzz * 0.5;
      } else {
        const p = Math.min(1, (t - holdEnd) / (totalEnd - holdEnd));
        lean = lerp(0.08, 0, p); hip = lerp(4, 0, p); spread = lerp(14, 0, p);
        frontX = lerp(22, 6, p); frontY = lerp(14, 26, p);
        backX = lerp(8, -6, p); backY = lerp(-18, 26, p);
        headX = lerp(2, 0, p); headY = lerp(-6, 0, p);
      }
      return {
        ...STAND, bodyLean: lean, hipY: hip, shoulderDrop: hip * 0.7,
        headOffsetX: headX, headOffsetY: headY,
        armFrontX: frontX, armFrontY: frontY, armBackX: backX, armBackY: backY,
        legFrontX: 8 + spread, legFrontY: 40 - hip * 0.6,
        legBackX: -8 - spread, legBackY: 40 - hip * 0.6,
        capeKick: 0.3 + spread * 0.05,
        bendFront: 0.16 + hip * 0.02, bendBack: 0.16 + hip * 0.02,
      };
    }
    case 'stomp': {
      // Bruno's signature. All the weight is in the wind-up: he sinks,
      // hauls one leg up to hip height with both arms overhead, and then
      // drives everything down at once. The recoil crouch afterwards is
      // what makes the ground look hard.
      const gatherEnd = 0.22;
      const raiseEnd = 0.46;
      const slamEnd = 0.54;
      const holdEnd = 0.86;
      const totalEnd = 1.4;
      let hip: number, lean: number, armX: number, armY: number;
      let legFY: number, legFX: number, legBY: number;
      if (t < gatherEnd) {
        const p = t / gatherEnd;
        hip = p * 10; lean = p * 0.14;
        armX = lerp(6, -2, p); armY = lerp(26, 14, p);
        legFX = 8; legFY = 40; legBY = 40;
      } else if (t < raiseEnd) {
        const p = (t - gatherEnd) / (raiseEnd - gatherEnd);
        // Up: leg comes off the floor and folds in, arms go over the head.
        hip = lerp(10, -6, p); lean = lerp(0.14, -0.16, p);
        armX = lerp(-2, -10, p); armY = lerp(14, -22, p);
        legFX = lerp(8, 4, p); legFY = lerp(40, 12, p); legBY = 40;
      } else if (t < slamEnd) {
        const p = (t - raiseEnd) / (slamEnd - raiseEnd);
        // Down. Everything at once, and further down than standing height
        // so the impact bottoms out rather than stopping neatly.
        hip = lerp(-6, 18, p); lean = lerp(-0.16, 0.24, p);
        armX = lerp(-10, 12, p); armY = lerp(-22, 24, p);
        legFX = lerp(4, 14, p); legFY = lerp(12, 40, p); legBY = 40;
      } else if (t < holdEnd) {
        const p = (t - slamEnd) / (holdEnd - slamEnd);
        // The recoil: a couple of hard shudders that decay.
        const recoil = Math.cos(p * Math.PI * 3) * 3 * (1 - p);
        hip = 18 + recoil; lean = 0.24 - p * 0.06;
        armX = 12; armY = 24 + recoil;
        legFX = 14; legFY = 40; legBY = 40;
      } else {
        const p = Math.min(1, (t - holdEnd) / (totalEnd - holdEnd));
        hip = lerp(18, 0, p); lean = lerp(0.18, 0, p);
        armX = lerp(12, 6, p); armY = lerp(24, 26, p);
        legFX = lerp(14, 8, p); legFY = 40; legBY = 40;
      }
      return {
        ...STAND, bodyLean: lean, hipY: hip, shoulderDrop: hip * 0.75,
        armFrontX: armX, armFrontY: armY, armBackX: armX - 6, armBackY: armY + 2,
        legFrontX: legFX, legFrontY: legFY, legBackX: -10, legBackY: legBY,
        capeKick: Math.max(0, -hip * 0.05) + 0.2,
        bendFront: 0.16 + Math.max(0, hip) * 0.02, bendBack: 0.16 + Math.max(0, hip) * 0.02,
      };
    }
    case 'superpower':
    case 'fart': {
      // Movement-quality pass 3 (root-cause fix): the previous version only
      // faded the face out and stretched the torso by dropping the hip
      // while the shoulder anchor stayed fixed — no actual turn, and the
      // "bend" read as the body being pulled longer rather than a real
      // hip-hinge crouch. This is a genuine five-beat sequence: glance ->
      // an actual 180° turn (mirror-flip via turnFlip, applied once in
      // renderFighter's main transform, not a fade) -> a real bend where
      // hip *and* shoulder drop together (shoulderDrop) so the torso keeps
      // a believable length while the whole upper body sinks and leans ->
      // a held release beat (GameEngine's actual gas/fire payload timing
      // targets the middle of this window) -> standing back up while
      // turning back to face the enemy.
      const glanceEnd = 0.12;
      const turnEnd = 0.32;
      const bendEnd = 0.52;
      const holdEnd = 0.85;
      const totalEnd = 1.25;
      let turn: number, crouch: number, shoulderDrop: number, cape: number, lean: number, armX: number, armY: number;
      if (t < glanceEnd) {
        const p = t / glanceEnd;
        turn = 0; crouch = 0; shoulderDrop = 0; cape = 0; lean = 0;
        armX = 0; armY = 26 - 2 * p;
      } else if (t < turnEnd) {
        const p = (t - glanceEnd) / (turnEnd - glanceEnd);
        // The turn itself — arms flare out for balance mid-spin (peaking
        // at the edge-on midpoint), knees already softening a touch.
        turn = p;
        crouch = p * 4; shoulderDrop = p * 3; cape = p * 0.3; lean = p * 0.08;
        const flare = Math.sin(p * Math.PI);
        armX = -14 * flare; armY = 24 - 10 * flare;
      } else if (t < bendEnd) {
        const p = (t - turnEnd) / (bendEnd - turnEnd);
        turn = 1;
        crouch = 4 + p * 15; shoulderDrop = 3 + p * 13; cape = 0.3 + p * 0.6; lean = 0.08 + p * 0.4;
        armX = -14 - p * 4; armY = 14 - p * 4;
      } else if (t < holdEnd) {
        const p = (t - bendEnd) / (holdEnd - bendEnd);
        turn = 1;
        const wobble = Math.sin(p * Math.PI) * 1.5;
        crouch = 19 + wobble; shoulderDrop = 16 + wobble * 0.6; cape = 0.9 + p * 0.1; lean = 0.48;
        armX = -18; armY = 10;
      } else {
        const p = Math.min(1, (t - holdEnd) / (totalEnd - holdEnd));
        turn = 1 - p;
        crouch = 19 - p * 19; shoulderDrop = 16 - p * 16; cape = 1 - p * 0.75; lean = 0.48 - p * 0.48;
        armX = -18 + p * 24; armY = 10 + p * 16;
      }
      return {
        ...STAND, turnFlip: turn, bodyLean: lean, hipY: crouch, shoulderDrop,
        armFrontX: armX, armFrontY: armY, armBackX: armX, armBackY: armY,
        capeKick: cape, bendFront: 0.16 + crouch * 0.012, bendBack: 0.16 + crouch * 0.012,
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
  const heavy = weaponId === 'axe' || weaponId === 'club';
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
function flattenGroundEmbed(f: Fighter, pose: Pose): number {
  const upright = -lowestFootLocalY(f, pose) + FOOT_SAFETY_EMBED;
  const flat = GROUND_EMBED_FLATTEN;
  const k = Math.max(0, Math.min(1, pose.flatten));
  return upright * (1 - k) + flat * k;
}

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

/** A real boxing glove rather than a red dot: an egg-shaped mitt that is
 * fatter at the knuckles than at the wrist, a separate thumb bulge on the
 * inside, the seam running over the knuckles, a laced wrist cuff and a
 * highlight on the leather. Oriented along the forearm, like the bare hand
 * it replaces, so it always reads as attached rather than stuck on. */
function drawBoxingGlove(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  r: number,
): void {
  const angle = Math.atan2(dirY, dirX);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // +x now runs out of the wrist towards the knuckles.

  // Wrist cuff, drawn first so the mitt overlaps it.
  ctx.fillStyle = '#8e2318';
  ctx.strokeStyle = '#5d1710';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(-r * 1.05, -r * 0.62, r * 0.75, r * 1.24, r * 0.2);
  ctx.fill();
  ctx.stroke();
  // Laces across the cuff.
  ctx.strokeStyle = '#f2e3c8';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const lx = -r * 0.95 + i * r * 0.26;
    ctx.moveTo(lx, -r * 0.4);
    ctx.lineTo(lx + r * 0.16, r * 0.4);
  }
  ctx.stroke();

  // The mitt: an egg, wide at the knuckles and tapering back to the wrist.
  const leather = ctx.createLinearGradient(-r, -r, r, r);
  leather.addColorStop(0, '#e2503f');
  leather.addColorStop(0.55, '#c0392b');
  leather.addColorStop(1, '#8e2318');
  ctx.fillStyle = leather;
  ctx.strokeStyle = '#5d1710';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-r * 0.5, -r * 0.72);
  ctx.quadraticCurveTo(r * 0.75, -r * 1.05, r * 1.02, -r * 0.28);
  ctx.quadraticCurveTo(r * 1.2, r * 0.3, r * 0.55, r * 0.86);
  ctx.quadraticCurveTo(-r * 0.15, r * 1.05, -r * 0.5, r * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Thumb, a separate bulge low on the inside edge.
  ctx.beginPath();
  ctx.ellipse(r * 0.1, r * 0.72, r * 0.42, r * 0.3, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Knuckle seam.
  ctx.strokeStyle = 'rgba(93,23,16,0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(r * 0.62, -r * 0.66);
  ctx.quadraticCurveTo(r * 0.86, 0, r * 0.5, r * 0.66);
  ctx.stroke();

  // Leather highlight.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(r * 0.1, -r * 0.3, r * 0.5, r * 0.28, -0.35, Math.PI * 0.9, Math.PI * 1.75);
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
  // Use the effective floor, not the arena floor: on a raised platform the
  // whole rig (ground anchoring, air-lift, the flattened death path) must
  // key off the surface actually being stood on.
  const groundY = floorY(f.body);
  const airLift = groundY - f.body.pos.y;
  const groundEmbed = f.body.grounded ? flattenGroundEmbed(f, pose) * scale : 0;

  // Movement-quality pass 3: a real 180° turn (fart/chili/ice) — a single
  // extra horizontal-scale factor riding the same transform everything else
  // draws through, so the whole figure (limbs, torso, cape, hair, face)
  // spins together as one silhouette instead of the old fade-only fake.
  // cos() sweeps 1 -> 0 (edge-on, briefly a thin sliver — the classic
  // cartoon "quick spin" beat) -> -1 (fully turned) as turnFlip goes 0..1.
  const turnMirror = Math.cos(pose.turnFlip * Math.PI);

  ctx.save();
  ctx.translate(x, groundY - airLift + groundEmbed);
  ctx.scale(f.facing * scale * turnMirror, scale);

  // Rolling: turn the whole rig about its centre of mass rather than about
  // the feet, or the body would sweep round the ground like a hand on a
  // clock instead of rolling along it.
  if (pose.spin !== 0) {
    const pivotY = -f.height * 0.34;
    ctx.translate(0, pivotY);
    ctx.rotate(pose.spin);
    ctx.translate(0, -pivotY);
  }

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

  // The roll is the one place invulnerability is *earned* rather than granted,
  // and it is also the only place where the fighter is doing something worth
  // watching. Strobing it at 60ms made the whole move read as a flicker
  // instead of a somersault, so the roll keeps its i-frames but stays solid.
  const flashInvuln =
    f.invulnerableMs > 0 && f.anim !== 'dodge' && Math.floor(f.animTimeMs / 60) % 2 === 0;
  ctx.globalAlpha = flashInvuln ? 0.5 : 1;

  // Character-system overhaul: the four playable heroes share this exact
  // rig/animation — only proportions and palette differ. Everyone else
  // (normal enemies, bosses render through renderBoss.ts) uses the
  // original slim proportions untouched.
  const charDef = f.kind === 'player' ? CHARACTERS[f.characterId] : null;
  const bw = charDef?.build === 'heavy' ? 2.1 : 1; // body-width multiplier — bumped up alongside the new, much thinner base widths so Bruno still reads as convincingly bigger, not just proportionally-thin like everyone else
  const headMult = charDef?.build === 'heavy' ? 1.22 : 1;

  // Filigree-stick-figure pass: a proportionally larger head over a much
  // thinner body (torso/limb widths below), plus a visible thin neck gap
  // (was headR-2, i.e. the head visually merged straight into the torso's
  // own rounded shoulder cap with no neck at all) so the silhouette reads
  // as a fine comic stick figure rather than a solid blob with a head.
  const headR = 13 * headMult;
  const hipY = -f.height * 0.45 + pose.hipY;
  const shoulderY = -f.height * 0.78 + pose.shoulderDrop;
  const headY = shoulderY - headR - 6 + pose.headOffsetY;
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
  drawLimb(ctx, 0, hipY, pose.legBackX, hipY + pose.legBackY, 3.6 * bw, 2.6 * bw, pose.bendBack, -1, f.color);
  drawShoe(ctx, pose.legBackX, hipY + pose.legBackY, footTiltAngle(pose.legBackX, pose.legBackY), shoeStyle);
  drawLimb(ctx, 0, hipY, pose.legFrontX, hipY + pose.legFrontY, 3.6 * bw, 2.6 * bw, pose.bendFront, -1, f.color);
  drawShoe(ctx, pose.legFrontX, hipY + pose.legFrontY, footTiltAngle(pose.legFrontX, pose.legFrontY), shoeStyle);

  // Torso — a slim, filigree column (much thinner than the old heavy
  // cartoon-hero taper), with a distinct thinner neck (drawn separately
  // below) connecting it up to the head instead of the two merging.
  const shoulderX = Math.sin(pose.bodyLean) * 10;
  drawTaperedSegment(ctx, 0, hipY, shoulderX, shoulderY, 7 * bw, 8 * bw, f.color);
  drawTaperedSegment(ctx, shoulderX, shoulderY, shoulderX + headX * 0.4, headY + headR * 0.85, 4 * bw, 3.4 * bw, f.color);

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

  // Back arm, then the shield strapped to it. The shield covers the forearm
  // and hand, which is exactly what a shield carried on that arm looks like
  // from the side — the previous order drew the arm across the front of the
  // shield, which no arm does. The upper arm stays visible running from the
  // shoulder into the shield, so it still reads as carried rather than
  // stuck on, and because the shield is centred on the hand the two always
  // move as one.
  drawArm(ctx, shoulderX, shoulderY, pose.armBackX, pose.armBackY, f, false, pose.bendBack, bw);
  drawShield(
    ctx, f,
    shoulderX + pose.armBackX, shoulderY + pose.armBackY,
    pose.armBackX, pose.armBackY, bw,
  );

  // Head.
  ctx.beginPath();
  ctx.fillStyle = f.color;
  ctx.arc(shoulderX + headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  if (charDef) drawPlayerHair(ctx, charDef, shoulderX + headX, headY, headR, f.animTimeMs, hairCharge(f));
  drawHeadAccessories(ctx, f, shoulderX + headX, headY, headR);
  drawFace(ctx, f, shoulderX + headX, headY, headR, pose, dtSec);
  if (charDef) drawPlayerFaceExtras(ctx, charDef, shoulderX + headX, headY, headR, f.animTimeMs, dentureGape(f));

  // Front arm (in front of torso, holds weapon).
  drawArm(ctx, shoulderX, shoulderY, pose.armFrontX, pose.armFrontY, f, true, pose.bendFront, bw);
  drawWeaponInHand(ctx, f, shoulderX + pose.armFrontX, shoulderY + pose.armFrontY, pose.armFrontX, pose.armFrontY);

  // Once the mouth is open and before the spit, the dentures sit visibly
  // inside it. Without this the mouth just gapes and something appears out
  // of thin air at the moment he spits — the player has to SEE what is
  // about to come out. Drawn last so it sits over the mouth cavity.
  if (f.anim === 'dentures' && f.animTimeMs >= 300 && f.animTimeMs < 545) {
    const p = Math.min(1, (f.animTimeMs - 300) / 245);
    drawDentures(
      ctx,
      shoulderX + headX + 3.5 + p * 2.5, headY + 7,
      // Tips forward as they come loose, ready to leave.
      -0.25 + p * 0.35,
      0.5, 0.55,
    );
  }

  drawStatusOverlay(ctx, f, shoulderY, hipY);

  ctx.restore();
}

function drawArm(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, dx: number, dy: number, f: Fighter, front: boolean,
  bend = 0.15, widthMult = 1,
): void {
  const isGlove = f.accessories.includes('gloves') || f.accessories.includes('boxingGloves');
  const limb = drawLimb(ctx, sx, sy, sx + dx, sy + dy, 2.8 * widthMult, 2.1 * widthMult, bend, 1, f.color);
  if (isGlove) {
    drawBoxingGlove(ctx, sx + dx, sy + dy, limb.dirX, limb.dirY, front ? 8.5 : 7.4);
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

// A recognizable little cartoon denture: two pink gum arches with a row of
// square white teeth between them, hinged at the back. Explicitly NOT a
// white rectangle — at the size it flies across the arena the teeth are
// what make it read as a set of dentures rather than a thrown brick, so
// they are drawn individually with a gap between each one.
// `bite` (0..1) closes the jaw, which is what makes it chatter in flight.
export function drawDentures(
  ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale = 1, bite = 0.5,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';

  const gap = lerp(10, 2, Math.max(0, Math.min(1, bite)));
  const halfW = 14;
  const gumThick = 5;

  // dir = 1 is the lower jaw (below the hinge, teeth pointing up),
  // dir = -1 the upper jaw (above it, teeth pointing down).
  const drawArch = (dir: 1 | -1) => {
    const oy = dir * gap * 0.5;
    // The gum as a real band with thickness — an outward curve and an
    // inward one closed into a crescent — rather than a hairline, which is
    // what made it read as a squiggle at arena distance.
    ctx.fillStyle = dir > 0 ? '#e07070' : '#ec8181';
    ctx.strokeStyle = '#7d2b2b';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-halfW, oy);
    ctx.quadraticCurveTo(0, oy + dir * 7, halfW, oy);
    ctx.lineTo(halfW, oy - dir * gumThick);
    ctx.quadraticCurveTo(0, oy + dir * (7 - gumThick * 1.6), -halfW, oy - dir * gumThick);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Teeth. Few and chunky on purpose: at the size this thing crosses the
    // arena, a mouthful of hairlines is a smear, six blocks with dark gaps
    // between them is unmistakably a set of teeth.
    ctx.strokeStyle = '#4a4a44';
    ctx.lineWidth = 1.1;
    const count = 6;
    for (let i = 0; i < count; i++) {
      const p = (i + 0.5) / count;
      const tx = lerp(-halfW + 2.4, halfW - 2.4, p);
      const curve = Math.sin(p * Math.PI) * 5.5;
      const ty = oy + dir * curve;
      const th = 6.5 - Math.abs(p - 0.5) * 2.4;
      // The front teeth are the big ones, so the middle of the row reads
      // as the front of a mouth rather than a uniform comb.
      const tw = 3.6 - Math.abs(p - 0.5) * 1.1;
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f4efe2';
      ctx.beginPath();
      ctx.roundRect(tx - tw / 2, dir > 0 ? ty - th : ty, tw, th, 1.3);
      ctx.fill();
      ctx.stroke();
    }
  };

  drawArch(1);
  drawArch(-1);

  // The hinge at the back, so the two jaws visibly belong to one object.
  ctx.fillStyle = 'rgba(120,45,45,0.9)';
  ctx.beginPath();
  ctx.ellipse(-halfW + 1, 0, 2.6, gap * 0.5 + 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Section (polish pass): weapons used to render as one undifferentiated
// line at a fixed angle unrelated to the arm — every weapon looked the
// same and could visibly clip through the
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
      // Redrawn: this used to be a thin handle with a round blob and an
      // inner ring stuck on the end, which read as a cooking pot on a
      // stick rather than a weapon. Now a single continuously tapered
      // wooden cudgel — thin at the grip, thick and slightly knotted at
      // the business end — with grain lines along the shaft.
      ctx.save();
      ctx.fillStyle = weapon.color;
      ctx.beginPath();
      ctx.moveTo(-8, -2.4);
      ctx.quadraticCurveTo(12, -4.2, 24, -8);
      ctx.quadraticCurveTo(33, -10.5, 35, -4);
      ctx.quadraticCurveTo(36.5, 0, 35, 4);
      ctx.quadraticCurveTo(33, 10.5, 24, 8);
      ctx.quadraticCurveTo(12, 4.2, -8, 2.4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a2414';
      ctx.lineWidth = 1;
      ctx.stroke();
      // A couple of knots/grain marks so the head reads as wood.
      ctx.strokeStyle = 'rgba(58,36,20,0.55)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(6, -1.4); ctx.lineTo(20, -3.2);
      ctx.moveTo(8, 1.6); ctx.lineTo(22, 3.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(28, -1.5, 2.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'toiletPaper': {
      // A roll held on its side: the white paper cylinder seen end-on, the
      // cardboard core, and the loose sheet already hanging off it (it
      // flutters during the swing, which is where the wrap comes from).
      ctx.save();
      ctx.fillStyle = '#fdfdfd';
      ctx.strokeStyle = '#b9b9b2';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(16, 0, 12, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Wound-paper layers, so it reads as a roll rather than a white ball.
      ctx.strokeStyle = 'rgba(150,150,144,0.5)';
      ctx.lineWidth = 0.8;
      for (let r = 9; r >= 6; r -= 1.5) {
        ctx.beginPath();
        ctx.ellipse(16, 0, r, r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#c8a165';
      ctx.beginPath();
      ctx.ellipse(16, 0, 4.2, 4.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // The loose sheet trailing off the roll.
      const wave = Math.sin(f.animTimeMs / 90) * 3;
      ctx.fillStyle = '#fbfbf8';
      ctx.strokeStyle = '#cfcfc8';
      ctx.beginPath();
      ctx.moveTo(14, 11);
      ctx.quadraticCurveTo(22 + wave, 20, 16 + wave, 32);
      ctx.lineTo(24 + wave, 33);
      ctx.quadraticCurveTo(30 + wave, 20, 22, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
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
      // A bow is held upright, always — the limbs point up and down no
      // matter where the hand happens to be. It used to inherit the arm's
      // own direction like a swung weapon, so the moment the arm hung down
      // at rest the whole bow rotated flat and lay across the hip like
      // something stuck to the body. Cancelling the arm rotation puts it
      // back in the body's frame: +x is straight ahead, +y is down, so the
      // limbs stay vertical in every pose while the hand still carries it.
      ctx.rotate(-angle);

      // Geometry, all measured from the hand at (0, 0): the grip is the
      // belly of the bow, so the hand is ON the riser rather than floating
      // in front of it. Limbs sweep back towards the archer and the string
      // runs between their tips, behind the grip — which is also what puts
      // the arrow, nocked on that string, pointing forwards past the hand.
      //
      // Taller and far finer than it was. The old one was 40px of uniform
      // 4-7px stroke, which read as a thick croissant rather than a bow:
      // the whole character of a bow is a long, springy limb that tapers
      // to almost nothing at the nock.
      const limbHalf = 34;   // tip-to-grip height, each way
      const sagitta = 16;    // how far the belly stands proud of the tips
      const bowRadius = (limbHalf * limbHalf + sagitta * sagitta) / (2 * sagitta);
      const centreX = 2 - bowRadius;
      const tipAngle = Math.atan2(limbHalf, 2 - sagitta - centreX);
      // Only the last fifth of each limb hooks forward again, the way a real
      // recurve's tips do. It has to stay small: a bigger hook eats the
      // sagitta, and the belly and the tips then sit at the same x — which
      // is exactly what made the first attempt draw as a straight stick
      // with a string laid along it instead of a bow.
      const recurveAt = (u: number) => Math.pow(Math.max(0, (u - 0.78) / 0.22), 2) * 4.5;
      const limbPoint = (u: number, sign: 1 | -1) => {
        const a = sign * tipAngle * u;
        return {
          a,
          x: centreX + Math.cos(a) * bowRadius + recurveAt(u),
          y: Math.sin(a) * bowRadius,
        };
      };
      const tipTop = limbPoint(1, -1);
      const tipBot = limbPoint(1, 1);

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
      const stringMidX = tipTop.x - pull * 20;

      // Each limb as a filled sliver that tapers from the riser to a hair
      // at the nock. Drawn as a shape rather than a stroke because a
      // stroke cannot taper, and an even-width limb is exactly what made
      // the old bow look like a toy.
      const drawBowLimb = (sign: 1 | -1) => {
        const steps = 18;
        const outer: [number, number][] = [];
        const inner: [number, number][] = [];
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const p = limbPoint(u, sign);
          const w = lerp(2.6, 0.55, u * u);
          const nx = Math.cos(p.a);
          const ny = Math.sin(p.a);
          outer.push([p.x + nx * w, p.y + ny * w]);
          inner.push([p.x - nx * w, p.y - ny * w]);
        }
        ctx.beginPath();
        ctx.moveTo(outer[0][0], outer[0][1]);
        for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i][0], outer[i][1]);
        for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
        ctx.closePath();
        ctx.fill();
      };
      // Lighter than the weapon's own brown: the limbs are 1-3px of wood
      // drawn straight over a black silhouette, and at the weapon colour
      // they simply vanished into the body, leaving only the string
      // visible — a lone bright line that read as a bolt, not a bow.
      ctx.fillStyle = '#9a6636';
      drawBowLimb(1);
      drawBowLimb(-1);
      // A pale edge along the back of each limb — the highlight is what
      // stops a dark thin shape reading as a scratch.
      ctx.strokeStyle = 'rgba(255,238,205,0.55)';
      ctx.lineWidth = 0.7;
      for (const sign of [1, -1] as const) {
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const p = limbPoint(i / 12, sign);
          const w = lerp(2.4, 0.5, (i / 12) ** 2);
          const px = p.x + Math.cos(p.a) * w;
          const py = p.y + Math.sin(p.a) * w;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // The riser: a short thicker section at the belly with a wrapped
      // grip and a small arrow shelf, so there is somewhere for the hand
      // to actually be.
      ctx.strokeStyle = '#8a5a2e';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(centreX, 0, bowRadius, -0.2, 0.2);
      ctx.stroke();
      ctx.strokeStyle = '#4a3520';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(centreX, 0, bowRadius, -0.115, 0.115);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(20,14,8,0.55)';
      ctx.lineWidth = 0.9;
      for (let i = -2; i <= 2; i++) {
        const a = i * 0.045;
        ctx.beginPath();
        ctx.moveTo(centreX + Math.cos(a) * (bowRadius - 3.4), Math.sin(a) * (bowRadius - 3.4));
        ctx.lineTo(centreX + Math.cos(a) * (bowRadius + 3.4), Math.sin(a) * (bowRadius + 3.4));
        ctx.stroke();
      }
      // Arrow shelf, just above the grip.
      ctx.fillStyle = '#5d4426';
      ctx.beginPath();
      ctx.moveTo(2, -3.4);
      ctx.lineTo(8.5, -4.6);
      ctx.lineTo(8.5, -2.4);
      ctx.lineTo(2, -1.4);
      ctx.closePath();
      ctx.fill();

      // The string: one hair-thin pale line. Deliberately NOT the weapon's
      // trailColor — that is the arrow's gold, and at this thickness a
      // saturated string is the loudest thing on the whole bow.
      ctx.strokeStyle = 'rgba(240,236,222,0.92)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(tipTop.x, tipTop.y);
      ctx.lineTo(stringMidX, 0);
      ctx.lineTo(tipBot.x, tipBot.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(40,30,18,0.8)';
      ctx.lineWidth = 1.8;
      for (const tip of [tipTop, tipBot]) {
        ctx.beginPath();
        ctx.moveTo(tip.x - 1.6, tip.y);
        ctx.lineTo(tip.x + 1.6, tip.y);
        ctx.stroke();
      }

      if (pull > 0.05) {
        ctx.strokeStyle = '#6d4c2f';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(stringMidX, 0);
        ctx.lineTo(stringMidX + 46, 0);
        ctx.stroke();
        ctx.fillStyle = '#cfd8dc';
        ctx.beginPath();
        ctx.moveTo(stringMidX + 46, 0);
        ctx.lineTo(stringMidX + 38, -2.6);
        ctx.lineTo(stringMidX + 38, 2.6);
        ctx.closePath();
        ctx.fill();
        // Fletching at the nock end.
        ctx.fillStyle = '#e0e0e0';
        for (const sy of [-1, 1] as const) {
          ctx.beginPath();
          ctx.moveTo(stringMidX + 2, 0);
          ctx.lineTo(stringMidX + 9, sy * 3.4);
          ctx.lineTo(stringMidX + 11, 0);
          ctx.closePath();
          ctx.fill();
        }
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

  // Character-system overhaul: a player's cape is a cosmetic color choice
  // (see MEIN CHARAKTER / CAPE_COLORS) rather than one fixed red — enemies/
  // bosses with the plain 'cape'/'fancyCape' accessory keep their original
  // fixed colors untouched.
  const fancy = f.accessories.includes('fancyCape');
  const capePlayerColors = f.kind === 'player' ? CAPE_COLORS[f.capeColorId] : null;
  const primary = capePlayerColors?.primary ?? (fancy ? '#8e24aa' : '#c0392b');
  const secondary = capePlayerColors?.secondary ?? (fancy ? '#6a1b9a' : '#8e2318');

  // Cape rework: this used to be a single closed path only 8px wide at the
  // shoulders that tapered to a point — at the game's zoom it read as a
  // coloured stroke down the character's back rather than a garment. It is
  // now a real piece of cloth: a proper yoke across the shoulders, a hem
  // nearly four times as wide, a travelling wave running down it so the
  // whole sheet ripples instead of pivoting rigidly, a scalloped fluttering
  // hem, shaded folds for volume, and a lit leading edge.
  const t = f.animTimeMs / 1000;
  const gust = windGust(performance.now() / 1000);
  // Length is tuned so the hem (scallops included) hangs just above the
  // shoes at rest rather than dragging through the grass.
  const len = 58;
  // Narrow at the throat, widening quickly over the shoulders: a cape that
  // is as wide at the neck as it is at the collarbone reads as a bib rather
  // than something fastened around someone's neck.
  const neckHalf = 4.5;
  const botHalf = 20;
  // How far the sheet trails behind the body: the spring's sway, the pose's
  // own flare, and the shared scene-wide wind gust all push in the same
  // direction, so the cape lifts when the character runs, jumps or farts
  // AND on the same gusts the meadow grass leans to.
  const drift = sway + kick * 0.5 + gust * 7;
  const wavePhase = t * 4.2 + f.body.pos.x * 0.02;
  const waveAmp = 2.2 + Math.abs(drift) * 0.16 + gust * 2.4;

  // A point on one side edge of the cloth. k: 0 at the shoulders, 1 at the
  // hem. side: +1 = leading (body-side) edge, -1 = trailing edge.
  const edge = (k: number, side: 1 | -1) => {
    // pow(k, 0.55) flares the cloth out fast just below the collar and then
    // widens gently, instead of a straight taper from a too-wide neck.
    const half = neckHalf + (botHalf - neckHalf) * Math.pow(k, 0.55);
    // Asymmetric: seen from the side the cloth hugs the near shoulder and
    // billows out behind, so only a sliver shows past the body's leading
    // edge while the bulk of the sheet trails. Without this the cape reads
    // as being worn across the front.
    const reach = side === 1 ? half * 0.42 : -half * 1.25;
    // Trailing away from the body grows with k^1.5, so the cloth stays
    // pinned at the shoulders and swings from the bottom.
    const back = -3 - (4 + drift) * Math.pow(k, 1.5);
    const ripple = Math.sin(wavePhase - k * 5.2) * waveAmp * k;
    return {
      x: back + ripple + reach,
      y: shoulderY + 2 + len * k - kick * 0.55 * k,
    };
  };

  ctx.save();
  const grad = ctx.createLinearGradient(0, shoulderY, 0, shoulderY + len);
  grad.addColorStop(0, primary);
  grad.addColorStop(1, secondary);
  ctx.fillStyle = grad;
  ctx.strokeStyle = secondary;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';

  const ROWS = 9;
  ctx.beginPath();
  const start = edge(0, 1);
  ctx.moveTo(start.x, start.y);
  for (let i = 1; i <= ROWS; i++) {
    const p = edge(i / ROWS, 1);
    ctx.lineTo(p.x, p.y);
  }
  // Scalloped hem: three lobes hanging between the two bottom corners,
  // each dipping by its own amount and swinging on the same wave — the
  // classic fluttering cloth edge instead of a straight cut.
  const hemR = edge(1, 1);
  const hemL = edge(1, -1);
  const lobes = 3;
  for (let i = 1; i <= lobes; i++) {
    const a = (i - 1) / lobes;
    const b = i / lobes;
    const midX = hemR.x + (hemL.x - hemR.x) * ((a + b) / 2);
    const midY = hemR.y + (hemL.y - hemR.y) * ((a + b) / 2);
    const endX = hemR.x + (hemL.x - hemR.x) * b;
    const endY = hemR.y + (hemL.y - hemR.y) * b;
    const dip = 6 + Math.sin(wavePhase * 1.3 + i * 2.1) * 4;
    ctx.quadraticCurveTo(midX, midY + dip, endX, endY);
  }
  for (let i = ROWS - 1; i >= 0; i--) {
    const p = edge(i / ROWS, -1);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Folds: two darker creases running the length of the cloth, offset
  // across its width and riding the same wave, so the sheet reads as
  // draped fabric with depth rather than a flat coloured shape.
  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  for (const across of [-0.42, 0.3]) {
    ctx.beginPath();
    for (let i = 0; i <= ROWS; i++) {
      const k = i / ROWS;
      const l = edge(k, -1);
      const r = edge(k, 1);
      const x = l.x + (r.x - l.x) * (0.5 + across / 2);
      const y = l.y + (r.y - l.y) * 0.5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Lit leading edge — the side turned towards the viewer catches light,
  // which is what stops the cape flattening into a silhouette.
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i <= ROWS; i++) {
    const p = edge(i / ROWS, 1);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  // A gold trim along the hem marks out the "fancy" cape as the fancier
  // one at a glance, rather than only by colour.
  if (fancy) {
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(hemR.x, hemR.y);
    for (let i = 1; i <= lobes; i++) {
      const a = (i - 1) / lobes;
      const b = i / lobes;
      const midX = hemR.x + (hemL.x - hemR.x) * ((a + b) / 2);
      const midY = hemR.y + (hemL.y - hemR.y) * ((a + b) / 2);
      const endX = hemR.x + (hemL.x - hemR.x) * b;
      const endY = hemR.y + (hemL.y - hemR.y) * b;
      const dip = 6 + Math.sin(wavePhase * 1.3 + i * 2.1) * 4;
      ctx.quadraticCurveTo(midX, midY + dip, endX, endY);
    }
    ctx.stroke();
  }

  // The yoke: a solid collar band pinning the cloth across the shoulders,
  // so it visibly hangs from something instead of sprouting out of the neck.
  ctx.fillStyle = secondary;
  ctx.beginPath();
  ctx.moveTo(-neckHalf - 1.5, shoulderY + 1);
  ctx.quadraticCurveTo(-1, shoulderY - 4.5, neckHalf + 1.5, shoulderY + 1);
  ctx.quadraticCurveTo(-1, shoulderY + 5, -neckHalf - 1.5, shoulderY + 1);
  ctx.closePath();
  ctx.fill();
  // The clasp, sitting in the hollow of the throat.
  ctx.fillStyle = fancy ? '#ffd54f' : '#f5f5f5';
  ctx.beginPath();
  ctx.arc(-0.5, shoulderY + 0.5, 1.9, 0, Math.PI * 2);
  ctx.fill();
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
/** 0..1 — how far the hair is standing on end. Only the rock chord drives
 * it: the mohawk rising is the visual tell that the chord is coming, so it
 * ramps up through the wind-up and stays up while the note rings. */
function hairCharge(f: Fighter): number {
  if (f.anim !== 'rockPose') return 0;
  const t = f.animTimeMs / 1000;
  if (t < 0.26) return t / 0.26 * 0.35;
  if (t < 0.5) return 0.35 + ((t - 0.26) / 0.24) * 0.65;
  if (t < 0.98) return 1;
  return Math.max(0, 1 - (t - 0.98) / 0.37);
}

function drawPlayerHair(ctx: CanvasRenderingContext2D, def: CharacterDef, hx: number, hy: number, r: number, animTimeMs: number, charge = 0): void {
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
      // `charge` is the rock chord standing it fully on end — the spikes
      // grow, straighten out of their usual lean and start to crackle.
      const spikes = 5;
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.55, hy - r * 0.7);
      for (let i = 0; i <= spikes; i++) {
        const p = i / spikes;
        const px = hx + lerp(-r * 0.55, r * 0.75, p);
        const buzz = charge > 0 ? Math.sin(t * 40 + i) * 0.12 * charge : 0;
        const spikeH = r * (0.85 + (i % 2 === 0 ? 0.35 : 0) + jitter * (1 - charge) + charge * 1.1 + buzz);
        ctx.lineTo(px, hy - r * 0.7 - spikeH);
        ctx.lineTo(px + r * 0.12, hy - r * 0.7);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (charge > 0.5) {
        // Static crackling off the tips once it is fully up.
        ctx.save();
        ctx.strokeStyle = `rgba(255,255,255,${(charge - 0.5) * 1.2})`;
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
          const a = t * 9 + i * 2.1;
          const bx = hx + Math.cos(a) * r * 0.7;
          const by = hy - r * 1.9 - Math.abs(Math.sin(a)) * r * 0.4;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a * 3) * 5, by - 4 - Math.abs(Math.sin(a * 2)) * 4);
          ctx.stroke();
        }
        ctx.restore();
      }
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
function drawPlayerFaceExtras(ctx: CanvasRenderingContext2D, def: CharacterDef, hx: number, hy: number, r: number, animTimeMs: number, mouthOpen = 0): void {
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
  // Bushy mustache under the nose. It rides up out of the way when the
  // mouth opens wide — left where it is, a white mustache sits right in
  // the middle of an open mouth full of white teeth and the two blend into
  // one unreadable smear.
  const mY = hy + r * (0.32 - mouthOpen * 0.28);
  ctx.fillStyle = '#e0e0e0';
  ctx.beginPath();
  ctx.moveTo(hx - r * 0.05, mY);
  ctx.quadraticCurveTo(hx + r * 0.25, mY - r * 0.14, hx + r * 0.6, mY + r * 0.02);
  ctx.quadraticCurveTo(hx + r * 0.28, mY + r * 0.18, hx - r * 0.05, mY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Section (quality pass): root-cause fix, not another eye bolted on top.
// The previous code gated drawing on `!pose.turnFlip`, but pose.turnFlip
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
// (still gated on the same pose.turnFlip threshold) — it only adds
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

type MouthShape = 'smile' | 'firm' | 'o' | 'worried' | 'grin' | 'gape';

interface Expression {
  browAngle: number; // 0 = relaxed; magnitude/sign shapes a "^" (determined/shocked) or softened brow
  browRaise: number; // 0..1 extra lift, e.g. surprise
  mouth: MouthShape;
  eyeWiden: number; // 0..1 extra eye-white scale (shock)
  lookY: number; // -1..1 extra pupil vertical offset (negative = look up)
  /** 0..1, only read by the 'gape' mouth: how far it is actually open, so
   * a mouth can be seen opening and closing over an animation instead of
   * snapping between two fixed drawings. */
  mouthOpen: number;
}

/** One state per anim (plus a low-health override for the otherwise-
 * neutral states) — matches the brief's list: idle/neutral, attack
 * (concentrated), hit (shocked), low health (worried), superpower
 * (confident/mischievous), taunt (laughing). Victory/defeat read through
 * the existing 'taunt'/'fallen'/'dead' anims rather than new ones, so no
 * gameplay state machine changes are needed. */
/** How wide the mouth is during the dentures spit, 0..1. Shared, because
 * more than the mouth reacts to it: the mustache has to ride up out of the
 * way too, or it sits in the middle of an open mouth. */
function dentureGape(f: Fighter): number {
  if (f.anim !== 'dentures') return 0;
  const t = f.animTimeMs / 1000;
  if (t < 0.2) return (t / 0.2) * 0.45;
  if (t < 0.44) return 0.45 + ((t - 0.2) / 0.24) * 0.55;
  if (t < 0.56) return 1;
  return Math.max(0.12, 1 - (t - 0.56) / 0.3);
}

function computeExpression(f: Fighter): Expression {
  switch (f.anim) {
    case 'attack':
    case 'kick':
      return { browAngle: 0.4, browRaise: 0, mouth: 'firm', eyeWiden: 0, lookY: 0, mouthOpen: 0 };
    case 'block':
      return { browAngle: 0.22, browRaise: 0, mouth: 'firm', eyeWiden: 0, lookY: 0, mouthOpen: 0 };
    case 'hit':
    case 'stagger':
    case 'knockback':
      return { browAngle: -0.35, browRaise: 0.8, mouth: 'o', eyeWiden: 0.6, lookY: 0, mouthOpen: 0 };
    case 'surprised':
      return { browAngle: -0.45, browRaise: 1, mouth: 'o', eyeWiden: 0.9, lookY: -0.7, mouthOpen: 0 };
    case 'dazed':
      return { browAngle: -0.25, browRaise: 0.5, mouth: 'worried', eyeWiden: 0.25, lookY: -0.3, mouthOpen: 0 };
    case 'fart':
    case 'superpower':
      return { browAngle: 0.18, browRaise: 0.2, mouth: 'grin', eyeWiden: 0, lookY: 0, mouthOpen: 0 };
    // The mouth IS the attack here, so it gets its own shape and its own
    // opening curve rather than one of the fixed faces: you have to see it
    // open, see the dentures sitting in it, and see them leave.
    case 'dentures':
      return { browAngle: 0.24, browRaise: 0.4, mouth: 'gape', eyeWiden: 0.25, lookY: 0, mouthOpen: dentureGape(f) };
    case 'annoyed':
      return { browAngle: 0.45, browRaise: 0, mouth: 'worried', eyeWiden: 0, lookY: 0, mouthOpen: 0 };
    case 'rockPose':
      return { browAngle: 0.5, browRaise: 0, mouth: 'o', eyeWiden: 0.2, lookY: -0.4, mouthOpen: 0 };
    case 'stomp':
      return { browAngle: 0.55, browRaise: 0, mouth: 'firm', eyeWiden: 0, lookY: 0, mouthOpen: 0 };
    case 'taunt':
      return { browAngle: 0.12, browRaise: 0.15, mouth: 'grin', eyeWiden: 0, lookY: 0, mouthOpen: 0 };
    case 'fallen':
    case 'gettingUp':
    case 'dead':
    case 'bossDeath':
      return { browAngle: -0.2, browRaise: 0, mouth: 'worried', eyeWiden: 0, lookY: 0, mouthOpen: 0 };
    default: {
      const lowHealth = f.maxHealth > 0 && f.health / f.maxHealth < 0.25;
      if (lowHealth) return { browAngle: -0.16, browRaise: 0.15, mouth: 'worried', eyeWiden: 0.1, lookY: 0, mouthOpen: 0 };
      return { browAngle: 0, browRaise: 0, mouth: 'smile', eyeWiden: 0, lookY: 0, mouthOpen: 0 };
    }
  }
}

function drawFace(ctx: CanvasRenderingContext2D, f: Fighter, hx: number, hy: number, r: number, pose: Pose, dtSec: number): void {
  if (pose.turnFlip > 0.5) return;
  // Fade the face out smoothly right around the turn instead of an abrupt
  // pop, since turnFlip itself now animates continuously through the
  // fart wind-up/return beats.
  const faceAlpha = 1 - Math.max(0, (pose.turnFlip - 0.3) / 0.2);
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
    case 'gape': {
      // A wide open mouth: dark cavity, a tongue at the bottom, and a lip
      // line around it. Drawn as an ellipse that grows with mouthOpen so
      // the opening reads as a motion rather than a swap between drawings.
      const open = Math.max(0, Math.min(1, expr.mouthOpen));
      const mw = 4 + open * 4.5;
      const mh = 1.6 + open * 7.5;
      const my = hy + 7 + open * 1.5;
      ctx.fillStyle = '#4a1f18';
      ctx.beginPath();
      ctx.ellipse(hx + 3, my, mw, mh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (open > 0.45) {
        ctx.fillStyle = '#d1636b';
        ctx.beginPath();
        ctx.ellipse(hx + 3, my + mh * 0.42, mw * 0.62, mh * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
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

// The shield used to be a small ellipse pinned to a fixed spot beside the
// hip, unconnected to anything the body was doing — it just hung there and
// slid around as the figure moved. It is now carried the way a shield
// actually is: strapped to the off-hand (the back arm, since the front hand
// holds the weapon), so it swings with that arm, and held out at the
// fighter's flank rather than flat across the chest, where it would hide
// the torso and face. Big oval body, riveted rim, a raised central boss and
// the arm strap visible where the forearm crosses behind it.
function drawShield(
  ctx: CanvasRenderingContext2D,
  f: Fighter,
  handX: number,
  handY: number,
  armDx: number,
  armDy: number,
  bw: number,
): void {
  // A bow is a two-handed weapon: no shield while it is drawn. Reads the
  // same shieldActive rule the defence bonus does, so what is on screen and
  // what the stats say can never disagree.
  if (!f.shieldActive) return;

  const scale = 0.9 + bw * 0.25;
  const rx = 10 * scale;
  const ry = 16 * scale;
  // A shield is strapped across the forearm, not dangled off the fist, so
  // it is centred a little way back up the arm from the hand rather than on
  // the hand itself — that is the span it actually covers, and it keeps the
  // shield moving with the arm as one piece.
  const cx = handX - armDx * 0.24;
  const cy = handY - armDy * 0.24;
  // And it stays close to upright. The face of a shield hangs vertically
  // whatever the arm is doing; letting it swing round with the arm angle
  // was most of why it read as an object stuck on at a random angle.
  const tilt = Math.max(-0.22, Math.min(0.22, Math.atan2(armDy, Math.abs(armDx) + 20) * 0.16));

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);

  // Body, lit from the top-left so it reads as a curved, domed face rather
  // than a flat disc.
  const face = ctx.createLinearGradient(-rx, -ry, rx, ry);
  face.addColorStop(0, '#8fa4ae');
  face.addColorStop(0.5, '#607d8b');
  face.addColorStop(1, '#3d5560');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rim.
  ctx.strokeStyle = '#2b3b43';
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx - 3, ry - 3, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Rivets around the rim.
  ctx.fillStyle = '#cfd8dc';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * (rx - 4.5), Math.sin(a) * (ry - 4.5), 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Raised central boss.
  const boss = ctx.createRadialGradient(-2, -3, 1, 0, 0, 7 * scale);
  boss.addColorStop(0, '#eceff1');
  boss.addColorStop(1, '#546e7a');
  ctx.fillStyle = boss;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6 * scale, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b3b43';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Highlight sweep.
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(-rx * 0.32, -ry * 0.12, rx * 0.42, ry * 0.55, 0.4, Math.PI * 0.85, Math.PI * 1.65);
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

// Gameplay/animation pass (point 10/11): the Ice-Furz is now a
// "Schnee-Kanonen-Furz" — the hit enemy must visibly stick out of a real
// snow pile (only head/hands showing), not just wear a translucent blue
// tint. Drawn as a lumpy mound of overlapping white drifts from the feet up
// to roughly chest height (well below shoulderY, so the head always stays
// clear), with a couple of embedded ice-crystal shards, a constant small
// shiver, and a few drifting snowflakes above — and it fades out over its
// last ~450ms instead of just vanishing, reading as the pile settling/
// collapsing rather than a hard cut.
export function drawSnowPile(ctx: CanvasRenderingContext2D, remainingMs: number, shoulderY: number, hipY: number, t: number): void {
  const fadeOut = Math.min(1, remainingMs / 450);
  const shiver = Math.sin(t * 26) * 1.4;
  const moundTop = hipY - 30; // stays well clear of the head/shoulders
  const moundBottom = hipY + 46;
  ctx.save();
  ctx.globalAlpha = 0.92 * fadeOut;
  ctx.translate(shiver, 0);
  ctx.fillStyle = '#f4fbff';
  ctx.strokeStyle = '#cfeeff';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-19, moundBottom);
  // Lumpy drift silhouette — several overlapping humps instead of one
  // smooth blob, so it reads as piled snow rather than a solid ice block.
  ctx.bezierCurveTo(-20, moundTop + 14, -14, moundTop - 2, -6, moundTop + 6);
  ctx.bezierCurveTo(-2, moundTop - 8, 4, moundTop - 6, 7, moundTop + 4);
  ctx.bezierCurveTo(13, moundTop - 4, 19, moundTop + 10, 19, moundTop + 16);
  ctx.lineTo(21, moundBottom);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // A couple of embedded ice-crystal shards poking out of the pile.
  ctx.fillStyle = 'rgba(179,229,252,0.85)';
  for (const [sx, sy, r] of [[-10, moundTop + 10, 5], [9, moundTop + 6, 6]] as const) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rr = i % 2 === 0 ? r : r * 0.5;
      const px = sx + Math.cos(a) * rr;
      const py = sy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Drifting snowflakes above the pile.
  ctx.fillStyle = `rgba(255,255,255,${0.85 * fadeOut})`;
  for (let i = 0; i < 4; i++) {
    const cycle = ((t * 0.5 + i * 0.27) % 1);
    const fx = -14 + i * 9 + Math.sin(t * 2 + i) * 3;
    const fy = shoulderY - 4 + cycle * (moundTop - shoulderY + 20);
    ctx.beginPath();
    ctx.arc(fx, fy, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Toilet-paper wrap. Drawn as a stack of individual bands spiralling up
 * the body — each one a separate visible strip with its own slight tilt and
 * a shaded underside, so you can actually count the layers rather than see
 * one white block. The wrap spools ON over the first ~320ms (bands appear
 * bottom-to-top, the way it was actually thrown), holds while the target
 * struggles, then tears open over the last ~350ms: the bands split apart at
 * the middle and their loose ends flap outwards. */
export function drawToiletPaperWrap(
  ctx: CanvasRenderingContext2D,
  remainingMs: number,
  totalMs: number,
  shoulderY: number,
  hipY: number,
  halfWidth: number,
  t: number,
): void {
  const total = Math.max(1, totalMs);
  const elapsed = total - remainingMs;
  const spoolOn = Math.max(0, Math.min(1, elapsed / 320));
  const tearOpen = Math.max(0, Math.min(1, (350 - remainingMs) / 350));

  const top = shoulderY + 4;
  const bottom = hipY + 34;
  const bandCount = 9;
  const bandH = (bottom - top) / bandCount;

  ctx.save();
  ctx.lineJoin = 'round';
  for (let i = 0; i < bandCount; i++) {
    // Bands land bottom-up as the roll is thrown around the target.
    const arrival = 1 - i / bandCount;
    if (spoolOn < arrival * 0.92) continue;

    const y = top + i * bandH;
    // Each band is its own strip: a small alternating tilt reads as paper
    // spiralling around the body rather than flat stacked rectangles.
    const tilt = Math.sin(i * 1.7) * 0.09;
    const w = halfWidth * (1 + Math.sin(i * 2.3) * 0.07);
    const gap = tearOpen * (6 + i * 1.6);
    const flap = Math.sin(t * 9 + i) * tearOpen * 5;

    ctx.save();
    ctx.translate(0, y + bandH / 2);
    ctx.rotate(tilt);
    // Left half of the band, sliding out as the wrap tears.
    ctx.fillStyle = i % 2 === 0 ? '#fdfdfd' : '#f1f1ee';
    ctx.strokeStyle = 'rgba(120,120,115,0.55)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.rect(-w - gap, -bandH * 0.42, w + flap * 0.5, bandH * 0.84);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(gap - flap * 0.5, -bandH * 0.42, w + flap * 0.5, bandH * 0.84);
    ctx.fill();
    ctx.stroke();
    // Shaded underside so the strip reads as wrapping around a body.
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(-w - gap, bandH * 0.22, (w + flap * 0.5) * 2 + gap * 2, bandH * 0.2);
    ctx.restore();
  }

  // The loose tail end of the roll, still trailing off the last band and
  // fluttering — the giveaway that this is paper and not a bandage.
  if (spoolOn > 0.85 && tearOpen < 0.9) {
    const tailY = top + bandH * 1.2;
    ctx.strokeStyle = '#fbfbf8';
    ctx.lineWidth = bandH * 0.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(halfWidth * 0.9, tailY);
    ctx.quadraticCurveTo(
      halfWidth * 1.5 + Math.sin(t * 6) * 4, tailY + 8,
      halfWidth * 1.9 + Math.sin(t * 6 + 1) * 7, tailY + 20 + Math.sin(t * 4) * 4,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawStatusOverlay(ctx: CanvasRenderingContext2D, f: Fighter, shoulderY: number, hipY: number): void {
  const s = f.status;
  const t = f.animTimeMs / 1000;
  if (f.wrappedUntilMs > 0) {
    drawToiletPaperWrap(ctx, f.wrappedUntilMs, f.wrappedTotalMs, shoulderY, hipY, 13, t);
  } else if (f.dazedUntilMs > 0) {
    drawCirclingBirds(ctx, f, shoulderY);
  } else if (s.frozenUntilMs > 0) {
    drawSnowPile(ctx, s.frozenUntilMs, shoulderY, hipY, t);
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

