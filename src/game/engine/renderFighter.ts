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
    case 'fart':
      return {
        ...STAND, turnedAway: 1, bodyLean: 0.3, hipY: 10,
        armFrontX: -16, armFrontY: 14, armBackX: -16, armBackY: 14,
        capeKick: Math.min(1, t / 0.3),
      };
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

/** Draws Captain Windel / an enemy / a boss as a minimalist stick figure
 * with an animated cape and layered visual equipment (section 6/21). The
 * figure is always instantly readable as a stickman — spectacle comes from
 * effects layered around it, not from the figure itself (section 47/63). */
export function renderFighter(ctx: CanvasRenderingContext2D, f: Fighter): void {
  if (f.deathPhase === 'done') return;
  const pose = computePose(f);
  const scale = f.scale;
  const x = f.body.pos.x;
  const groundY = f.body.groundY;
  const airLift = groundY - f.body.pos.y;

  ctx.save();
  ctx.translate(x, groundY - airLift);
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

  // Back arm (behind torso).
  drawArm(ctx, shoulderX, shoulderY, pose.armBackX, pose.armBackY, f, false);

  // Head.
  ctx.beginPath();
  ctx.fillStyle = f.color;
  ctx.arc(shoulderX + headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  drawHeadAccessories(ctx, f, shoulderX + headX, headY, headR);

  if (!pose.turnedAway) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    const eyeX = 4;
    ctx.beginPath();
    ctx.arc(shoulderX + headX + eyeX, headY - 1, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(shoulderX + headX + eyeX + 1, headY - 1, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Front arm (in front of torso, holds weapon).
  drawArm(ctx, shoulderX, shoulderY, pose.armFrontX, pose.armFrontY, f, true);
  drawWeaponInHand(ctx, f, shoulderX + pose.armFrontX, shoulderY + pose.armFrontY);

  drawFeetAccessories(ctx, f, pose, hipY);

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

function drawWeaponInHand(ctx: CanvasRenderingContext2D, f: Fighter, handX: number, handY: number): void {
  if (f.weaponId === 'fists') return;
  const weapon = WEAPONS[f.weaponId];
  const len = weapon.shape === 'thrust' ? 30 : weapon.shape === 'ranged' ? 18 : 20;
  ctx.save();
  ctx.strokeStyle = weapon.color;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(handX + len, handY - 4);
  ctx.stroke();
  if (weapon.id === 'frypan') {
    ctx.fillStyle = weapon.color;
    ctx.beginPath();
    ctx.arc(handX + len, handY - 4, 9, 0, Math.PI * 2);
    ctx.fill();
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
