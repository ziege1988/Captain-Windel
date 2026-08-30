import type { Vec2 } from '../types';

// 'flame' and 'shard' added for the chili/ice superpowers (see
// GameEngine.fireSuperpowerVisual) — chili must read as a real animated
// cartoon flame, never a colored blob/cloud, and ice must read as real
// crystals/shards, never a plain blue circle.
export type ParticleShape = 'circle' | 'ring' | 'dust' | 'spark' | 'cloud' | 'drop' | 'flame' | 'shard';

export interface Particle {
  pos: Vec2;
  vel: Vec2;
  life: number; // seconds remaining
  maxLife: number;
  size: number;
  color: string;
  shape: ParticleShape;
  gravity: number;
  fade: boolean;
  rotation: number;
  rotSpeed: number;
}

// Section 9/10/26: a single lightweight particle pool shared by every
// effect (hits, vomit, farts, weapon trails). Kept intentionally simple —
// no external effects library.
export class ParticleSystem {
  particles: Particle[] = [];
  private maxParticles = 260;

  spawn(p: Partial<Particle> & { pos: Vec2 }): void {
    if (this.particles.length >= this.maxParticles) this.particles.shift();
    this.particles.push({
      vel: { x: 0, y: 0 },
      life: 0.5,
      maxLife: 0.5,
      size: 6,
      color: '#ffffff',
      shape: 'circle',
      gravity: 0,
      fade: true,
      rotation: 0,
      rotSpeed: 0,
      ...p,
    });
  }

  burst(pos: Vec2, count: number, opts: Partial<Particle> = {}): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 160;
      this.spawn({
        pos: { x: pos.x, y: pos.y },
        vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed - 40 },
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        size: 3 + Math.random() * 5,
        gravity: 500,
        ...opts,
      });
    }
  }

  // Section (polish pass): burst() above is fully radial/omnidirectional —
  // fine for generic impacts, but superpowers that are meant to travel
  // toward the enemy (gas cloud drifting the way the character is oriented,
  // a flame jet with reach, an ice beam) need particles biased into a cone
  // around one direction instead of exploding outward evenly. `spreadRad`
  // is the half-angle of that cone in radians.
  burstDirectional(pos: Vec2, count: number, angle: number, spreadRad: number, opts: Partial<Particle> = {}): void {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * 2 * spreadRad;
      const speed = 90 + Math.random() * 160;
      this.spawn({
        pos: { x: pos.x, y: pos.y },
        vel: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
        life: 0.35 + Math.random() * 0.3,
        maxLife: 0.65,
        size: 4 + Math.random() * 5,
        gravity: 60,
        ...opts,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.rotation += p.rotSpeed * dt;
    }
  }

  clear(): void {
    this.particles.length = 0;
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = p.fade ? Math.max(0, p.life / p.maxLife) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      switch (p.shape) {
        case 'ring':
          ctx.lineWidth = Math.max(1, p.size * 0.35);
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'dust':
        case 'cloud':
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 1.3, p.size * 0.9, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'spark':
          ctx.fillRect(-p.size / 2, -1, p.size, 2);
          break;
        case 'drop':
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'flame': {
          // A real flame-lick silhouette (round base, flickering point)
          // instead of a plain colored oval — rotation is set once at
          // spawn to the aim direction (not spun via rotSpeed) so the
          // flame keeps pointing outward the whole time it flickers.
          const s = p.size;
          const flicker = Math.sin(p.pos.x * 0.5 + performance.now() / 50) * 0.18;
          ctx.beginPath();
          ctx.moveTo(-s * 0.5, s * 0.4);
          ctx.quadraticCurveTo(-s * 0.1, s * 0.7, s * 0.3, s * 0.15);
          ctx.quadraticCurveTo(s * (0.9 + flicker), s * 0.05, s * 1.3, 0);
          ctx.quadraticCurveTo(s * (0.9 + flicker), -s * 0.05, s * 0.3, -s * 0.15);
          ctx.quadraticCurveTo(-s * 0.1, -s * 0.7, -s * 0.5, -s * 0.4);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'shard': {
          // An angular ice-crystal silhouette instead of a plain circle —
          // free to actually tumble (rotSpeed), which reads well for ice.
          const s = p.size;
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.38, -s * 0.15);
          ctx.lineTo(s * 0.16, s * 0.95);
          ctx.lineTo(-s * 0.16, s * 0.95);
          ctx.lineTo(-s * 0.38, -s * 0.15);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = Math.max(0.6, s * 0.08);
          ctx.stroke();
          break;
        }
        default:
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
      }
      ctx.restore();
    }
  }
}
