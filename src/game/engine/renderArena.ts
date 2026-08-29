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

  // Section (polish pass): purely decorative, theme-appropriate atmospheric
  // motion per arena palette — grass swaying in the wind, volcano smoke,
  // snowfall, drifting sand, rain, wisps, etc. None of this touches
  // gameplay/collision; it only reads timeSec, same as the clouds above.
  drawPaletteEffects(ctx, arena, layout, timeSec);

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

// Deterministic 0..1 pseudo-random value from an integer index — used
// throughout the effects below so every "random" tuft/flake/spark has a
// stable per-index phase/speed instead of jittering frame to frame, while
// still staying different from its neighbours (no state to store or grow).
function hash01(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function drawPaletteEffects(ctx: CanvasRenderingContext2D, arena: ArenaDef, layout: ArenaLayout, timeSec: number): void {
  const { width, groundY, height } = layout;
  switch (arena.palette) {
    case 'meadow':
    case 'darkMeadow':
    case 'forest':
      drawSwayingGrass(ctx, arena, layout, timeSec);
      break;
    case 'volcano':
      drawVolcanoEffects(ctx, width, groundY, timeSec);
      break;
    case 'ice':
      drawSnowfall(ctx, width, height, timeSec);
      break;
    case 'desert':
      drawDesertEffects(ctx, width, groundY, height, timeSec);
      break;
    case 'ruins':
      drawDustMotes(ctx, width, groundY, arena.accentColor, timeSec);
      break;
    case 'graveyard':
      drawWisps(ctx, width, groundY, height, timeSec);
      break;
    case 'storm':
      drawRain(ctx, width, height, timeSec);
      break;
    case 'chaos':
      drawChaosSparkles(ctx, width, groundY, height, timeSec);
      break;
    default:
      break;
  }
}

// Grass/meadow requirement (section 4): every tuft sways with its own
// phase/speed (derived from a per-tuft hash, not from its index directly)
// so the field doesn't move as one uniform block, movement stays slow and
// subtle, and it briefly intensifies during periodic gusts.
function drawSwayingGrass(ctx: CanvasRenderingContext2D, arena: ArenaDef, layout: ArenaLayout, timeSec: number): void {
  const { width, groundY, height } = layout;
  const gust = Math.max(0, Math.sin(timeSec * 0.12)) ** 5; // rare, brief, gentle gust
  const color = arena.isDark ? 'rgba(140,180,120,0.35)' : 'rgba(30,70,25,0.4)';
  const count = 24;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const h1 = hash01(i);
    const h2 = hash01(i + 97);
    const gx = h1 * width;
    const gy = groundY + 10 + h2 * Math.min(60, height - groundY - 20);
    const speed = 0.7 + h2 * 0.6;
    const phase = h1 * Math.PI * 2;
    const amp = 2.2 + h2 * 1.6 + gust * 3.5;
    const sway = Math.sin(timeSec * speed + phase) * amp;
    const bladeH = 9 + h1 * 6;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.quadraticCurveTo(gx + sway * 0.55, gy - bladeH * 0.6, gx + sway, gy - bladeH);
    ctx.stroke();
  }
  ctx.restore();
}

function drawVolcanoEffects(ctx: CanvasRenderingContext2D, width: number, groundY: number, timeSec: number): void {
  const coneX = width * 0.78;
  const coneTopY = groundY * 0.08;
  ctx.save();
  // Distant volcano silhouette.
  ctx.fillStyle = 'rgba(30,10,8,0.55)';
  ctx.beginPath();
  ctx.moveTo(coneX - 70, groundY * 0.42);
  ctx.lineTo(coneX, coneTopY);
  ctx.lineTo(coneX + 70, groundY * 0.42);
  ctx.closePath();
  ctx.fill();

  // Slow-drifting smoke puffs from the crater, purely atmospheric.
  ctx.fillStyle = 'rgba(90,90,90,0.28)';
  for (let i = 0; i < 4; i++) {
    const p = ((timeSec * 6 + i * 30) % 120) / 120;
    const px = coneX + Math.sin(i * 2.1) * 14 + p * 26;
    const py = coneTopY - p * 60;
    ctx.beginPath();
    ctx.arc(px, py, 10 + p * 16, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rising embers/sparks.
  ctx.fillStyle = '#ff8a50';
  for (let i = 0; i < 10; i++) {
    const h1 = hash01(i + 500);
    const p = ((timeSec * (14 + h1 * 10) + h1 * 200) % 200) / 200;
    const ex = coneX - 40 + h1 * 80 + Math.sin(timeSec * 2 + i) * 6;
    const ey = groundY * 0.42 - p * groundY * 0.42;
    ctx.globalAlpha = 1 - p;
    ctx.beginPath();
    ctx.arc(ex, ey, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSnowfall(ctx: CanvasRenderingContext2D, width: number, height: number, timeSec: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const count = 26;
  for (let i = 0; i < count; i++) {
    const h1 = hash01(i + 1000);
    const h2 = hash01(i + 2000);
    const fallSpeed = 22 + h2 * 30;
    const y = (timeSec * fallSpeed + h1 * height) % (height + 20) - 10;
    const drift = Math.sin(timeSec * (0.6 + h2 * 0.8) + h1 * 10) * 14;
    const x = (h1 * width + drift + width) % width;
    ctx.beginPath();
    ctx.arc(x, y, 1.4 + h2 * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDesertEffects(ctx: CanvasRenderingContext2D, width: number, groundY: number, height: number, timeSec: number): void {
  ctx.save();
  // Drifting dust/sand near the ground.
  ctx.fillStyle = 'rgba(220,180,110,0.35)';
  for (let i = 0; i < 14; i++) {
    const h1 = hash01(i + 3000);
    const h2 = hash01(i + 4000);
    const x = ((timeSec * (16 + h2 * 18) + h1 * width) % (width + 40)) - 20;
    const y = groundY + 8 + h2 * Math.min(40, height - groundY - 20);
    ctx.beginPath();
    ctx.arc(x, y, 1.3 + h2 * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // Faint heat shimmer just above the horizon — thin wavy translucent bands.
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const y = groundY - 6 - i * 8;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 20) {
      const wy = y + Math.sin(x * 0.05 + timeSec * 2 + i) * 2;
      if (x === 0) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawDustMotes(ctx: CanvasRenderingContext2D, width: number, groundY: number, accentColor: string, timeSec: number): void {
  ctx.save();
  ctx.fillStyle = accentColor;
  for (let i = 0; i < 12; i++) {
    const h1 = hash01(i + 5000);
    const h2 = hash01(i + 6000);
    const riseSpeed = 8 + h2 * 10;
    const y = groundY - ((timeSec * riseSpeed + h1 * 200) % 200);
    const x = h1 * width + Math.sin(timeSec * 0.5 + h2 * 8) * 10;
    ctx.globalAlpha = 0.25 * (1 - Math.max(0, (groundY - y) / 200));
    ctx.beginPath();
    ctx.arc(x, y, 1 + h2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWisps(ctx: CanvasRenderingContext2D, width: number, groundY: number, height: number, timeSec: number): void {
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const h1 = hash01(i + 7000);
    const h2 = hash01(i + 8000);
    const x = h1 * width + Math.sin(timeSec * 0.3 + h2 * 6) * 20;
    const y = groundY - 20 - h2 * Math.min(70, height * 0.2) + Math.sin(timeSec * 0.8 + h1 * 6) * 6;
    const glow = 0.4 + Math.sin(timeSec * 1.6 + h1 * 10) * 0.25;
    ctx.fillStyle = `rgba(140,220,160,${Math.max(0.1, glow).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRain(ctx: CanvasRenderingContext2D, width: number, height: number, timeSec: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(200,220,255,0.35)';
  ctx.lineWidth = 1.4;
  const count = 34;
  for (let i = 0; i < count; i++) {
    const h1 = hash01(i + 9000);
    const h2 = hash01(i + 9500);
    const fallSpeed = 520 + h2 * 200;
    const y = (timeSec * fallSpeed + h1 * height) % (height + 20) - 10;
    const x = (h1 * width + timeSec * 40) % width;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 6, y + 16);
    ctx.stroke();
  }
  ctx.restore();
}

function drawChaosSparkles(ctx: CanvasRenderingContext2D, width: number, groundY: number, height: number, timeSec: number): void {
  ctx.save();
  const colors = ['#e040fb', '#7c4dff', '#ff4081', '#69f0ae'];
  for (let i = 0; i < 16; i++) {
    const h1 = hash01(i + 10000);
    const h2 = hash01(i + 11000);
    const orbitR = 20 + h2 * 40;
    const cx = h1 * width;
    const cy = groundY - h2 * Math.min(180, height * 0.4);
    const a = timeSec * (0.5 + h2) + h1 * Math.PI * 2;
    const x = cx + Math.cos(a) * orbitR * 0.2;
    const y = cy + Math.sin(a) * orbitR * 0.2;
    ctx.globalAlpha = 0.5 + Math.sin(timeSec * 3 + h1 * 10) * 0.3;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
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
