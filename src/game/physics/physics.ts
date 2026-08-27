import { BALANCE } from '../../data/balance';
import type { Vec2 } from '../types';

// Section 8: simple, controlled, deliberately cartoonish 2D physics — not a
// full simulation. Every combat entity that needs position/velocity/gravity
// shares this body.
export interface PhysicsBody {
  pos: Vec2;
  vel: Vec2;
  grounded: boolean;
  groundY: number; // the y coordinate representing "floor" for this entity
}

export function createBody(x: number, y: number, groundY: number): PhysicsBody {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, grounded: y >= groundY, groundY };
}

export function stepPhysics(body: PhysicsBody, dtSec: number, arenaMinX: number, arenaMaxX: number): void {
  if (!body.grounded) {
    body.vel.y += BALANCE.physics.gravity * dtSec;
  }

  body.pos.x += body.vel.x * dtSec;
  body.pos.y += body.vel.y * dtSec;

  if (body.pos.y >= body.groundY) {
    body.pos.y = body.groundY;
    if (body.vel.y > 0) body.vel.y = 0;
    body.grounded = true;
  } else {
    body.grounded = false;
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
