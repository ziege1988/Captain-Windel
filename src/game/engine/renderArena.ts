import type { ArenaDef } from '../types';
import { getSceneWeather, setSceneWeather, WEATHERS, type WeatherState } from './weather';
import type { Platform } from '../physics/physics';

export interface ArenaLayout {
  width: number;
  height: number;
  groundY: number; // y coordinate of the ground line
  minX: number;
  maxX: number;
  /** Width of the slice of the arena actually on screen. Defaults to the
   * full width for callers (the menu background) whose whole world fits. */
  viewWidth?: number;
  /** Left edge of that slice in world coordinates. */
  cameraX?: number;
  /** Raised jump-through ledges fighters can stand and fight on. */
  platforms?: Platform[];
}

let lightningFlash = 0;
let lightningTimer = 2 + Math.random() * 3;

// Section 4/14/37: purely data-driven background painter. One generic
// routine renders every arena chapter using its colour/flag fields, plus
// light decorative variation (trees/clouds/flowers vs. dead trees/fog/moon)
// switched on `isDark`.
export function renderArena(
  ctx: CanvasRenderingContext2D,
  arena: ArenaDef,
  layout: ArenaLayout,
  timeSec: number,
  weather: WeatherState = WEATHERS.clear,
): void {
  const { width, height, groundY } = layout;
  // Everything below is drawn in world coordinates. Sky elements (sun,
  // moon, clouds, precipitation) belong to the visible window rather than
  // to a fixed spot in an arena twice as wide as the screen, so they are
  // placed relative to the camera; the ground and its scenery stay put in
  // the world and scroll past.
  const viewW = layout.viewWidth ?? width;
  const camX = layout.cameraX ?? 0;
  setSceneWeather(weather);

  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, arena.skyTop);
  sky.addColorStop(1, arena.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Overcast: the arena's own sky colours pulled towards flat grey rather
  // than replaced, so a volcano under cloud still reads as a volcano.
  if (weather.darken > 0) {
    ctx.save();
    ctx.globalAlpha = weather.darken;
    const murk = ctx.createLinearGradient(0, 0, 0, groundY);
    murk.addColorStop(0, arena.isDark ? '#0b0d14' : '#4d5560');
    murk.addColorStop(1, arena.isDark ? '#151823' : '#8b929a');
    ctx.fillStyle = murk;
    ctx.fillRect(0, 0, width, groundY + 4);
    ctx.restore();
  }

  // Sun / moon, dimmed by the cloud cover in front of it.
  const skyBodyX = camX + viewW * (arena.isDark ? 0.8 : 0.85);
  ctx.save();
  ctx.globalAlpha = (arena.isDark ? 0.9 : 0.85) * (1 - weather.cloudCover * 0.85);
  ctx.fillStyle = arena.isDark ? '#f5f3e7' : '#fff59d';
  ctx.beginPath();
  ctx.arc(skyBodyX, height * (arena.isDark ? 0.16 : 0.14), arena.isDark ? 34 : 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Clouds. Both how many there are and how heavy they look come from the
  // weather; in a storm they are near-black and stacked low.
  const cloudCount = Math.round(3 + weather.cloudCover * 6);
  const cloudDrift = 10 + weather.wind * 8;
  ctx.save();
  ctx.globalAlpha = arena.isDark ? 0.25 + weather.cloudCover * 0.35 : 0.55 + weather.cloudCover * 0.4;
  ctx.fillStyle = weather.darken > 0.45
    ? '#454b55'
    : weather.darken > 0.2 ? '#9aa2ab' : (arena.isDark ? '#4a4a5c' : '#ffffff');
  for (let i = 0; i < cloudCount; i++) {
    const span = viewW + 260;
    const cx = camX - 130 + ((timeSec * (cloudDrift + i * 4) + i * 197) % span);
    const cy = height * (0.07 + (i % 4) * 0.05) + hash01(i + 77000) * 14;
    drawCloud(ctx, cx, cy, 28 + (i % 5) * 7 + weather.cloudCover * 10);
  }
  ctx.restore();

  // Distant sheet lightning. The bolts that can actually hit a fighter are
  // gameplay and live in GameEngine; this is only the sky flashing.
  if (arena.hasLightning || weather.lightning) {
    lightningTimer -= 1 / 60;
    if (lightningTimer <= 0 && lightningFlash <= 0) {
      lightningFlash = 6;
      lightningTimer = 2 + Math.random() * 4;
    }
    if (lightningFlash > 0) {
      ctx.save();
      ctx.globalAlpha = lightningFlash / 12;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(camX - 20, 0, viewW + 40, height);
      ctx.restore();
      lightningFlash -= 1;
    }
  }

  // Trees along the ground. Scaled with the arena's real width so the
  // doubled arena is populated at the same density as one screenful used
  // to be, rather than four lonely trees spread across the whole thing.
  const treeColor = arena.isDark ? '#14211a' : arena.palette === 'volcano' ? '#3a1f14' : '#2d4a25';
  const treeCount = Math.max(4, Math.round((width / 630) * 4));
  for (let i = 0; i < treeCount; i++) {
    const h1 = hash01(i + 61000);
    const h2 = hash01(i + 62000);
    // Kept out of the middle third of each screenful so trees never sit
    // directly behind the fighters.
    const tx = ((i + 0.15 + h1 * 0.7) / treeCount) * width;
    drawTree(ctx, tx, groundY, 62 + h2 * 36, treeColor, arena.isDark);
  }

  // Ground.
  const groundGrad = ctx.createLinearGradient(0, groundY, 0, height);
  groundGrad.addColorStop(0, arena.groundColor);
  groundGrad.addColorStop(1, arena.groundColor2);
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, groundY, width, height - groundY);

  // Small decorative flowers, scattered irregularly across the meadow (a
  // fixed-multiplier formula reads as a visible grid once you look for it)
  // and swaying in the same wind as the grass beside them instead of
  // standing perfectly still.
  if (!arena.isDark && (arena.palette === 'meadow' || arena.palette === 'forest')) {
    const flowerGust = windGust(timeSec);
    const flowerCount = Math.max(14, Math.round((width / 630) * 14));
    for (let i = 0; i < flowerCount; i++) {
      const h1 = hash01(i + 40000);
      const h2 = hash01(i + 41000);
      const h3 = hash01(i + 42000);
      const h4 = hash01(i + 43000);
      const fx = ((i + h1) / flowerCount) * width;
      const fy = groundY + 14 + h2 * Math.min(70, height - groundY - 24);
      const speed = 0.9 + h3 * 0.8;
      const phase = h1 * Math.PI * 2;
      const swayPx = Math.sin(timeSec * speed + phase) * (1.5 + h4 * 2.5 + flowerGust * 5);
      const size = 0.75 + h3 * 0.55;
      drawFlower(ctx, fx, fy, arena.accentColor, swayPx, size);
    }
  }

  // Section (polish pass): purely decorative, theme-appropriate atmospheric
  // motion per arena palette — grass swaying in the wind, volcano smoke,
  // snowfall, drifting sand, rain, wisps, etc. None of this touches
  // gameplay/collision; it only reads timeSec, same as the clouds above.
  drawPaletteEffects(ctx, arena, layout, timeSec);

  // Weather sits on top of the arena's own palette effects: rain and blown
  // leaves fall through the visible window wherever the camera happens to
  // be, so they never thin out at one end of a scrolling arena.
  drawWeatherEffects(ctx, layout, timeSec, weather);

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

  for (const p of layout.platforms ?? []) drawPlatform(ctx, arena, p, groundY, timeSec, weather);
}

// The upper level: not a built structure but a chunk of the arena floor
// itself, torn out and left hanging in the air. Grass and flowers still
// grow on top; the underside is raw earth that breaks off in an uneven,
// crumbling edge, with loose clods and dangling roots drifting beneath it.
// Nothing holds it up and nothing reaches the ground, so a fighter can run
// straight past underneath — the only way onto it is a jump.
function drawPlatform(
  ctx: CanvasRenderingContext2D,
  arena: ArenaDef,
  p: Platform,
  groundY: number,
  timeSec: number,
  weather: WeatherState,
): void {
  const dark = arena.isDark;
  const grassBand = 9;      // the turf still growing on top
  // A bigger chunk of ground is a thicker chunk of ground: the body of soil
  // and the length of the broken spikes both scale with how wide the island
  // is, or a wide one would read as a thin fringe hanging off a green line
  // rather than as a slab torn out of the earth.
  const soilDepth = 34 + Math.min(38, p.width * 0.05);
  const seed = Math.round(p.x);

  ctx.save();

  // --- The torn underside -------------------------------------------------
  // A run of downward points of wildly different depth, so the break reads
  // as something ripped loose rather than a cut slab. Depths come from the
  // per-index hash, so the silhouette is stable frame to frame while every
  // chunk in the arena tears differently.
  // The broken edge is a wandering line of points at wildly different
  // depths and irregular spacing, drawn through midpoint curves so it comes
  // out lumpy and crumbled rather than as an even row of saw teeth. Every
  // value comes from the per-index hash, so the silhouette is identical
  // frame to frame while each island in the arena breaks differently.
  // Feature size, not feature count, is what has to stay constant: spacing
  // the break points by a fixed distance keeps the clods roughly the same
  // size on a big island as on a small one.
  const steps = Math.max(9, Math.round(p.width / 38));
  const breakPoint = (i: number): { x: number; y: number } => {
    const h1 = hash01(seed + i * 7 + 101);
    const h2 = hash01(seed + i * 13 + 907);
    const h3 = hash01(seed + i * 19 + 31);
    // Deepest towards the middle, shallow at the ends: an island underside,
    // not a uniform fringe.
    const k = i / steps;
    const mid = 1 - Math.abs(k * 2 - 1);
    // Occasional long spike hanging much further down than its neighbours.
    const spike = h3 > 0.8 ? soilDepth * (0.5 + h3 * 0.7) : 0;
    const depth = soilDepth * (0.45 + mid * 0.55) + h1 * soilDepth * 0.45 * (0.3 + mid) + spike;
    const jitter = (h2 - 0.5) * (p.width / steps) * 0.75;
    return { x: p.x + p.width * k + jitter, y: p.y + depth };
  };
  const toothDepth = (i: number): number => breakPoint(Math.max(0, Math.min(steps, i))).y - p.y;

  const bottomPath = () => {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.width, p.y);
    let prev = { x: p.x + p.width, y: p.y + soilDepth * 0.4 };
    ctx.lineTo(prev.x, prev.y);
    for (let i = steps; i >= 0; i--) {
      const pt = breakPoint(i);
      // Straight segments, not curves: torn earth breaks along hard facets,
      // and smoothing the corners made the underside read as dripping wax.
      // Between every pair of points the edge climbs back up by a random
      // amount, so the profile is a run of uneven chunks and hollows rather
      // than one continuous sag.
      const hn = hash01(seed + i * 37 + 211);
      const notchX = (prev.x + pt.x) / 2 + (hash01(seed + i * 47) - 0.5) * 8;
      const notchY = p.y + soilDepth * (0.22 + hn * 0.5);
      ctx.lineTo(notchX, notchY);
      ctx.lineTo(pt.x, pt.y);
      prev = pt;
    }
    ctx.lineTo(p.x, p.y + soilDepth * 0.4);
    ctx.closePath();
  };

  // Earth body: dark and damp at the broken edge, drier towards the turf.
  const soil = ctx.createLinearGradient(0, p.y, 0, p.y + soilDepth + 30);
  soil.addColorStop(0, dark ? '#4a3a2a' : '#8a6239');
  soil.addColorStop(0.45, dark ? '#33281c' : '#6b4a2a');
  soil.addColorStop(1, dark ? '#1d1711' : '#3f2b18');
  ctx.fillStyle = soil;
  bottomPath();
  ctx.fill();

  // Embedded stones and darker soil pockets, clipped to the chunk so
  // nothing spills outside its silhouette.
  ctx.save();
  bottomPath();
  ctx.clip();
  for (let i = 0; i < Math.round(p.width / 12); i++) {
    const h1 = hash01(seed + i * 17 + 5);
    const h2 = hash01(seed + i * 23 + 55);
    const h3 = hash01(seed + i * 29 + 555);
    ctx.fillStyle = h3 > 0.65
      ? (dark ? 'rgba(150,145,135,0.5)' : 'rgba(190,180,165,0.55)')
      : 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(
      p.x + h1 * p.width,
      p.y + grassBand + h2 * (soilDepth + 18),
      1.6 + h3 * 3.4, 1.2 + h3 * 2.4,
      h1 * Math.PI, 0, Math.PI * 2,
    );
    ctx.fill();
  }
  // Roots hanging down out of the turf into the soil.
  ctx.strokeStyle = dark ? 'rgba(220,210,190,0.25)' : 'rgba(240,225,195,0.35)';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  for (let i = 0; i < Math.round(p.width / 18); i++) {
    const h1 = hash01(seed + i * 41 + 9);
    const h2 = hash01(seed + i * 43 + 99);
    const rx = p.x + h1 * p.width;
    const len = 10 + h2 * (18 + soilDepth * 0.5);
    ctx.beginPath();
    ctx.moveTo(rx, p.y + grassBand);
    ctx.quadraticCurveTo(rx + (h2 - 0.5) * 10, p.y + grassBand + len * 0.6, rx + (h1 - 0.5) * 14, p.y + grassBand + len);
    ctx.stroke();
  }
  ctx.restore();

  // --- The turf on top ----------------------------------------------------
  const turf = ctx.createLinearGradient(0, p.y - 1, 0, p.y + grassBand + 6);
  turf.addColorStop(0, arena.groundColor);
  turf.addColorStop(1, arena.groundColor2);
  ctx.fillStyle = turf;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 1);
  ctx.lineTo(p.x + p.width, p.y - 1);
  // The turf/soil boundary dips and rises rather than being a ruled line —
  // grass roots do not stop at a neat depth.
  for (let i = steps; i >= 0; i--) {
    const x = p.x + (p.width * i) / steps;
    ctx.lineTo(x, p.y + grassBand + hash01(seed + i * 11 + 611) * 6 - 2);
  }
  ctx.closePath();
  ctx.fill();
  // A lit top edge, so where you actually land is unmistakable.
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(p.x + 2, p.y);
  ctx.lineTo(p.x + p.width - 2, p.y);
  ctx.stroke();
  // Ragged turf overhanging the broken edges left and right.
  ctx.fillStyle = arena.groundColor2;
  for (const [ex, dir] of [[p.x, -1], [p.x + p.width, 1]] as [number, number][]) {
    ctx.beginPath();
    ctx.moveTo(ex, p.y - 1);
    ctx.lineTo(ex + dir * 5, p.y + 2);
    ctx.lineTo(ex + dir * 2, p.y + grassBand + 3);
    ctx.lineTo(ex, p.y + grassBand);
    ctx.closePath();
    ctx.fill();
  }

  // --- Loose clods drifting under the island ------------------------------
  // These are what actually sell "floating": the chunk itself has to stay
  // still (it is a collision surface), so the sense of hanging in the air
  // comes from the debris bobbing slowly in its shadow.
  const clods = Math.max(3, Math.round(p.width / 42));
  ctx.fillStyle = dark ? '#2b2219' : '#5c3f24';
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  for (let i = 0; i < clods; i++) {
    const h1 = hash01(seed + i * 53 + 3);
    const h2 = hash01(seed + i * 59 + 33);
    const h3 = hash01(seed + i * 61 + 333);
    const cx = p.x + p.width * (0.08 + h1 * 0.84);
    const drift = Math.sin(timeSec * (0.5 + h2 * 0.6) + h1 * 8) * (3 + h3 * 4);
    const cy = p.y + soilDepth + 16 + h2 * (46 + soilDepth * 0.4) + drift;
    const r = 3 + h3 * 6.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(timeSec * (0.2 + h3 * 0.5) + h1 * 6);
    ctx.beginPath();
    // A lumpy, deliberately non-round clod.
    ctx.moveTo(-r, 0);
    ctx.quadraticCurveTo(-r * 0.7, -r * 1.1, 0, -r * 0.8);
    ctx.quadraticCurveTo(r * 0.9, -r * 0.9, r, r * 0.1);
    ctx.quadraticCurveTo(r * 0.5, r, -r * 0.2, r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Grass tufts and the odd flower growing over the front lip, swaying on
  // the same wind as the meadow below.
  if (!dark && (arena.palette === 'meadow' || arena.palette === 'forest')) {
    const gust = windGust(timeSec);
    ctx.strokeStyle = 'rgba(32,80,26,0.6)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    const tufts = Math.max(8, Math.round(p.width / 16));
    for (let i = 0; i < tufts; i++) {
      const h1 = hash01(i + seed + 71000);
      const h2 = hash01(i + seed + 72000);
      const bx = p.x + ((i + h1) / tufts) * p.width;
      const len = 5 + h2 * 8;
      const sway = Math.sin(timeSec * (1.1 + h2) + h1 * 7) * (1.5 + gust * 4);
      ctx.beginPath();
      ctx.moveTo(bx, p.y);
      ctx.quadraticCurveTo(bx + sway * 0.5, p.y - len * 0.6, bx + sway, p.y - len);
      ctx.stroke();
    }
    for (let i = 0; i < 3; i++) {
      const h1 = hash01(i + seed + 74000);
      const h2 = hash01(i + seed + 75000);
      const fx = p.x + (0.15 + h1 * 0.7) * p.width;
      const sway = Math.sin(timeSec * (0.9 + h2 * 0.8) + h1 * 6) * (1.5 + gust * 5);
      drawFlower(ctx, fx, p.y - 8, arena.accentColor, sway, 0.6 + h2 * 0.3);
    }
  }

  // In the wet, water runs off the broken edge and drips into the air.
  if (weather.rain > 0.4) {
    ctx.strokeStyle = `rgba(200,225,255,${0.32 * weather.rain})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const h1 = hash01(i + seed + 73000);
      const cycle = (timeSec * (1.4 + h1) + h1 * 5) % 1;
      const dx = p.x + (0.12 + h1 * 0.76) * p.width;
      ctx.globalAlpha = 1 - cycle;
      const from = p.y + toothDepth(Math.round(((dx - p.x) / p.width) * steps));
      ctx.beginPath();
      ctx.moveTo(dx, from);
      ctx.lineTo(dx, from + 4 + cycle * 30);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  void groundY;
  ctx.restore();
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

// Weather overlay: rain (slanted by the wind, splashing where it lands),
// blown autumn leaves, and a low haze on the heaviest days. All of it is
// drawn across the visible window rather than the whole arena, so it costs
// the same whether the arena is one screen wide or ten, and never leaves a
// dry patch at the far end.
function drawWeatherEffects(
  ctx: CanvasRenderingContext2D,
  layout: ArenaLayout,
  timeSec: number,
  weather: WeatherState,
): void {
  const { height, groundY } = layout;
  const viewW = layout.viewWidth ?? layout.width;
  const camX = layout.cameraX ?? 0;
  const gust = windGust(timeSec);

  if (weather.rain > 0) {
    const count = Math.round(viewW / 630 * 90 * weather.rain);
    // The harder it blows, the further from vertical the rain falls — and
    // the streaks are drawn along that same slant, not just shifted.
    const slant = 0.18 + weather.wind * 0.12 + gust * 0.25;
    const fallSpeed = 900 + weather.rain * 500;
    ctx.save();
    ctx.strokeStyle = `rgba(200,225,255,${0.22 + weather.rain * 0.24})`;
    ctx.lineWidth = 1 + weather.rain * 0.8;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const h1 = hash01(i + 31000);
      const h2 = hash01(i + 32000);
      const span = groundY + 60;
      const fall = (timeSec * fallSpeed * (0.75 + h2 * 0.5) + h1 * span * 3) % span;
      const y = fall - 40;
      const x = camX - 60 + ((h1 * (viewW + 160) + fall * slant) % (viewW + 160));
      const len = 14 + h2 * 16 + weather.rain * 8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * slant, y + len);
      ctx.stroke();
    }
    // Splashes where the drops land — small expanding arcs along the
    // ground line, which is what actually sells rain as hitting something.
    ctx.strokeStyle = `rgba(220,240,255,${0.3 * weather.rain})`;
    ctx.lineWidth = 1.2;
    const splashes = Math.round(viewW / 630 * 16 * weather.rain);
    for (let i = 0; i < splashes; i++) {
      const h1 = hash01(i + 33000);
      const h2 = hash01(i + 34000);
      const cycle = (timeSec * (1.6 + h2) + h1 * 7) % 1;
      const x = camX + h1 * viewW;
      const r = 1.5 + cycle * 7;
      ctx.globalAlpha = (1 - cycle) * 0.55 * weather.rain;
      ctx.beginPath();
      ctx.ellipse(x, groundY + 4 + h2 * 26, r, r * 0.35, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (weather.leaves > 0) {
    // Autumn leaves torn loose and tumbling across the arena — they spin as
    // they travel and ride the same gusts as the grass.
    const count = Math.round(viewW / 630 * 16 * weather.leaves);
    const palette = ['#c1440e', '#d97706', '#a16207', '#7c3f10', '#b45309'];
    ctx.save();
    for (let i = 0; i < count; i++) {
      const h1 = hash01(i + 51000);
      const h2 = hash01(i + 52000);
      const h3 = hash01(i + 53000);
      const speed = (70 + h2 * 130) * (0.6 + weather.wind * 0.5);
      const span = viewW + 200;
      const x = camX - 100 + ((timeSec * speed + h1 * span) % span);
      const bobY = Math.sin(timeSec * (1.4 + h3 * 1.6) + h1 * 9) * (12 + gust * 20);
      const y = height * (0.18 + h2 * 0.55) + bobY;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(timeSec * (2 + h3 * 4) + h1 * 6);
      ctx.fillStyle = palette[i % palette.length];
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.5 + h3 * 2.5, 2.2 + h3 * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,30,10,0.5)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-4.5, 0);
      ctx.lineTo(4.5, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // A low band of murk on the wettest/darkest days, sitting just above the
  // ground so the far end of the arena fades out into the weather.
  if (weather.darken > 0.4) {
    ctx.save();
    ctx.globalAlpha = (weather.darken - 0.4) * 0.5;
    const haze = ctx.createLinearGradient(0, groundY - 150, 0, groundY + 20);
    haze.addColorStop(0, 'rgba(150,160,175,0)');
    haze.addColorStop(1, 'rgba(150,160,175,0.9)');
    ctx.fillStyle = haze;
    ctx.fillRect(camX - 20, groundY - 150, viewW + 40, 170);
    ctx.restore();
  }
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

// Grass/meadow requirement (section 11 quality update): a real, dense,
// continuous meadow covering the *entire* ground area rather than a
// sparse handful of tufts confined to a thin band near the horizon line —
// several density layers spread across the full ground height, each blade
// swaying with its own phase/speed (derived from a per-blade hash, not its
// index directly) so the field never moves as one uniform block, movement
// stays slow and subtle, and it briefly intensifies during periodic gusts.
// A few drifting petals/leaves ride the same wind on top for extra life.
// Character-quality overhaul pass 2: exported so renderFighter.ts can sway
// hair/cape/clothing on the same rare-gust rhythm as the meadow grass
// itself — one shared "wind" concept felt across the whole scene, not
// grass and characters each doing their own unrelated thing.
export function windGust(timeSec: number): number {
  const weather = getSceneWeather();
  // In calm weather this stays the original rare, brief, gentle gust; a
  // windy autumn day turns it into an almost constant lean, and the same
  // number drives the grass, flowers, blown leaves, hair and capes alike.
  const base = Math.max(0, Math.sin(timeSec * 0.12)) ** 5;
  const steady = Math.max(0, weather.wind - 1) * 0.16 * (0.7 + 0.3 * Math.sin(timeSec * 1.7));
  return Math.min(1.6, base * weather.wind + steady);
}

function drawSwayingGrass(ctx: CanvasRenderingContext2D, arena: ArenaDef, layout: ArenaLayout, timeSec: number): void {
  const { width, groundY, height } = layout;
  const gust = windGust(timeSec);
  const groundSpan = Math.max(1, height - groundY);

  // Back layer: shorter, denser, slightly darker/duller blades filling the
  // whole ground depth — the "continuous field" base.
  drawGrassLayer(ctx, width, groundY, groundSpan, timeSec, gust, {
    seedOffset: 0, count: Math.round((width / 630) * 70), minH: 6, maxH: 11, minAmp: 1.4, maxAmp: 2.6,
    color: arena.isDark ? 'rgba(120,160,110,0.28)' : 'rgba(24,60,20,0.32)', lineWidth: 1.3,
  });
  // Front layer: taller, bolder blades, biased toward the near half of the
  // ground so the field reads with some depth instead of flat wallpaper.
  drawGrassLayer(ctx, width, groundY, groundSpan, timeSec, gust, {
    seedOffset: 5000, count: Math.round((width / 630) * 46), minH: 11, maxH: 19, minAmp: 2.4, maxAmp: 4.2,
    color: arena.isDark ? 'rgba(150,195,130,0.4)' : 'rgba(32,80,26,0.48)', lineWidth: 1.8,
    biasNear: true,
  });

  // A handful of small petals/leaves drifting on the same wind.
  if (!arena.isDark) {
    ctx.save();
    ctx.fillStyle = arena.accentColor;
    for (let i = 0; i < 6; i++) {
      const h1 = hash01(i + 20000);
      const h2 = hash01(i + 21000);
      const driftSpeed = 10 + h2 * 14 + gust * 20;
      const x = ((timeSec * driftSpeed + h1 * (width + 80)) % (width + 80)) - 40;
      const y = groundY + 6 + h2 * Math.min(50, groundSpan - 10) + Math.sin(timeSec * 1.4 + h1 * 8) * 4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(timeSec * (0.8 + h2) + h1 * 6);
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.2, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}

function drawGrassLayer(
  ctx: CanvasRenderingContext2D, width: number, groundY: number, groundSpan: number, timeSec: number, gust: number,
  opts: { seedOffset: number; count: number; minH: number; maxH: number; minAmp: number; maxAmp: number; color: string; lineWidth: number; biasNear?: boolean },
): void {
  ctx.save();
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = opts.lineWidth;
  ctx.lineCap = 'round';
  const depthSpan = Math.min(groundSpan - 4, groundSpan * 0.85);
  for (let i = 0; i < opts.count; i++) {
    const h1 = hash01(i + opts.seedOffset);
    const h2 = hash01(i + opts.seedOffset + 1);
    const h3 = hash01(i + opts.seedOffset + 2);
    const gx = h1 * width;
    const depthT = opts.biasNear ? Math.sqrt(h2) : h2;
    const gy = groundY + 4 + depthT * depthSpan;
    const speed = 0.65 + h3 * 0.7;
    const phase = h1 * Math.PI * 2;
    const amp = opts.minAmp + h3 * (opts.maxAmp - opts.minAmp) + gust * (opts.maxAmp - opts.minAmp) * 1.3;
    const sway = Math.sin(timeSec * speed + phase) * amp;
    const bladeH = opts.minH + h1 * (opts.maxH - opts.minH);
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

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, swayPx = 0, size = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  // A short stem rooted at the ground with the head swaying at the top —
  // same "fixed base, moving tip" shape as the grass blades beside it,
  // rather than the whole flower rigidly rotating in place (which a
  // 5-fold-symmetric bloom would barely show).
  ctx.strokeStyle = 'rgba(30,70,25,0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.quadraticCurveTo(swayPx * 0.5, 2, swayPx, -2);
  ctx.stroke();

  const hx = swayPx;
  const hy = -2;
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(hx + Math.cos(a) * 4, hy + Math.sin(a) * 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff176';
  ctx.beginPath();
  ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
