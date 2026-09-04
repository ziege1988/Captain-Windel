// Sound architecture built around named categories so real sample files can
// replace the synthesized ones later without touching any call site — every
// call site just does `audio.play('criticalHit')`.
//
// Sound-quality overhaul: every sound used to be a single oscillator (or one
// noise burst) sweeping between two frequencies under one envelope. That is
// exactly the recipe for a beep, and it is why the whole game sounded like
// ping-pong: a punch and a coin differed only in pitch, everything had the
// same shape, and every repeat was bit-identical. Real sounds are several
// things happening at once with different timings — a punch is a low body
// thump plus a mid slap plus a short high transient, a sword is inharmonic
// metal partials over a noise scrape, a swing is filtered air with no tone
// in it at all. So a sound is now a stack of LAYERS, each with its own
// waveform, delay, envelope, filter sweep and pitch wobble, mixed through a
// shared compressor, and pitch-varied a little on every play so repeats are
// never identical.
export type SoundId =
  | 'hit' | 'heavyHit' | 'criticalHit' | 'jump' | 'land' | 'weaponSwing'
  | 'enemyHit' | 'vomit' | 'explosion' | 'superpower'
  | 'victory' | 'gameOver' | 'bossIntro' | 'block' | 'dodge' | 'upgrade' | 'menuTap'
  | 'storkFlyby' | 'surprise' | 'diaperSplat'
  | 'coinPickup' | 'heartPickup' | 'shopBuy' | 'specialActivate' | 'laserCharge' | 'laserFire' | 'ravenCaw'
  | 'swordSwing' | 'swordHit' | 'spearThrust' | 'spearHit' | 'axeSwing' | 'axeHit' | 'bowDraw' | 'bowRelease'
  | 'mosquitoBuzz' | 'mosquitoSting'
  | 'slip' | 'bodyThud'
  | 'paperWrap' | 'paperTear'
  | 'thunderRumble' | 'thunderCrack'
  | 'multiStrike'
  | 'poopPlop' | 'flyBuzz';

type Wave = OscillatorType | 'noise';

interface FilterSpec {
  type: BiquadFilterType;
  freq: number;
  /** Sweeps to this by the end of the layer; defaults to no sweep. */
  freqEnd?: number;
  q?: number;
}

/** One voice inside a sound. Layers are what turn a beep into a noise that
 * has a body, an attack and a texture. */
interface Layer {
  wave: Wave;
  /** Ignored for noise layers, which are shaped entirely by their filter. */
  freq?: number;
  freqEnd?: number;
  /** Linear pitch sweeps read as sirens; exponential ones read as physical. */
  sweep?: 'exp' | 'lin';
  /** Start offset within the sound — this is what makes a two-part sound
   * ("cha-CHING", draw-then-release) instead of a chord. */
  delayMs?: number;
  durationMs: number;
  gain: number;
  attackMs?: number;
  /** Hold at full level before the decay starts. */
  holdMs?: number;
  filter?: FilterSpec;
  /** Frequency wobble, e.g. the waver in a mosquito or a fart. */
  wobbleHz?: number;
  wobbleDepth?: number;
  /** Detune in cents — a couple of cents between two copies of a layer is
   * what makes a tone sound like an object rather than an oscillator. */
  detune?: number;
}

interface SoundSpec {
  volume: number;
  layers: Layer[];
  /** Per-play pitch variation as a fraction (0.06 = +/-6%). Without this,
   * repeated hits in a combo sound like a machine. */
  variance?: number;
}

const n = (l: Layer): Layer => l; // keeps the tables readable

// Volumes are balanced against each other rather than picked in isolation:
// hits read clearly louder and punchier than footwork, criticals top the
// scale, and nothing is loud enough to mask what comes after it.
const SOUND_SPECS: Record<SoundId, SoundSpec> = {
  // --- impacts -------------------------------------------------------------
  // A punch is three things at once: the low thump of mass, the mid-range
  // slap of the surface, and a short bright transient at the moment of
  // contact. One oscillator can only ever be one of the three.
  hit: {
    volume: 0.5, variance: 0.1,
    layers: [
      n({ wave: 'sine', freq: 190, freqEnd: 62, durationMs: 130, gain: 0.9, attackMs: 2 }),
      n({ wave: 'triangle', freq: 340, freqEnd: 130, durationMs: 85, gain: 0.35, attackMs: 1 }),
      n({ wave: 'noise', durationMs: 60, gain: 0.5, attackMs: 1, filter: { type: 'bandpass', freq: 1400, freqEnd: 420, q: 1.1 } }),
    ],
  },
  heavyHit: {
    volume: 0.62, variance: 0.09,
    layers: [
      n({ wave: 'sine', freq: 150, freqEnd: 42, durationMs: 220, gain: 1, attackMs: 2 }),
      n({ wave: 'triangle', freq: 250, freqEnd: 80, durationMs: 150, gain: 0.4, attackMs: 2 }),
      n({ wave: 'noise', durationMs: 110, gain: 0.6, attackMs: 1, filter: { type: 'lowpass', freq: 2200, freqEnd: 300, q: 0.9 } }),
    ],
  },
  criticalHit: {
    volume: 0.72, variance: 0.07,
    layers: [
      n({ wave: 'sine', freq: 180, freqEnd: 34, durationMs: 320, gain: 1, attackMs: 2 }),
      n({ wave: 'noise', durationMs: 170, gain: 0.75, attackMs: 1, filter: { type: 'lowpass', freq: 3600, freqEnd: 240, q: 1 } }),
      // A short bright crack riding on top so a critical cuts through.
      n({ wave: 'noise', durationMs: 55, gain: 0.55, attackMs: 1, filter: { type: 'highpass', freq: 2400 } }),
      n({ wave: 'square', freq: 420, freqEnd: 90, durationMs: 200, gain: 0.22, attackMs: 3, delayMs: 20 }),
    ],
  },
  enemyHit: {
    volume: 0.42, variance: 0.12,
    layers: [
      n({ wave: 'sine', freq: 165, freqEnd: 55, durationMs: 120, gain: 0.85, attackMs: 2 }),
      n({ wave: 'noise', durationMs: 55, gain: 0.4, attackMs: 1, filter: { type: 'bandpass', freq: 1100, freqEnd: 380, q: 1.2 } }),
    ],
  },
  multiStrike: {
    volume: 0.72, variance: 0.04,
    layers: [
      // Three thumps in quick succession — the flurry is audible, not just
      // one louder hit.
      n({ wave: 'sine', freq: 200, freqEnd: 70, durationMs: 130, gain: 0.9, attackMs: 2 }),
      n({ wave: 'sine', freq: 230, freqEnd: 78, durationMs: 130, gain: 0.9, attackMs: 2, delayMs: 85 }),
      n({ wave: 'sine', freq: 150, freqEnd: 40, durationMs: 340, gain: 1, attackMs: 3, delayMs: 175 }),
      n({ wave: 'noise', durationMs: 60, gain: 0.5, attackMs: 1, filter: { type: 'bandpass', freq: 1500, freqEnd: 500, q: 1 } }),
      n({ wave: 'noise', durationMs: 60, gain: 0.5, attackMs: 1, delayMs: 85, filter: { type: 'bandpass', freq: 1700, freqEnd: 550, q: 1 } }),
      n({ wave: 'noise', durationMs: 260, gain: 0.7, attackMs: 1, delayMs: 175, filter: { type: 'lowpass', freq: 3800, freqEnd: 260 } }),
      // A rising tail so it lands as a payoff rather than just a loud hit.
      n({ wave: 'sawtooth', freq: 190, freqEnd: 620, durationMs: 380, gain: 0.2, attackMs: 20, delayMs: 150 }),
    ],
  },

  // --- swings: filtered air, no tone at all --------------------------------
  weaponSwing: {
    volume: 0.3, variance: 0.14,
    layers: [
      n({ wave: 'noise', durationMs: 170, gain: 1, attackMs: 45, filter: { type: 'bandpass', freq: 700, freqEnd: 2100, q: 1.6 } }),
    ],
  },
  swordSwing: {
    volume: 0.32, variance: 0.12,
    layers: [
      n({ wave: 'noise', durationMs: 150, gain: 1, attackMs: 35, filter: { type: 'bandpass', freq: 1100, freqEnd: 3200, q: 2.2 } }),
    ],
  },
  axeSwing: {
    volume: 0.36, variance: 0.1,
    layers: [
      n({ wave: 'noise', durationMs: 250, gain: 1, attackMs: 70, filter: { type: 'bandpass', freq: 320, freqEnd: 1000, q: 1.3 } }),
      n({ wave: 'sine', freq: 130, freqEnd: 70, durationMs: 240, gain: 0.25, attackMs: 60 }),
    ],
  },
  spearThrust: {
    volume: 0.3, variance: 0.12,
    layers: [
      n({ wave: 'noise', durationMs: 130, gain: 1, attackMs: 20, filter: { type: 'bandpass', freq: 1600, freqEnd: 600, q: 2.4 } }),
    ],
  },
  dodge: {
    volume: 0.26, variance: 0.15,
    layers: [
      n({ wave: 'noise', durationMs: 190, gain: 1, attackMs: 55, filter: { type: 'bandpass', freq: 500, freqEnd: 1700, q: 1.4 } }),
    ],
  },

  // --- weapon impacts ------------------------------------------------------
  // Metal rings at inharmonic partials, which is exactly what a sine sweep
  // cannot do: three detuned high tones over a scrape is what makes it read
  // as steel rather than as a note.
  swordHit: {
    volume: 0.5, variance: 0.06,
    layers: [
      n({ wave: 'triangle', freq: 1860, durationMs: 620, gain: 0.5, attackMs: 1 }),
      n({ wave: 'triangle', freq: 2790, durationMs: 480, gain: 0.3, attackMs: 1, detune: 14 }),
      n({ wave: 'sine', freq: 4210, durationMs: 300, gain: 0.18, attackMs: 1 }),
      n({ wave: 'noise', durationMs: 70, gain: 0.6, attackMs: 1, filter: { type: 'highpass', freq: 2600 } }),
      n({ wave: 'sine', freq: 220, freqEnd: 80, durationMs: 120, gain: 0.5, attackMs: 2 }),
    ],
  },
  axeHit: {
    volume: 0.6, variance: 0.08,
    layers: [
      n({ wave: 'sine', freq: 120, freqEnd: 34, durationMs: 300, gain: 1, attackMs: 2 }),
      n({ wave: 'noise', durationMs: 200, gain: 0.8, attackMs: 1, filter: { type: 'lowpass', freq: 1400, freqEnd: 180, q: 1.2 } }),
      n({ wave: 'triangle', freq: 620, durationMs: 130, gain: 0.16, attackMs: 1 }),
    ],
  },
  spearHit: {
    volume: 0.44, variance: 0.1,
    layers: [
      n({ wave: 'sine', freq: 160, freqEnd: 50, durationMs: 160, gain: 0.9, attackMs: 2 }),
      n({ wave: 'noise', durationMs: 90, gain: 0.5, attackMs: 1, filter: { type: 'bandpass', freq: 900, freqEnd: 300, q: 1.5 } }),
    ],
  },
  block: {
    volume: 0.42, variance: 0.08,
    layers: [
      n({ wave: 'triangle', freq: 1240, durationMs: 260, gain: 0.4, attackMs: 1 }),
      n({ wave: 'triangle', freq: 1710, durationMs: 200, gain: 0.26, attackMs: 1, detune: -18 }),
      n({ wave: 'noise', durationMs: 60, gain: 0.7, attackMs: 1, filter: { type: 'bandpass', freq: 2400, freqEnd: 900, q: 1.2 } }),
      n({ wave: 'sine', freq: 180, freqEnd: 70, durationMs: 110, gain: 0.4, attackMs: 2 }),
    ],
  },

  // --- bow -----------------------------------------------------------------
  bowDraw: {
    volume: 0.26, variance: 0.09,
    layers: [
      // The creak of the limbs bending, not a rising beep.
      n({ wave: 'sawtooth', freq: 110, freqEnd: 150, durationMs: 260, gain: 0.35, attackMs: 60, wobbleHz: 11, wobbleDepth: 0.05 }),
      n({ wave: 'noise', durationMs: 260, gain: 0.4, attackMs: 60, filter: { type: 'bandpass', freq: 600, freqEnd: 1500, q: 4 } }),
    ],
  },
  bowRelease: {
    volume: 0.42, variance: 0.07,
    layers: [
      // A plucked string: a fast-decaying tone plus the snap of the release.
      n({ wave: 'triangle', freq: 420, freqEnd: 300, durationMs: 220, gain: 0.7, attackMs: 1 }),
      n({ wave: 'triangle', freq: 840, durationMs: 120, gain: 0.25, attackMs: 1, detune: 9 }),
      n({ wave: 'noise', durationMs: 70, gain: 0.6, attackMs: 1, filter: { type: 'bandpass', freq: 2600, freqEnd: 1200, q: 1.6 } }),
    ],
  },

  // --- movement ------------------------------------------------------------
  jump: {
    volume: 0.28, variance: 0.1,
    layers: [
      n({ wave: 'noise', durationMs: 180, gain: 0.7, attackMs: 25, filter: { type: 'bandpass', freq: 400, freqEnd: 1400, q: 1.2 } }),
      n({ wave: 'sine', freq: 210, freqEnd: 360, durationMs: 140, gain: 0.3, attackMs: 6 }),
    ],
  },
  land: {
    volume: 0.4, variance: 0.12,
    layers: [
      n({ wave: 'sine', freq: 130, freqEnd: 45, durationMs: 170, gain: 0.9, attackMs: 2 }),
      // The scuff of grit under the shoes.
      n({ wave: 'noise', durationMs: 190, gain: 0.45, attackMs: 3, filter: { type: 'lowpass', freq: 1600, freqEnd: 300 } }),
    ],
  },
  slip: {
    volume: 0.42, variance: 0.1,
    layers: [
      // The squeak of a foot shooting out, then the whoosh of going over.
      n({ wave: 'triangle', freq: 280, freqEnd: 1250, durationMs: 200, gain: 0.5, attackMs: 8, wobbleHz: 22, wobbleDepth: 0.08 }),
      n({ wave: 'noise', durationMs: 240, gain: 0.5, attackMs: 30, filter: { type: 'bandpass', freq: 900, freqEnd: 2600, q: 3 } }),
    ],
  },
  bodyThud: {
    volume: 0.55, variance: 0.09,
    layers: [
      n({ wave: 'sine', freq: 110, freqEnd: 38, durationMs: 260, gain: 1, attackMs: 3 }),
      n({ wave: 'noise', durationMs: 200, gain: 0.6, attackMs: 2, filter: { type: 'lowpass', freq: 900, freqEnd: 160 } }),
    ],
  },

  // --- comedy / effects ----------------------------------------------------
  vomit: {
    volume: 0.4, variance: 0.12,
    layers: [
      n({ wave: 'noise', durationMs: 460, gain: 1, attackMs: 25, filter: { type: 'lowpass', freq: 700, freqEnd: 180, q: 3 } }),
      n({ wave: 'sawtooth', freq: 90, freqEnd: 55, durationMs: 420, gain: 0.3, attackMs: 30, wobbleHz: 9, wobbleDepth: 0.22 }),
    ],
  },
  explosion: {
    volume: 0.75, variance: 0.06,
    layers: [
      n({ wave: 'noise', durationMs: 700, gain: 1, attackMs: 3, filter: { type: 'lowpass', freq: 4000, freqEnd: 120, q: 0.8 } }),
      n({ wave: 'sine', freq: 90, freqEnd: 26, durationMs: 620, gain: 0.9, attackMs: 4 }),
      n({ wave: 'noise', durationMs: 70, gain: 0.7, attackMs: 1, filter: { type: 'highpass', freq: 3000 } }),
    ],
  },
  superpower: {
    volume: 0.5, variance: 0.05,
    layers: [
      n({ wave: 'sawtooth', freq: 90, freqEnd: 640, durationMs: 480, gain: 0.45, attackMs: 40, filter: { type: 'lowpass', freq: 500, freqEnd: 4200, q: 4 } }),
      n({ wave: 'sawtooth', freq: 91, freqEnd: 648, durationMs: 480, gain: 0.35, attackMs: 40, detune: 11 }),
      n({ wave: 'noise', durationMs: 420, gain: 0.35, attackMs: 60, filter: { type: 'bandpass', freq: 500, freqEnd: 3000, q: 2 } }),
    ],
  },
  diaperSplat: {
    volume: 0.5, variance: 0.13,
    layers: [
      n({ wave: 'noise', durationMs: 240, gain: 1, attackMs: 2, filter: { type: 'lowpass', freq: 1400, freqEnd: 160, q: 2.4 } }),
      n({ wave: 'sine', freq: 140, freqEnd: 45, durationMs: 200, gain: 0.6, attackMs: 3 }),
    ],
  },
  poopPlop: {
    volume: 0.5, variance: 0.14,
    layers: [
      // The classic drop-in-water plop: a fast upward blip inside a wet
      // low-passed body.
      n({ wave: 'sine', freq: 380, freqEnd: 110, durationMs: 160, gain: 0.8, attackMs: 2 }),
      n({ wave: 'noise', durationMs: 190, gain: 0.55, attackMs: 2, filter: { type: 'lowpass', freq: 1200, freqEnd: 150, q: 2.8 } }),
      n({ wave: 'sine', freq: 90, freqEnd: 55, durationMs: 240, gain: 0.4, attackMs: 6, delayMs: 40 }),
    ],
  },
  paperWrap: {
    volume: 0.3, variance: 0.11,
    layers: [
      n({ wave: 'noise', durationMs: 420, gain: 1, attackMs: 30, filter: { type: 'highpass', freq: 1800, freqEnd: 3600 } }),
      n({ wave: 'noise', durationMs: 420, gain: 0.4, attackMs: 30, filter: { type: 'bandpass', freq: 2600, freqEnd: 5200, q: 6, } }),
    ],
  },
  paperTear: {
    volume: 0.36, variance: 0.1,
    layers: [
      n({ wave: 'noise', durationMs: 300, gain: 1, attackMs: 3, filter: { type: 'highpass', freq: 2800, freqEnd: 1100 } }),
    ],
  },
  thunderRumble: {
    volume: 0.4, variance: 0.05,
    layers: [
      n({ wave: 'noise', durationMs: 1400, gain: 1, attackMs: 260, holdMs: 200, filter: { type: 'lowpass', freq: 220, freqEnd: 60, q: 1.4 } }),
      n({ wave: 'sine', freq: 48, freqEnd: 30, durationMs: 1300, gain: 0.5, attackMs: 300, wobbleHz: 2.4, wobbleDepth: 0.2 }),
    ],
  },
  thunderCrack: {
    volume: 0.8, variance: 0.05,
    layers: [
      n({ wave: 'noise', durationMs: 90, gain: 1, attackMs: 1, filter: { type: 'highpass', freq: 2200 } }),
      n({ wave: 'noise', durationMs: 900, gain: 0.85, attackMs: 2, filter: { type: 'lowpass', freq: 3000, freqEnd: 90, q: 0.9 } }),
      n({ wave: 'sine', freq: 70, freqEnd: 24, durationMs: 800, gain: 0.7, attackMs: 6, delayMs: 30 }),
    ],
  },
  storkFlyby: {
    volume: 0.34, variance: 0.09,
    layers: [
      n({ wave: 'triangle', freq: 300, freqEnd: 430, durationMs: 300, gain: 0.5, attackMs: 25, wobbleHz: 7, wobbleDepth: 0.1 }),
      // Wingbeats.
      n({ wave: 'noise', durationMs: 340, gain: 0.4, attackMs: 40, filter: { type: 'bandpass', freq: 400, freqEnd: 900, q: 2 }, wobbleHz: 9, wobbleDepth: 0.3 }),
    ],
  },
  surprise: {
    volume: 0.4, variance: 0.06,
    layers: [
      n({ wave: 'triangle', freq: 700, freqEnd: 1500, durationMs: 150, gain: 0.6, attackMs: 3 }),
      n({ wave: 'triangle', freq: 1050, freqEnd: 2250, durationMs: 130, gain: 0.25, attackMs: 3, detune: 8 }),
    ],
  },
  ravenCaw: {
    volume: 0.36, variance: 0.14,
    layers: [
      n({ wave: 'sawtooth', freq: 420, freqEnd: 260, durationMs: 200, gain: 0.5, attackMs: 6, wobbleHz: 28, wobbleDepth: 0.16, filter: { type: 'bandpass', freq: 1200, freqEnd: 700, q: 3 } }),
      n({ wave: 'noise', durationMs: 180, gain: 0.5, attackMs: 4, filter: { type: 'bandpass', freq: 1600, freqEnd: 800, q: 2.5 } }),
    ],
  },
  mosquitoBuzz: {
    volume: 0.16, variance: 0.1,
    layers: [
      n({ wave: 'sawtooth', freq: 560, durationMs: 420, gain: 0.5, attackMs: 40, holdMs: 200, wobbleHz: 17, wobbleDepth: 0.09, filter: { type: 'bandpass', freq: 1800, q: 5 } }),
      n({ wave: 'sawtooth', freq: 566, durationMs: 420, gain: 0.3, attackMs: 40, holdMs: 200, detune: 22 }),
    ],
  },
  flyBuzz: {
    volume: 0.12, variance: 0.12,
    layers: [
      n({ wave: 'sawtooth', freq: 300, durationMs: 360, gain: 0.5, attackMs: 40, holdMs: 160, wobbleHz: 13, wobbleDepth: 0.14, filter: { type: 'bandpass', freq: 1100, q: 4 } }),
    ],
  },
  mosquitoSting: {
    volume: 0.3, variance: 0.1,
    layers: [
      n({ wave: 'square', freq: 1500, freqEnd: 900, durationMs: 70, gain: 0.5, attackMs: 1 }),
      n({ wave: 'noise', durationMs: 45, gain: 0.4, attackMs: 1, filter: { type: 'highpass', freq: 3000 } }),
    ],
  },

  // --- pickups and UI ------------------------------------------------------
  // A coin is two notes, not one: the "cha" and the "ching". Each note is a
  // tone plus its octave, which is what gives it a metallic ring.
  coinPickup: {
    volume: 0.38, variance: 0.03,
    layers: [
      n({ wave: 'triangle', freq: 1050, durationMs: 130, gain: 0.5, attackMs: 2 }),
      n({ wave: 'sine', freq: 2100, durationMs: 110, gain: 0.2, attackMs: 2 }),
      n({ wave: 'triangle', freq: 1570, durationMs: 260, gain: 0.5, attackMs: 2, delayMs: 75 }),
      n({ wave: 'sine', freq: 3140, durationMs: 200, gain: 0.18, attackMs: 2, delayMs: 75 }),
    ],
  },
  heartPickup: {
    volume: 0.44, variance: 0.02,
    layers: [
      n({ wave: 'triangle', freq: 523, durationMs: 300, gain: 0.5, attackMs: 8 }),
      n({ wave: 'triangle', freq: 659, durationMs: 300, gain: 0.45, attackMs: 8, delayMs: 90 }),
      n({ wave: 'triangle', freq: 784, durationMs: 420, gain: 0.5, attackMs: 8, delayMs: 180 }),
      n({ wave: 'sine', freq: 1568, durationMs: 380, gain: 0.14, attackMs: 12, delayMs: 180 }),
    ],
  },
  shopBuy: {
    volume: 0.4, variance: 0.03,
    layers: [
      n({ wave: 'triangle', freq: 880, durationMs: 150, gain: 0.5, attackMs: 3 }),
      n({ wave: 'triangle', freq: 1320, durationMs: 300, gain: 0.45, attackMs: 3, delayMs: 90 }),
      n({ wave: 'noise', durationMs: 60, gain: 0.25, attackMs: 1, filter: { type: 'highpass', freq: 4000 } }),
    ],
  },
  upgrade: {
    volume: 0.42, variance: 0.03,
    layers: [
      n({ wave: 'triangle', freq: 587, durationMs: 200, gain: 0.45, attackMs: 6 }),
      n({ wave: 'triangle', freq: 880, durationMs: 200, gain: 0.45, attackMs: 6, delayMs: 100 }),
      n({ wave: 'triangle', freq: 1175, durationMs: 400, gain: 0.5, attackMs: 6, delayMs: 200 }),
    ],
  },
  // A UI tap should be a click — a tiny filtered noise pop with barely any
  // tone in it. The old one was a pure 600Hz sine, i.e. a literal beep.
  menuTap: {
    volume: 0.3, variance: 0.08,
    layers: [
      n({ wave: 'noise', durationMs: 32, gain: 1, attackMs: 1, filter: { type: 'bandpass', freq: 2200, q: 1.2 } }),
      n({ wave: 'sine', freq: 480, freqEnd: 380, durationMs: 45, gain: 0.28, attackMs: 1 }),
    ],
  },
  specialActivate: {
    volume: 0.5, variance: 0.04,
    layers: [
      n({ wave: 'sawtooth', freq: 160, freqEnd: 540, durationMs: 300, gain: 0.4, attackMs: 10, filter: { type: 'lowpass', freq: 800, freqEnd: 4000, q: 3 } }),
      n({ wave: 'triangle', freq: 990, durationMs: 220, gain: 0.3, attackMs: 4, delayMs: 140 }),
      n({ wave: 'noise', durationMs: 220, gain: 0.3, attackMs: 20, filter: { type: 'bandpass', freq: 1200, freqEnd: 3400, q: 2 } }),
    ],
  },
  laserCharge: {
    volume: 0.4, variance: 0.03,
    layers: [
      n({ wave: 'sawtooth', freq: 80, freqEnd: 900, durationMs: 620, gain: 0.35, attackMs: 120, filter: { type: 'bandpass', freq: 400, freqEnd: 3000, q: 6 } }),
      n({ wave: 'sawtooth', freq: 81, freqEnd: 906, durationMs: 620, gain: 0.25, attackMs: 120, detune: 16 }),
    ],
  },
  laserFire: {
    volume: 0.62, variance: 0.05,
    layers: [
      n({ wave: 'sawtooth', freq: 1600, freqEnd: 160, durationMs: 300, gain: 0.5, attackMs: 1, filter: { type: 'lowpass', freq: 6000, freqEnd: 500, q: 3 } }),
      n({ wave: 'noise', durationMs: 220, gain: 0.5, attackMs: 1, filter: { type: 'bandpass', freq: 3000, freqEnd: 700, q: 1.4 } }),
      n({ wave: 'sine', freq: 120, freqEnd: 40, durationMs: 260, gain: 0.5, attackMs: 3 }),
    ],
  },

  // --- stingers ------------------------------------------------------------
  victory: {
    volume: 0.5, variance: 0.02,
    layers: [
      n({ wave: 'triangle', freq: 523, durationMs: 160, gain: 0.5, attackMs: 6 }),
      n({ wave: 'triangle', freq: 659, durationMs: 160, gain: 0.5, attackMs: 6, delayMs: 130 }),
      n({ wave: 'triangle', freq: 784, durationMs: 180, gain: 0.5, attackMs: 6, delayMs: 260 }),
      n({ wave: 'triangle', freq: 1046, durationMs: 520, gain: 0.55, attackMs: 6, delayMs: 390 }),
      n({ wave: 'sine', freq: 2093, durationMs: 480, gain: 0.16, attackMs: 10, delayMs: 390 }),
    ],
  },
  gameOver: {
    volume: 0.48, variance: 0.02,
    layers: [
      n({ wave: 'triangle', freq: 440, durationMs: 240, gain: 0.5, attackMs: 10 }),
      n({ wave: 'triangle', freq: 349, durationMs: 240, gain: 0.5, attackMs: 10, delayMs: 200 }),
      n({ wave: 'triangle', freq: 262, durationMs: 800, gain: 0.55, attackMs: 12, delayMs: 400 }),
      n({ wave: 'sawtooth', freq: 131, freqEnd: 98, durationMs: 900, gain: 0.22, attackMs: 40, delayMs: 400 }),
    ],
  },
  bossIntro: {
    volume: 0.58, variance: 0.02,
    layers: [
      n({ wave: 'sawtooth', freq: 55, durationMs: 900, gain: 0.5, attackMs: 30, holdMs: 300, filter: { type: 'lowpass', freq: 400, freqEnd: 1400, q: 2 } }),
      n({ wave: 'sawtooth', freq: 82.5, durationMs: 900, gain: 0.3, attackMs: 30, holdMs: 300, detune: 12 }),
      n({ wave: 'noise', durationMs: 900, gain: 0.3, attackMs: 200, filter: { type: 'lowpass', freq: 300, freqEnd: 80 } }),
      n({ wave: 'triangle', freq: 110, durationMs: 700, gain: 0.3, attackMs: 8, delayMs: 620 }),
    ],
  },
};

// Several distinct fart "personalities" — a sub-bass rumble (with a wobble
// so it doesn't sound like one clean sweep) layered under raspy filtered
// noise. Randomly picked, then pitch/duration-jittered per play, so two
// farts in a row never sound identical.
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
  /** Everything goes through one compressor: layered sounds overlapping in
   * a busy fight would otherwise clip, which is its own kind of cheapness. */
  private master: DynamicsCompressorNode | null = null;
  /** Noise is expensive to generate per play and identical every time, so
   * one long buffer is generated once and each layer reads a random slice
   * of it — which also stops repeated noise layers sounding cloned. */
  private noiseBuffer: AudioBuffer | null = null;
  soundEnabled = true;
  musicEnabled = true;
  vibrationEnabled = true;

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 26;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      comp.connect(this.ctx.destination);
      this.master = comp;
      return this.ctx;
    } catch {
      return null;
    }
  }

  private out(ctx: AudioContext): AudioNode {
    return this.master ?? ctx.destination;
  }

  /** Must be called from a user gesture (iOS Safari requirement). */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => undefined);
    }
  }

  /** Flat white noise, generated once. Layer envelopes and filters do all
   * the shaping, so the buffer itself must stay unshaped. */
  private sharedNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  private makeNoiseBuffer(ctx: AudioContext, durSec: number): AudioBuffer {
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * durSec));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    return buffer;
  }

  /** Plays one layer of a sound. Kept separate so a sound is just a list of
   * these — adding a transient, a body or a tail to any sound is a line in
   * a table rather than new code. */
  private playLayer(ctx: AudioContext, layer: Layer, startAt: number, master: GainNode, pitchMult: number): void {
    const delaySec = (layer.delayMs ?? 0) / 1000;
    const t0 = startAt + delaySec;
    const durSec = layer.durationMs / 1000;
    const attackSec = Math.min(durSec * 0.5, (layer.attackMs ?? 4) / 1000);
    const holdSec = Math.min(durSec - attackSec, (layer.holdMs ?? 0) / 1000);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, layer.gain), t0 + attackSec);
    if (holdSec > 0) gain.gain.setValueAtTime(Math.max(0.0002, layer.gain), t0 + attackSec + holdSec);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);

    let tail: AudioNode = gain;
    if (layer.filter) {
      const f = ctx.createBiquadFilter();
      f.type = layer.filter.type;
      const fStart = layer.filter.freq * pitchMult;
      f.frequency.setValueAtTime(Math.max(30, fStart), t0);
      if (layer.filter.freqEnd != null) {
        f.frequency.exponentialRampToValueAtTime(Math.max(30, layer.filter.freqEnd * pitchMult), t0 + durSec);
      }
      if (layer.filter.q != null) f.Q.value = layer.filter.q;
      f.connect(gain);
      tail = f;
    }
    gain.connect(master);

    if (layer.wave === 'noise') {
      const src = ctx.createBufferSource();
      const shared = this.sharedNoise(ctx);
      src.buffer = shared;
      // A random offset into the shared buffer, so two noise layers in the
      // same sound (and the same sound twice) never use identical samples.
      const offset = Math.random() * Math.max(0, shared.duration - durSec);
      // Noise has no pitch to wobble, so its wobble modulates the filter
      // instead — which is what turns a flat hiss into wingbeats.
      if (layer.wobbleHz && layer.wobbleDepth && layer.filter) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = layer.wobbleHz;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = layer.filter.freq * pitchMult * layer.wobbleDepth;
        lfo.connect(lfoGain).connect((tail as BiquadFilterNode).frequency);
        lfo.start(t0);
        lfo.stop(t0 + durSec);
      }
      src.connect(tail);
      src.start(t0, offset, durSec);
      return;
    }

    const osc = ctx.createOscillator();
    osc.type = layer.wave;
    if (layer.detune) osc.detune.value = layer.detune;
    const f0 = Math.max(20, (layer.freq ?? 440) * pitchMult);
    const f1 = Math.max(20, (layer.freqEnd ?? layer.freq ?? 440) * pitchMult);
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) {
      if (layer.sweep === 'lin') osc.frequency.linearRampToValueAtTime(f1, t0 + durSec);
      else osc.frequency.exponentialRampToValueAtTime(f1, t0 + durSec);
    }
    if (layer.wobbleHz && layer.wobbleDepth) {
      // A real LFO on the pitch: the difference between a held tone and
      // something alive (a buzzing insect, a straining bow, a caw).
      const lfo = ctx.createOscillator();
      lfo.frequency.value = layer.wobbleHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = f0 * layer.wobbleDepth;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + durSec);
    }
    osc.connect(tail);
    osc.start(t0);
    osc.stop(t0 + durSec);
  }

  play(id: SoundId): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const spec = SOUND_SPECS[id];
      const now = ctx.currentTime;
      // Per-play pitch variation. Without it a run of hits in a combo is
      // audibly the same sample over and over, which is most of what makes
      // synthesized game audio sound cheap.
      const variance = spec.variance ?? 0;
      const pitchMult = 1 + (Math.random() * 2 - 1) * variance;

      const master = ctx.createGain();
      master.gain.value = spec.volume;
      master.connect(this.out(ctx));

      for (const layer of spec.layers) this.playLayer(ctx, layer, now, master, pitchMult);
    } catch {
      // audio blocked or unsupported — game continues silently (section 56)
    }
  }

  /** A rumbling, organic fart — randomly picks one of several variants and
   * jitters pitch/duration each time so repeats don't sound identical.
   * Layers a wobbling sub-bass tone under raspy filtered noise rather than
   * one plain noise sweep. Timed by the caller to land exactly on the fart
   * animation/gas cloud/comic text. */
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
      masterGain.connect(this.out(ctx));

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
