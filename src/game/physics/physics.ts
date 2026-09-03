import { BALANCE } from '../../data/balance';
import type { Vec2 } from '../types';

// Section 8: simple, controlled, deliberately cartoonish 2D physics — not a
// full simulation. Every combat entity that needs position/velocity/gravity
// shares this body.
export interface PhysicsBody {
  pos: Vec2;
  vel: Vec2;
  grounded: boolean;
  groundY: number; // y coordinate representing "floor" for this entity
  /** The surface of the raised platform this body is currently standing on,
   * or null when it is on (or falling towards) the arena floor. Platforms
   * are one-way: you land on them from above and walk off the sides, and
   * jumping from underneath passes straight through — the Mario rule. */
  platformY?: number | null;
}

/** A raised ledge fighters can jump onto and fight on. */
export interface Platform {
  x: number; // left edge, world coords
  width: number;
  y: number; // the surface fighters stand on
}

/** The y a body is currently resting on: its platform if it has one, the
 * arena floor otherwise. Anything that positions something "at this
 * fighter's feet" wants this rather than groundY. */
export function floorY(body: PhysicsBody): number {
  return body.platformY ?? body.groundY;
}

export function createBody(x: number, y: number, groundY: number): PhysicsBody {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, grounded: y >= groundY, groundY, platformY: null };
}

export function stepPhysics(
  body: PhysicsBody,
  dtSec: number,
  arenaMinX: number,
  arenaMaxX: number,
  platforms: Platform[] = [],
): void {
  if (!body.grounded) {
    body.vel.y += BALANCE.physics.gravity * dtSec;
  }

  const prevY = body.pos.y;
  body.pos.x += body.vel.x * dtSec;
  body.pos.y += body.vel.y * dtSec;

  // Standing on a platform only lasts as long as you are actually over it —
  // walk off either end and you simply start falling, no extra input needed.
  if (body.platformY != null) {
    const still = platforms.find((p) => p.y === body.platformY && body.pos.x >= p.x - 6 && body.pos.x <= p.x + p.width + 6);
    if (!still) body.platformY = null;
  }

  if (body.pos.y >= body.groundY) {
    body.pos.y = body.groundY;
    if (body.vel.y > 0) body.vel.y = 0;
    body.grounded = true;
    body.platformY = null;
  } else {
    body.grounded = false;
    // One-way landing: only while descending, and only when the feet
    // crossed the surface during this step (so a jump from below passes
    // straight through instead of snagging on the underside).
    if (body.vel.y >= 0) {
      for (const p of platforms) {
        if (body.pos.x < p.x || body.pos.x > p.x + p.width) continue;
        if (prevY > p.y + 1 || body.pos.y < p.y) continue;
        body.pos.y = p.y;
        body.vel.y = 0;
        body.grounded = true;
        body.platformY = p.y;
        break;
      }
    }
    if (body.platformY != null && body.grounded) {
      body.pos.y = body.platformY;
    }
  }

  // Horizontal drag differs on ground vs air for a slightly floaty but
  // controllable arcade feel.
  body.vel.x *= body.grounded ? BALANCE.physics.groundFriction : BALANCE.physics.airDrag;
  if (Math.abs(body.vel.x) < 2) body.vel.x = 0;

  // Keep everyone inside the fixed arena — no side-scrolling (section 5).
  const half = 20;
  if (body.pos.x < arenaMinX + half) {
    body.pos.x = arenaMinX + half;
    body.vel.x = Math.max(0, body.vel.x);
  }
  if (body.pos.x > arenaMaxX - half) {
    body.pos.x = arenaMaxX - half;
    body.vel.x = Math.min(0, body.vel.x);
  }
}

// Only strong hits actually launch a fighter airborne — a light jab should
// just push/slide, not pop them off the ground. Otherwise every routine
// exchange would force a jump/fall pose that cancels whatever animation
// (including an in-flight attack) was already playing (section 8).
const AIRBORNE_LAUNCH_THRESHOLD = 60;

export function applyKnockback(body: PhysicsBody, dirX: number, strength: number, upward = 0.35): void {
  body.vel.x += dirX * strength;
  const verticalKick = strength * upward;
  if (verticalKick > AIRBORNE_LAUNCH_THRESHOLD) {
    body.vel.y -= verticalKick;
    body.grounded = false;
  }
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
