// Section 38: sound architecture built around named categories so real
// sample files can replace the synthesized placeholders later without
// touching any call site — every call site just does
// `audio.play('criticalHit')`.
export type SoundId =
  | 'hit' | 'heavyHit' | 'criticalHit' | 'jump' | 'land' | 'weaponSwing'
  | 'enemyHit' | 'vomit' | 'explosion' | 'superpower'
  | 'victory' | 'gameOver' | 'bossIntro' | 'block' | 'dodge' | 'upgrade' | 'menuTap'
  | 'storkFlyby' | 'surprise' | 'diaperSplat'
  | 'coinPickup' | 'heartPickup' | 'shopBuy' | 'specialActivate' | 'laserCharge' | 'laserFire' | 'ravenCaw'
  // Quality pass: per-weapon swing + impact sounds (point 38) — layered on
  // top of the existing damage-tier hit sound (hit/heavyHit/criticalHit),
  // which keeps conveying how hard a hit landed, while these convey WHAT
  // landed it.
  | 'swordSwing' | 'swordHit' | 'spearThrust' | 'spearHit' | 'axeSwing' | 'axeHit' | 'bowDraw' | 'bowRelease'
  | 'mosquitoBuzz' | 'mosquitoSting';

interface SoundSpec {
  wave: OscillatorType | 'noise';
  freqStart: number;
  freqEnd: number;
  durationMs: number;
  volume: number;
  attackMs?: number; // quick fade-in before the decay; a real percussive
  // transient instead of starting exactly at peak volume (section 8).
  punch?: boolean; // layer a brief filtered-noise "click" under the tone
  // for extra weight — used to make hits read as clearly heavier than
  // plain movement sounds (section 8).
}

// Section 8 (polish pass): volumes re-balanced against each other rather
// than picked in isolation — hits clearly read louder/punchier than
// footwork/movement sounds, criticals top the scale, superpowers get a
// bit more presence, nothing sits loud enough to mask what comes after it.
const SOUND_SPECS: Record<SoundId, SoundSpec> = {
  hit: { wave: 'square', freqStart: 220, freqEnd: 110, durationMs: 90, volume: 0.4, attackMs: 4, punch: true },
  heavyHit: { wave: 'square', freqStart: 170, freqEnd: 65, durationMs: 150, volume: 0.52, attackMs: 5, punch: true },
  criticalHit: { wave: 'sawtooth', freqStart: 340, freqEnd: 55, durationMs: 240, volume: 0.62, attackMs: 4, punch: true },
  jump: { wave: 'sine', freqStart: 320, freqEnd: 560, durationMs: 130, volume: 0.22, attackMs: 8 },
  land: { wave: 'sine', freqStart: 190, freqEnd: 70, durationMs: 100, volume: 0.26, attackMs: 3, punch: true },
  weaponSwing: { wave: 'triangle', freqStart: 520, freqEnd: 320, durationMs: 90, volume: 0.16, attackMs: 6 },
  enemyHit: { wave: 'square', freqStart: 185, freqEnd: 95, durationMs: 100, volume: 0.34, attackMs: 4, punch: true },
  vomit: { wave: 'noise', freqStart: 210, freqEnd: 75, durationMs: 380, volume: 0.32, attackMs: 15 },
  explosion: { wave: 'noise', freqStart: 240, freqEnd: 35, durationMs: 420, volume: 0.6, attackMs: 3, punch: true },
  superpower: { wave: 'sawtooth', freqStart: 110, freqEnd: 760, durationMs: 420, volume: 0.48, attackMs: 10 },
  victory: { wave: 'sine', freqStart: 440, freqEnd: 880, durationMs: 520, volume: 0.42, attackMs: 15 },
  gameOver: { wave: 'sine', freqStart: 300, freqEnd: 85, durationMs: 720, volume: 0.42, attackMs: 20 },
  bossIntro: { wave: 'sawtooth', freqStart: 75, freqEnd: 210, durationMs: 620, volume: 0.48, attackMs: 25 },
  block: { wave: 'square', freqStart: 420, freqEnd: 360, durationMs: 65, volume: 0.28, attackMs: 3, punch: true },
  dodge: { wave: 'sine', freqStart: 520, freqEnd: 680, durationMs: 85, volume: 0.2, attackMs: 5 },
  upgrade: { wave: 'sine', freqStart: 410, freqEnd: 920, durationMs: 260, volume: 0.36, attackMs: 12 },
  menuTap: { wave: 'sine', freqStart: 600, freqEnd: 700, durationMs: 50, volume: 0.2, attackMs: 3 },
  // Humorous effects pass: a wobbly rising-falling "honk" for the stork's
  // flyby, a bright short "surprise" sting for a distracted reaction, and a
  // soft squelchy "splat" for the diaper-bomb impact.
  storkFlyby: { wave: 'triangle', freqStart: 260, freqEnd: 420, durationMs: 260, volume: 0.3, attackMs: 10 },
  surprise: { wave: 'square', freqStart: 900, freqEnd: 1400, durationMs: 140, volume: 0.34, attackMs: 3 },
  diaperSplat: { wave: 'noise', freqStart: 300, freqEnd: 60, durationMs: 220, volume: 0.4, attackMs: 4, punch: true },
  // Persistent-progression pass: a bright two-note "cha-ching" for coins, a
  // warm rising chime for a heart, a friendly register-bell for a shop
  // purchase, a sting to announce any special weapon firing, and a
  // charge-up whine + sharp discharge for the laser specifically.
  coinPickup: { wave: 'sine', freqStart: 720, freqEnd: 1180, durationMs: 130, volume: 0.3, attackMs: 3 },
  heartPickup: { wave: 'sine', freqStart: 500, freqEnd: 820, durationMs: 320, volume: 0.4, attackMs: 12 },
  shopBuy: { wave: 'triangle', freqStart: 660, freqEnd: 990, durationMs: 200, volume: 0.34, attackMs: 6 },
  specialActivate: { wave: 'sawtooth', freqStart: 180, freqEnd: 620, durationMs: 260, volume: 0.4, attackMs: 8 },
  laserCharge: { wave: 'sawtooth', freqStart: 90, freqEnd: 900, durationMs: 500, volume: 0.36, attackMs: 40 },
  laserFire: { wave: 'square', freqStart: 1400, freqEnd: 220, durationMs: 260, volume: 0.55, attackMs: 2, punch: true },
  // A short, coarse caw for the raven companion's personality beats —
  // noise-based so it reads as a bird call rather than a musical tone.
  ravenCaw: { wave: 'noise', freqStart: 900, freqEnd: 500, durationMs: 140, volume: 0.28, attackMs: 2, punch: true },

  // Quality pass (point 38): "Schwert: Swoosh -> Kling" — a crisper swing
  // than the generic weaponSwing, and a bright, ringing metallic tone
  // (long-ish sine decay, no noise/punch layer) for the clang instead of a
  // dull thump.
  swordSwing: { wave: 'triangle', freqStart: 580, freqEnd: 360, durationMs: 85, volume: 0.17, attackMs: 4 },
  swordHit: { wave: 'sine', freqStart: 1250, freqEnd: 880, durationMs: 190, volume: 0.28, attackMs: 2 },
  // "Speer: Whoosh -> Thud" — a longer, deeper sweep for the thrust and a
  // low, soft (not sharp) impact.
  spearThrust: { wave: 'sine', freqStart: 380, freqEnd: 190, durationMs: 150, volume: 0.18, attackMs: 6 },
  spearHit: { wave: 'noise', freqStart: 150, freqEnd: 60, durationMs: 130, volume: 0.32, attackMs: 4, punch: true },
  // "Axt: Whoom -> Impact" — a slow, heavy low-end sweep and a big, blunt
  // punch on landing.
  axeSwing: { wave: 'sawtooth', freqStart: 150, freqEnd: 85, durationMs: 170, volume: 0.19, attackMs: 8 },
  axeHit: { wave: 'noise', freqStart: 210, freqEnd: 40, durationMs: 220, volume: 0.48, attackMs: 3, punch: true },
  // "Bogen: String -> Twang" — a quick plucked-string pull, then a
  // brighter, higher release as the arrow actually lets go.
  bowDraw: { wave: 'triangle', freqStart: 300, freqEnd: 480, durationMs: 90, volume: 0.16, attackMs: 3 },
  bowRelease: { wave: 'triangle', freqStart: 720, freqEnd: 1150, durationMs: 140, volume: 0.3, attackMs: 2 },

  // Mosquito pass: a thin, high, wavering buzz for its flight and a tiny
  // sharp sting — deliberately small/annoying-in-a-good-way, never as
  // weighty as a real combat hit.
  mosquitoBuzz: { wave: 'sawtooth', freqStart: 480, freqEnd: 540, durationMs: 220, volume: 0.12, attackMs: 10 },
  mosquitoSting: { wave: 'square', freqStart: 1400, freqEnd: 1000, durationMs: 60, volume: 0.22, attackMs: 1 },
};

// Section 4/5/7 (polish pass): several distinct fart "personalities" —
// a sub-bass rumble (with a wobble so it doesn't sound like one clean
// sweep) layered under raspy filtered noise, lower/rumblier than the old
// single noise burst. Randomly picked, then pitch/duration-jittered per
// play, so two farts in a row never sound identical.
interface FartVariant {
  sub: number;
  subEnd: number;
  noise: number;
  noiseEnd: number;
  durationMs: number;
}

const FART_VARIANTS: FartVariant[] = [
  { sub: 72, subEnd: 32, noise: 100, noiseEnd: 30, durationMs: 480 },
  { sub: 56, subEnd: 24, noise: 82, noiseEnd: 22, durationMs: 580 },
  { sub: 88, subEnd: 40, noise: 118, noiseEnd: 34, durationMs: 420 },
  { sub: 64, subEnd: 28, noise: 90, noiseEnd: 26, durationMs: 540 },
];

class AudioManager {
  private ctx: AudioContext | null = null;
  soundEnabled = true;
  musicEnabled = true;
  vibrationEnabled = true;

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  /** Must be called from a user gesture (iOS Safari requirement). */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => undefined);
    }
  }

  private makeNoiseBuffer(ctx: AudioContext, durSec: number): AudioBuffer {
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * durSec));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    return buffer;
  }

  play(id: SoundId): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const spec = SOUND_SPECS[id];
      const now = ctx.currentTime;
      const durSec = spec.durationMs / 1000;
      const attackSec = Math.min(durSec * 0.4, (spec.attackMs ?? 6) / 1000);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(spec.volume, now + attackSec);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
      gain.connect(ctx.destination);

      if (spec.wave === 'noise') {
        const buffer = this.makeNoiseBuffer(ctx, durSec);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(spec.freqStart, now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, spec.freqEnd), now + durSec);
        src.connect(filter).connect(gain);
        src.start(now);
        src.stop(now + durSec);
      } else {
        const osc = ctx.createOscillator();
        osc.type = spec.wave;
        osc.frequency.setValueAtTime(spec.freqStart, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqEnd), now + durSec);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + durSec);
      }

      if (spec.punch) {
        // A very brief high-passed noise "click" at the onset — gives
        // impacts a percussive edge instead of just a pure tone fading out.
        const clickDur = Math.min(0.05, durSec * 0.3);
        const clickBuffer = this.makeNoiseBuffer(ctx, clickDur);
        const clickSrc = ctx.createBufferSource();
        clickSrc.buffer = clickBuffer;
        const clickFilter = ctx.createBiquadFilter();
        clickFilter.type = 'highpass';
        clickFilter.frequency.value = 1200;
        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(spec.volume * 0.7, now);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, now + clickDur);
        clickSrc.connect(clickFilter).connect(clickGain).connect(ctx.destination);
        clickSrc.start(now);
        clickSrc.stop(now + clickDur);
      }
    } catch {
      // audio blocked or unsupported — game continues silently (section 56)
    }
  }

  /** A rumbling, organic fart — randomly picks one of several variants and
   * jitters pitch/duration each time so repeats don't sound identical
   * (section 4). Layers a wobbling sub-bass tone under raspy filtered
   * noise rather than one plain noise sweep. Timed by the caller to land
   * exactly on the fart animation/gas cloud/comic text (section 7). */
  playFart(): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const v = FART_VARIANTS[Math.floor(Math.random() * FART_VARIANTS.length)];
      const pitchJitter = 0.9 + Math.random() * 0.22;
      const durSec = (v.durationMs * (0.88 + Math.random() * 0.24)) / 1000;
      const now = ctx.currentTime;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.exponentialRampToValueAtTime(0.55, now + 0.025);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
      masterGain.connect(ctx.destination);

      // Rumbling sub-bass with a wobble (several small random ramp steps)
      // for an "organic", not-a-clean-sine character.
      const sub = ctx.createOscillator();
      sub.type = 'triangle';
      const subStart = v.sub * pitchJitter;
      const subEnd = v.subEnd * pitchJitter;
      sub.frequency.setValueAtTime(subStart, now);
      const wobbleSteps = 5;
      for (let i = 1; i <= wobbleSteps; i++) {
        const tt = now + (durSec * i) / (wobbleSteps + 1);
        const wobble = 1 + (Math.random() - 0.5) * 0.3;
        const base = subStart + (subEnd - subStart) * (i / (wobbleSteps + 1));
        sub.frequency.linearRampToValueAtTime(Math.max(15, base * wobble), tt);
      }
      sub.frequency.linearRampToValueAtTime(Math.max(15, subEnd), now + durSec);
      const subGain = ctx.createGain();
      subGain.gain.value = 0.85;
      sub.connect(subGain).connect(masterGain);
      sub.start(now);
      sub.stop(now + durSec);

      // Raspy filtered-noise layer riding along under the rumble.
      const buffer = this.makeNoiseBuffer(ctx, durSec);
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(v.noise * pitchJitter, now);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, v.noiseEnd * pitchJitter), now + durSec);
      filter.Q.value = 2.2;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.5;
      noiseSrc.connect(filter).connect(noiseGain).connect(masterGain);
      noiseSrc.start(now);
      noiseSrc.stop(now + durSec);
    } catch {
      // audio blocked or unsupported — game continues silently (section 56)
    }
  }

  vibrate(pattern: number | number[]): void {
    if (!this.vibrationEnabled) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch {
      // unsupported — ignore
    }
  }
}

export const audio = new AudioManager();
