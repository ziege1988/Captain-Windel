import type { ArenaDef } from '../types';

export interface ArenaLayout {
  width: number;
  height: number;
  groundY: number; // y coordinate of the ground line
  minX: number;
  maxX: number;
}

let lightningFlash = 0;
let lightningTimer = 2 + Math.random() * 3;

// Section 4/14/37: purely data-driven background painter. One generic
// routine renders every arena chapter using its colour/flag fields, plus
// light decorative variation (trees/clouds/flowers vs. dead trees/fog/moon)
// switched on `isDark`.
export function renderArena(ctx: CanvasRenderingContext2D, arena: ArenaDef, layout: ArenaLayout, timeSec: number): void {
  const { width, height, groundY } = layout;

  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, arena.skyTop);
  sky.addColorStop(1, arena.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  if (arena.isDark) {
    // Moon
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#f5f3e7';
    ctx.beginPath();
    ctx.arc(width * 0.8, height * 0.16, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    // Sun
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#fff59d';
    ctx.beginPath();
    ctx.arc(width * 0.85, height * 0.14, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Clouds drifting slowly.
  ctx.save();
  ctx.globalAlpha = arena.isDark ? 0.25 : 0.85;
  ctx.fillStyle = arena.isDark ? '#4a4a5c' : '#ffffff';
  for (let i = 0; i < 4; i++) {
    const cx = ((timeSec * (10 + i * 4) + i * 220) % (width + 200)) - 100;
    const cy = height * (0.1 + i * 0.05);
    drawCloud(ctx, cx, cy, 30 + i * 6);
  }
  ctx.restore();

  if (arena.hasLightning) {
    lightningTimer -= 1 / 60;
    if (lightningTimer <= 0 && lightningFlash <= 0) {
      lightningFlash = 6;
      lightningTimer = 2 + Math.random() * 4;
    }
    if (lightningFlash > 0) {
      ctx.save();
      ctx.globalAlpha = lightningFlash / 12;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      lightningFlash -= 1;
    }
  }

  // Trees along the edges.
  const treeColor = arena.isDark ? '#14211a' : arena.palette === 'volcano' ? '#3a1f14' : '#2d4a25';
  drawTree(ctx, width * 0.06, groundY, 90, treeColor, arena.isDark);
  drawTree(ctx, width * 0.15, groundY, 70, treeColor, arena.isDark);
  drawTree(ctx, width * 0.94, groundY, 95, treeColor, arena.isDark);
  drawTree(ctx, width * 0.86, groundY, 65, treeColor, arena.isDark);

  // Ground.
  const groundGrad = ctx.createLinearGradient(0, groundY, 0, height);
  groundGrad.addColorStop(0, arena.groundColor);
  groundGrad.addColorStop(1, arena.groundColor2);
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, groundY, width, height - groundY);

  // Small decorative flowers / rocks depending on palette.
  if (!arena.isDark && (arena.palette === 'meadow' || arena.palette === 'forest')) {
    for (let i = 0; i < 8; i++) {
      const fx = (i * 97 + 40) % width;
      const fy = groundY + 18 + ((i * 53) % (height - groundY - 30));
      drawFlower(ctx, fx, fy, arena.accentColor);
    }
  }

  if (arena.hasFog) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      const fx = ((timeSec * 14 + i * 260) % (width + 300)) - 150;
      ctx.beginPath();
      ctx.ellipse(fx, groundY - 10, 180, 30, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Ground line accent.
  ctx.strokeStyle = arena.accentColor;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, size, size * 0.6, 0, 0, Math.PI * 2);
  ctx.ellipse(x + size * 0.6, y + size * 0.1, size * 0.7, size * 0.45, 0, 0, Math.PI * 2);
  ctx.ellipse(x - size * 0.6, y + size * 0.15, size * 0.6, size * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, groundY: number, height: number, color: string, dark: boolean): void {
  ctx.save();
  ctx.strokeStyle = dark ? '#0d0d0d' : '#4a2f1a';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(x, groundY);
  ctx.lineTo(x, groundY - height * 0.5);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, groundY - height * 0.5, height * 0.4, 0, Math.PI * 2);
  ctx.arc(x - height * 0.22, groundY - height * 0.38, height * 0.28, 0, Math.PI * 2);
  ctx.arc(x + height * 0.22, groundY - height * 0.38, height * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff176';
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
