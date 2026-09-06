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
  | 'thunderRumble' | 'thunderCrack' | 'thunderDistant'
  | 'multiStrike'
  | 'poopPlop' | 'flyBuzz' | 'chickenPop' | 'clockworkWind'
  // --- character signature abilities ---------------------------------------
  | 'denturePull' | 'dentureSpit' | 'dentureThrow' | 'dentureHit' | 'dentureBonk'
  | 'rockChord' | 'shockwaveBoom'
  | 'stompCharge' | 'stompImpact'
  | 'gasBlast';

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
  // The clockwork chicken. Its spring unwinding while it runs — a dry
  // ratchet, deliberately mechanical rather than animal, so you can hear
  // that the thing running at you is a wind-up toy.
  clockworkWind: {
    volume: 0.3, variance: 0.08,
    layers: [
      n({ wave: 'noise', durationMs: 30, gain: 0.7, attackMs: 1, filter: { type: 'bandpass', freq: 3600, q: 5 } }),
      n({ wave: 'square', freq: 900, freqEnd: 780, durationMs: 26, gain: 0.22, attackMs: 1, filter: { type: 'highpass', freq: 600 } }),
    ],
  },
  // And what is left of it on detonation: an indignant squawk cut off
  // mid-cluck by the blast, plus a shower of feathers.
  chickenPop: {
    volume: 0.55, variance: 0.14,
    layers: [
      n({ wave: 'sawtooth', freq: 900, freqEnd: 340, durationMs: 130, gain: 0.5, attackMs: 4, wobbleHz: 26, wobbleDepth: 120, filter: { type: 'bandpass', freq: 1500, q: 3 } }),
      n({ wave: 'sawtooth', freq: 1250, freqEnd: 500, durationMs: 90, gain: 0.35, attackMs: 3, delayMs: 30, filter: { type: 'bandpass', freq: 2200, q: 4 } }),
      // The feathers settling afterwards.
      n({ wave: 'noise', durationMs: 620, gain: 0.28, attackMs: 40, delayMs: 160, filter: { type: 'highpass', freq: 3800 } }),
    ],
  },
  // --- character signature abilities ---------------------------------------
  // Each of the four heroes has to be identifiable from the sound alone,
  // so they are built from four different physical ideas rather than four
  // pitches of the same noise: dry clacking bone, an amplified string, a
  // huge mass hitting earth, and pressurised gas escaping.
  //
  // Grandpa. A suction-and-release pop as they come free, then wet.
  denturePull: {
    volume: 0.42, variance: 0.12,
    layers: [
      n({ wave: 'sine', freq: 220, freqEnd: 700, durationMs: 130, gain: 0.6, attackMs: 8 }),
      n({ wave: 'noise', durationMs: 170, gain: 0.4, attackMs: 6, filter: { type: 'bandpass', freq: 700, freqEnd: 2200, q: 3.2 } }),
      // The little wet "plop" of the seal breaking.
      n({ wave: 'sine', freq: 640, freqEnd: 180, durationMs: 90, gain: 0.5, attackMs: 1, delayMs: 120 }),
    ],
  },
  // The spit itself. A short wet burst of air off the tongue with a hard
  // "t" transient in front of it — the "ptoo" — and no tone at all, which
  // is what separates a spit from a throw.
  dentureSpit: {
    volume: 0.55, variance: 0.13,
    layers: [
      // The lips/tongue releasing: a very short bright click.
      n({ wave: 'noise', durationMs: 32, gain: 0.9, attackMs: 1, filter: { type: 'highpass', freq: 2600 } }),
      // The burst of air behind it, closing down as it runs out.
      n({ wave: 'noise', durationMs: 210, gain: 0.75, attackMs: 3, delayMs: 14, filter: { type: 'bandpass', freq: 2400, freqEnd: 620, q: 0.9 } }),
      // A little wetness underneath.
      n({ wave: 'noise', durationMs: 130, gain: 0.4, attackMs: 4, delayMs: 20, filter: { type: 'lowpass', freq: 900, freqEnd: 260, q: 2.6 } }),
    ],
  },
  // The flight: a whoosh with the teeth already chattering inside it. The
  // repeated short clacks are what make it a denture and not a rock.
  dentureThrow: {
    volume: 0.5, variance: 0.1,
    layers: [
      n({ wave: 'noise', durationMs: 230, gain: 0.55, attackMs: 10, filter: { type: 'bandpass', freq: 900, freqEnd: 2600, q: 1.1 } }),
      n({ wave: 'square', freq: 1500, freqEnd: 1400, durationMs: 26, gain: 0.4, attackMs: 1, delayMs: 60, filter: { type: 'highpass', freq: 900 } }),
      n({ wave: 'square', freq: 1750, freqEnd: 1600, durationMs: 24, gain: 0.36, attackMs: 1, delayMs: 130, filter: { type: 'highpass', freq: 900 } }),
      n({ wave: 'square', freq: 1400, freqEnd: 1300, durationMs: 24, gain: 0.32, attackMs: 1, delayMs: 195, filter: { type: 'highpass', freq: 900 } }),
    ],
  },
  // The bite landing: a hard bone-on-bone clack with a comedy boing on it.
  dentureHit: {
    volume: 0.6, variance: 0.09,
    layers: [
      n({ wave: 'square', freq: 1900, freqEnd: 900, durationMs: 45, gain: 0.6, attackMs: 1, filter: { type: 'highpass', freq: 700 } }),
      n({ wave: 'triangle', freq: 420, freqEnd: 150, durationMs: 130, gain: 0.7, attackMs: 1 }),
      n({ wave: 'noise', durationMs: 70, gain: 0.5, attackMs: 1, filter: { type: 'bandpass', freq: 2600, freqEnd: 1000, q: 1.4 } }),
      // The bounce-off wobble.
      n({ wave: 'sine', freq: 300, freqEnd: 520, durationMs: 220, gain: 0.3, attackMs: 6, delayMs: 50, wobbleHz: 14, wobbleDepth: 60 }),
    ],
  },
  // And the punchline: they come back and hit him on the head. A dull
  // knock on a skull, not a weapon impact.
  dentureBonk: {
    volume: 0.45, variance: 0.12,
    layers: [
      n({ wave: 'sine', freq: 300, freqEnd: 90, durationMs: 150, gain: 0.8, attackMs: 2 }),
      n({ wave: 'square', freq: 1200, freqEnd: 700, durationMs: 35, gain: 0.3, attackMs: 1, filter: { type: 'highpass', freq: 600 } }),
    ],
  },
  // Punk. A power chord: several detuned sawtooth strings at once through
  // an opening filter, with the pick scrape in front of them.
  rockChord: {
    volume: 0.62, variance: 0.03,
    layers: [
      // The pick hitting the strings before any note sounds.
      n({ wave: 'noise', durationMs: 70, gain: 0.5, attackMs: 1, filter: { type: 'bandpass', freq: 3200, freqEnd: 1400, q: 1.6 } }),
      // Root, fifth and octave — a real chord, not one tone.
      n({ wave: 'sawtooth', freq: 110, durationMs: 900, gain: 0.5, attackMs: 6, holdMs: 220, filter: { type: 'lowpass', freq: 900, freqEnd: 4200, q: 6 } }),
      n({ wave: 'sawtooth', freq: 110, durationMs: 900, gain: 0.4, attackMs: 6, holdMs: 220, detune: 14 }),
      n({ wave: 'sawtooth', freq: 165, durationMs: 860, gain: 0.4, attackMs: 8, holdMs: 200, detune: -9 }),
      n({ wave: 'sawtooth', freq: 220, durationMs: 820, gain: 0.3, attackMs: 8, holdMs: 180, detune: 7 }),
      // Amp buzz underneath, so it sounds plugged in.
      n({ wave: 'square', freq: 55, durationMs: 900, gain: 0.22, attackMs: 20, holdMs: 260, filter: { type: 'lowpass', freq: 400 } }),
    ],
  },
  // The wave itself leaving the amp: a low pressure thump that opens out.
  shockwaveBoom: {
    volume: 0.55, variance: 0.06,
    layers: [
      n({ wave: 'sine', freq: 180, freqEnd: 34, durationMs: 420, gain: 1, attackMs: 4 }),
      n({ wave: 'noise', durationMs: 340, gain: 0.6, attackMs: 8, filter: { type: 'bandpass', freq: 300, freqEnd: 2400, q: 0.8 } }),
      n({ wave: 'triangle', freq: 240, freqEnd: 70, durationMs: 300, gain: 0.35, attackMs: 6, delayMs: 30 }),
    ],
  },
  // Bruno. The gather: a low creak of something heavy loading up.
  stompCharge: {
    volume: 0.35, variance: 0.08,
    layers: [
      n({ wave: 'sawtooth', freq: 60, freqEnd: 120, durationMs: 320, gain: 0.4, attackMs: 90, filter: { type: 'lowpass', freq: 260, freqEnd: 700, q: 3 } }),
      n({ wave: 'noise', durationMs: 300, gain: 0.25, attackMs: 120, filter: { type: 'bandpass', freq: 200, freqEnd: 600, q: 2 } }),
    ],
  },
  // The impact: earth, not metal. A deep body, a wide dirt spray, and a
  // long rumble rolling away afterwards.
  stompImpact: {
    volume: 0.75, variance: 0.06,
    layers: [
      n({ wave: 'sine', freq: 120, freqEnd: 26, durationMs: 520, gain: 1, attackMs: 2 }),
      n({ wave: 'triangle', freq: 190, freqEnd: 44, durationMs: 300, gain: 0.5, attackMs: 2 }),
      n({ wave: 'noise', durationMs: 220, gain: 0.75, attackMs: 1, filter: { type: 'lowpass', freq: 2600, freqEnd: 260, q: 1.2 } }),
      // The rumble travelling away through the ground.
      n({ wave: 'noise', durationMs: 700, gain: 0.4, attackMs: 40, delayMs: 60, filter: { type: 'lowpass', freq: 180, freqEnd: 60, q: 1.4 } }),
      n({ wave: 'sine', freq: 44, freqEnd: 30, durationMs: 800, gain: 0.45, attackMs: 50, delayMs: 60, wobbleHz: 5, wobbleDepth: 5 }),
    ],
  },
  // Windelmann's signature is still a fart, but a pressurised one: the
  // rasp is short and hard, followed by the blast of air actually moving.
  gasBlast: {
    volume: 0.6, variance: 0.14,
    layers: [
      n({ wave: 'sawtooth', freq: 95, freqEnd: 48, durationMs: 300, gain: 0.75, attackMs: 4, wobbleHz: 21, wobbleDepth: 26, filter: { type: 'lowpass', freq: 900, freqEnd: 300, q: 3 } }),
      n({ wave: 'noise', durationMs: 340, gain: 0.6, attackMs: 3, filter: { type: 'bandpass', freq: 480, freqEnd: 1500, q: 1.3 } }),
      // The escaping air, arriving just behind the rasp.
      n({ wave: 'noise', durationMs: 520, gain: 0.5, attackMs: 30, delayMs: 90, filter: { type: 'lowpass', freq: 2400, freqEnd: 400, q: 0.8 } }),
      n({ wave: 'sine', freq: 70, freqEnd: 34, durationMs: 420, gain: 0.5, attackMs: 8, delayMs: 60 }),
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
  // Thunder comes in three parts, because real thunder does and the order
  // is what makes it read as weather rather than as an explosion: a
  // distant grumble somewhere overhead before anything happens, the strike
  // itself, and then the roll of it travelling away afterwards.
  //
  // The warning. Far away and low — enough to make the player look up, not
  // enough to be mistaken for the strike.
  thunderDistant: {
    volume: 0.22, variance: 0.1,
    layers: [
      n({ wave: 'noise', durationMs: 1100, gain: 0.9, attackMs: 340, holdMs: 120, filter: { type: 'lowpass', freq: 200, freqEnd: 70, q: 1.2 } }),
      n({ wave: 'sine', freq: 55, freqEnd: 38, durationMs: 1000, gain: 0.35, attackMs: 380, wobbleHz: 1.7, wobbleDepth: 3 }),
    ],
  },
  // The strike. A close lightning strike is not a boom, it is a RIP: an
  // almost instantaneous shockwave heard as a broadband tear, brightest at
  // the very front and collapsing downward within a tenth of a second,
  // with the slap of the pressure wave arriving right behind it. So the
  // top end leads and there is deliberately no slow attack anywhere.
  thunderCrack: {
    volume: 0.9, variance: 0.04,
    layers: [
      // The leading edge — bright, brutally short, all treble.
      n({ wave: 'noise', durationMs: 45, gain: 1, attackMs: 0.5, filter: { type: 'highpass', freq: 5200 } }),
      // The tear: the whole spectrum collapsing from top to bottom.
      n({ wave: 'noise', durationMs: 260, gain: 1, attackMs: 1, filter: { type: 'bandpass', freq: 7000, freqEnd: 500, q: 0.5 } }),
      // The electrical snap riding on it — this is what makes it read as
      // lightning specifically and not as something blowing up.
      n({ wave: 'square', freq: 2600, freqEnd: 260, durationMs: 70, gain: 0.3, attackMs: 0.5, sweep: 'exp', filter: { type: 'highpass', freq: 1200 } }),
      // The pressure slap a few milliseconds behind the light.
      n({ wave: 'sine', freq: 90, freqEnd: 26, durationMs: 620, gain: 0.9, attackMs: 3, delayMs: 18 }),
      // Secondary crackle — the branches of the bolt arriving fractionally
      // out of step with each other.
      n({ wave: 'noise', durationMs: 90, gain: 0.55, attackMs: 1, delayMs: 55, filter: { type: 'bandpass', freq: 3400, freqEnd: 900, q: 1.4 } }),
      n({ wave: 'noise', durationMs: 70, gain: 0.4, attackMs: 1, delayMs: 130, filter: { type: 'bandpass', freq: 2200, freqEnd: 700, q: 1.6 } }),
    ],
  },
  // And the roll. Long, low and uneven — several swells rather than one
  // fade, because thunder rolling away is the same sound arriving over and
  // over from further and further off.
  thunderRumble: {
    volume: 0.5, variance: 0.06,
    layers: [
      n({ wave: 'noise', durationMs: 2600, gain: 1, attackMs: 120, holdMs: 260, filter: { type: 'lowpass', freq: 340, freqEnd: 55, q: 1.3 } }),
      n({ wave: 'sine', freq: 52, freqEnd: 27, durationMs: 2400, gain: 0.6, attackMs: 150, wobbleHz: 1.9, wobbleDepth: 6 }),
      // Two later swells, each quieter and duller than the last.
      n({ wave: 'noise', durationMs: 1200, gain: 0.6, attackMs: 320, delayMs: 700, filter: { type: 'lowpass', freq: 190, freqEnd: 60, q: 1.6 } }),
      n({ wave: 'noise', durationMs: 1400, gain: 0.4, attackMs: 420, delayMs: 1500, filter: { type: 'lowpass', freq: 130, freqEnd: 45, q: 1.8 } }),
      n({ wave: 'sine', freq: 38, freqEnd: 24, durationMs: 1600, gain: 0.35, attackMs: 400, delayMs: 900, wobbleHz: 1.2, wobbleDepth: 4 }),
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


// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

// There are no audio files in this project — every sound is synthesized —
// so the music is too: a short loop described as note patterns and played
// by a lookahead scheduler. That keeps it in the same architecture as the
// rest of the audio (no assets to load, nothing to wait for, works
// offline) and means a track is a table of numbers rather than new code.
export type MusicId = 'menu' | 'game';

interface MusicVoice {
  wave: OscillatorType;
  /** Semitone offsets above the track root, one entry per step; null rests.
   * The array length is the loop length for this voice, so a bass line and
   * a melody of different lengths can drift against each other. */
  steps: (number | null)[];
  /** How long a note is held, in steps. */
  hold: number;
  gain: number;
  attackMs?: number;
  /** A second copy a few cents away — the difference between "an
   * oscillator" and "an instrument". */
  detune?: number;
  /** Low-passed to take the buzz off a sawtooth. */
  filterHz?: number;
}

interface MusicTrack {
  bpm: number;
  stepsPerBeat: number;
  /** Root note in Hz. Every offset in every voice is relative to this. */
  rootHz: number;
  /** Overall level for the track — the in-game one sits far below the
   * menu's, because it plays under combat and must never compete with it. */
  volume: number;
  voices: MusicVoice[];
  /** 'k' kick, 's' snare, 'h' hat, '.' rest — one character per step. */
  drums?: string;
  drumGain?: number;
}

const R = null; // rest — keeps the pattern tables readable as grids

// The menu march. Deliberately silly rather than heroic: an oompah bass
// (root on the beat, fifth on the off-beat) under a bright, bouncy tune,
// which is the sound of a small-town brass band and exactly the register
// the game's humour lives in. Four bars of C - F - G - C.
const MENU_TRACK: MusicTrack = {
  bpm: 132,
  stepsPerBeat: 2, // eighth notes
  rootHz: 130.81, // C3
  volume: 0.15,
  // Kick on 1 and 3, snare on 2 and 4, hat on every off-beat — a march
  // backbeat under the oompah. One bar long, so it loops with the chords.
  drums: 'khshkhsh',
  drumGain: 0.28,
  voices: [
    {
      // Oompah bass: root, up to the fifth, back. One bar per chord.
      wave: 'triangle',
      steps: [
        -12, R, -5, R, -12, R, -5, R,   // C
        -7, R, 0, R, -7, R, 0, R,       // F
        -5, R, 2, R, -5, R, 2, R,       // G
        -12, R, -5, R, -12, R, -5, R,   // C
      ],
      hold: 1, gain: 0.5, attackMs: 6, filterHz: 900,
    },
    {
      // Off-beat chord stabs, the other half of the oompah.
      wave: 'square',
      steps: [
        R, 4, R, 4, R, 4, R, 4,
        R, 9, R, 9, R, 9, R, 9,
        R, 11, R, 11, R, 11, R, 11,
        R, 4, R, 4, R, 4, R, 4,
      ],
      hold: 1, gain: 0.1, attackMs: 4, filterHz: 1600,
    },
    {
      // The tune. Chord tones on the strong beats, passing notes between
      // them, so it stays consonant over every bar of the progression, and
      // an octave clear of the bass and the stabs so it is a melody you
      // hear rather than something buried in the middle of the chord.
      wave: 'square',
      steps: [
        24, 24, 23, 24, 28, R, 26, 24,
        26, 26, 24, 26, 29, R, 28, 26,
        28, 28, 26, 24, 26, R, 23, 19,
        24, 28, 31, 28, 24, R, R, R,
      ],
      hold: 1, gain: 0.16, attackMs: 5, detune: 7, filterHz: 2600,
    },
  ],
};

// The in-game loop. A different job entirely: it has to be present without
// ever being noticed, so it is slow, quiet, has no melody to follow and no
// drums to compete with hits. A pulse and a pad, and one three-note motif
// that comes round every eight bars. A minor (i - VI - III - VII).
const GAME_TRACK: MusicTrack = {
  bpm: 96,
  stepsPerBeat: 2,
  rootHz: 110, // A2
  volume: 0.062,
  voices: [
    {
      // The pulse: one low note per beat, chord root changing every bar.
      wave: 'triangle',
      steps: [
        -12, R, -12, R, -12, R, -12, R,   // Am
        -4, R, -4, R, -4, R, -4, R,       // F
        -9, R, -9, R, -9, R, -9, R,       // C
        -2, R, -2, R, -2, R, -2, R,       // G
      ],
      hold: 1, gain: 0.55, attackMs: 20, filterHz: 500,
    },
    {
      // A pad holding the third of each chord — enough to say which chord
      // it is without anything to hum along to.
      wave: 'sine',
      steps: [
        3, R, R, R, R, R, R, R,
        9, R, R, R, R, R, R, R,
        4, R, R, R, R, R, R, R,
        11, R, R, R, R, R, R, R,
      ],
      hold: 7, gain: 0.2, attackMs: 320, detune: 6,
    },
    {
      // The motif, on a 64-step loop against the 32-step chords, so it
      // lands on a different chord each time round and the loop takes a
      // long time to sound like a loop.
      wave: 'sine',
      steps: [
        R, R, R, R, R, R, R, R,
        R, R, R, R, R, R, R, R,
        12, R, 15, R, 19, R, R, R,
        R, R, R, R, R, R, R, R,
        R, R, R, R, R, R, R, R,
        R, R, R, R, R, R, R, R,
        19, R, 15, R, 12, R, R, R,
        R, R, R, R, R, R, R, R,
      ],
      hold: 2, gain: 0.13, attackMs: 60, detune: 4, filterHz: 1800,
    },
  ],
};

const MUSIC_TRACKS: Record<MusicId, MusicTrack> = { menu: MENU_TRACK, game: GAME_TRACK };

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
  vibrationEnabled = true;
  private musicOn = true;

  /** Live: turning music off stops it immediately, turning it back on
   * resumes whatever the current screen had asked for, rather than
   * requiring a screen change to take effect. */
  get musicEnabled(): boolean {
    return this.musicOn;
  }

  set musicEnabled(on: boolean) {
    if (this.musicOn === on) return;
    this.musicOn = on;
    if (!on) {
      const current = this.musicId ?? this.pendingMusic;
      this.stopMusic();
      this.pendingMusic = current;
    } else if (this.pendingMusic) {
      this.playMusic(this.pendingMusic);
    }
  }

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
      // A brickwall after the compressor. The compressor shapes the mix;
      // it does not stop it exceeding full scale, and once music plays
      // continuously underneath a busy fight the sum does go over — which
      // is heard as harsh crackling on the loudest hits, not as loudness.
      // Fast attack, hard knee, high ratio, threshold just under 0 dB: it
      // does nothing at all until something would have clipped.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -1.5;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      comp.connect(limiter);
      limiter.connect(this.ctx.destination);
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
      ctx.resume().then(() => this.startPendingMusic()).catch(() => undefined);
      return;
    }
    this.startPendingMusic();
  }

  private startPendingMusic(): void {
    const id = this.pendingMusic;
    if (id && this.musicOn && this.musicTimer == null) this.playMusic(id);
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

  /** `delaySec` starts the whole sound later on the audio clock rather than
   * via a timer, so a sound that has to land on a specific animation frame
   * (a chord under a strum, dentures coming loose partway through a reach)
   * stays sample-accurate instead of drifting with the frame rate.
   * `gain` scales it down for quieter repeats of the same sound. */
  play(id: SoundId, opts: { delaySec?: number; gain?: number } = {}): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const spec = SOUND_SPECS[id];
      const now = ctx.currentTime + Math.max(0, opts.delaySec ?? 0);
      // Per-play pitch variation. Without it a run of hits in a combo is
      // audibly the same sample over and over, which is most of what makes
      // synthesized game audio sound cheap.
      const variance = spec.variance ?? 0;
      const pitchMult = 1 + (Math.random() * 2 - 1) * variance;

      const master = ctx.createGain();
      master.gain.value = spec.volume * (opts.gain ?? 1);
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


  // -------------------------------------------------------------------
  // Music
  //
  // Scheduled with a lookahead rather than a timer per note: a
  // setInterval firing on the main thread is far too jittery to place
  // notes on (a single long frame and the beat audibly stumbles), so the
  // interval only ever asks "what falls in the next quarter second?" and
  // hands those notes to the audio clock, which is sample-accurate.
  // -------------------------------------------------------------------

  private musicId: MusicId | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicNextTime = 0;
  /** A track asked for while the audio context was still suspended.
   * Browsers only allow audio after a user gesture, and the main menu is
   * on screen before the player has touched anything — so the request is
   * remembered and honoured by the first tap. */
  private pendingMusic: MusicId | null = null;

  private static readonly MUSIC_LOOKAHEAD_SEC = 0.25;
  private static readonly MUSIC_TICK_MS = 40;

  /** Starts (or switches to) a track. Safe to call every render — asking
   * for the track that is already playing does nothing, so callers can
   * just declare which music the current screen wants. */
  playMusic(id: MusicId): void {
    if (this.musicId === id && this.musicTimer != null) return;
    this.stopMusic();
    if (!this.musicEnabled) { this.pendingMusic = id; return; }
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state !== 'running') { this.pendingMusic = id; return; }
    this.pendingMusic = null;
    this.musicId = id;

    const track = MUSIC_TRACKS[id];
    const gain = ctx.createGain();
    // Fades in rather than cutting in — landing on a menu should not
    // start with a thump.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(track.volume, ctx.currentTime + 1.2);
    gain.connect(this.out(ctx));
    this.musicGain = gain;

    this.musicStep = 0;
    this.musicNextTime = ctx.currentTime + 0.12;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), AudioManager.MUSIC_TICK_MS);
    this.scheduleMusic();
  }

  stopMusic(): void {
    if (this.musicTimer != null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    const ctx = this.ctx;
    const gain = this.musicGain;
    this.musicGain = null;
    this.musicId = null;
    if (!ctx || !gain) return;
    // Notes already scheduled keep sounding for up to a lookahead, so the
    // bus fades out under them instead of being cut off mid-note.
    try {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      window.setTimeout(() => { try { gain.disconnect(); } catch { /* already gone */ } }, 900);
    } catch {
      // context died — nothing to fade
    }
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    const id = this.musicId;
    if (!ctx || !id || !this.musicGain) return;
    if (!this.musicEnabled) { this.pendingMusic = id; this.stopMusic(); return; }
    const track = MUSIC_TRACKS[id];
    const stepSec = 60 / track.bpm / track.stepsPerBeat;
    // Backgrounded tabs throttle setInterval to about once a second, so by
    // the time the next tick arrives the schedule can be well in the past.
    // Skipping forward drops those notes; without this the loop below
    // would instead schedule every missed step at once and the music would
    // come back as a chord of everything that should have played while the
    // player was away.
    if (this.musicNextTime < ctx.currentTime - 0.1) {
      this.musicNextTime = ctx.currentTime + 0.05;
    }
    while (this.musicNextTime < ctx.currentTime + AudioManager.MUSIC_LOOKAHEAD_SEC) {
      this.scheduleMusicStep(ctx, track, this.musicStep, this.musicNextTime, stepSec);
      this.musicStep += 1;
      this.musicNextTime += stepSec;
    }
  }

  private scheduleMusicStep(ctx: AudioContext, track: MusicTrack, step: number, at: number, stepSec: number): void {
    const bus = this.musicGain;
    if (!bus) return;
    for (const voice of track.voices) {
      const note = voice.steps[step % voice.steps.length];
      if (note == null) continue;
      const freq = track.rootHz * Math.pow(2, note / 12);
      const dur = stepSec * voice.hold;
      this.playMusicNote(ctx, bus, voice, freq, at, dur);
      if (voice.detune) this.playMusicNote(ctx, bus, voice, freq, at, dur, voice.detune);
    }
    if (track.drums) {
      const hit = track.drums[step % track.drums.length];
      if (hit && hit !== '.') this.playMusicDrum(ctx, bus, hit, at, track.drumGain ?? 0.3);
    }
  }

  private playMusicNote(
    ctx: AudioContext, bus: GainNode, voice: MusicVoice, freq: number, at: number, dur: number, detune = 0,
  ): void {
    const osc = ctx.createOscillator();
    osc.type = voice.wave;
    osc.frequency.setValueAtTime(freq, at);
    if (detune) osc.detune.setValueAtTime(detune, at);

    const g = ctx.createGain();
    const attack = Math.min(dur * 0.5, (voice.attackMs ?? 8) / 1000);
    const level = voice.gain * (detune ? 0.6 : 1);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    let tail: AudioNode = g;
    if (voice.filterHz) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = voice.filterHz;
      g.connect(f);
      tail = f;
    }
    osc.connect(g);
    tail.connect(bus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private playMusicDrum(ctx: AudioContext, bus: GainNode, kind: string, at: number, gain: number): void {
    if (kind === 'k') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      osc.connect(g).connect(bus);
      osc.start(at);
      osc.stop(at + 0.16);
      return;
    }
    // Snare and hat are both filtered noise, differing in where the filter
    // sits and how long they last; the snare gets a little body under it.
    const dur = kind === 's' ? 0.14 : 0.035;
    const src = ctx.createBufferSource();
    src.buffer = this.sharedNoise(ctx);
    src.playbackRate.value = 1;
    const offset = Math.random() * 1.5;
    const filter = ctx.createBiquadFilter();
    if (kind === 's') {
      filter.type = 'bandpass';
      filter.frequency.value = 1700;
      filter.Q.value = 0.9;
    } else {
      filter.type = 'highpass';
      filter.frequency.value = 7200;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain * (kind === 's' ? 0.9 : 0.32), at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(g).connect(bus);
    src.start(at, offset, dur + 0.02);
    if (kind === 's') {
      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(190, at);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(gain * 0.35, at);
      bg.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      body.connect(bg).connect(bus);
      body.start(at);
      body.stop(at + 0.1);
    }
  }


  /** The "aaaahh" a fighter lets out when they go down.
   *
   * Not a table entry like the other sounds, because a voice is not a
   * stack of envelopes: it is a buzzing source shaped by resonances. This
   * runs a sawtooth (the vocal folds) through three bandpass filters
   * parked on the formants of an open "ah" — roughly 730 / 1090 / 2440 Hz
   * — which is what makes it read as a mouth rather than as a synth. The
   * pitch rises for an instant on the shock and then falls away as the
   * fighter does, with vibrato on it, and a breath layer underneath.
   *
   * `pitch` scales the whole voice: above 1 for something small and yelpy,
   * below 1 for a boss going over like a wardrobe.
   */
  playScream(pitch = 1): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Randomised per play, or every death in a run sounds like the same
      // recording — which for a voice is far more obvious than for a thud.
      const base = (168 + Math.random() * 46) * pitch;
      const dur = (0.72 + Math.random() * 0.34) / Math.max(0.6, pitch);

      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.5, now + 0.045);
      master.gain.setValueAtTime(0.5, now + dur * 0.45);
      master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      master.connect(this.out(ctx));

      // The voice itself. Up sharply on the shock, then a long fall — the
      // classic cartoon drop — with a wobble that widens as it goes, the
      // way a held shout does when someone runs out of breath.
      const glottis = ctx.createOscillator();
      glottis.type = 'sawtooth';
      glottis.frequency.setValueAtTime(base * 0.82, now);
      glottis.frequency.exponentialRampToValueAtTime(base * 1.32, now + 0.09);
      glottis.frequency.exponentialRampToValueAtTime(base * 1.12, now + dur * 0.5);
      glottis.frequency.exponentialRampToValueAtTime(base * 0.52, now + dur);

      const vib = ctx.createOscillator();
      vib.type = 'sine';
      vib.frequency.setValueAtTime(5.2 + Math.random() * 1.8, now);
      const vibDepth = ctx.createGain();
      vibDepth.gain.setValueAtTime(base * 0.02, now);
      vibDepth.gain.linearRampToValueAtTime(base * 0.09, now + dur);
      vib.connect(vibDepth).connect(glottis.frequency);
      vib.start(now);
      vib.stop(now + dur);

      // Formants. The mouth opens a little further into the scream, so the
      // first two drift apart slightly — "ah" opening towards "aah".
      const formants: [number, number, number][] = [
        [730, 9, 1],      // freq, Q, level
        [1090, 11, 0.6],
        [2440, 13, 0.25],
      ];
      for (const [freq, q, level] of formants) {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.setValueAtTime(freq * pitch, now);
        f.frequency.linearRampToValueAtTime(freq * pitch * 1.12, now + dur * 0.6);
        f.frequency.linearRampToValueAtTime(freq * pitch * 0.9, now + dur);
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.value = level;
        glottis.connect(f).connect(g).connect(master);
      }
      glottis.start(now);
      glottis.stop(now + dur);

      // Breath. A voice with no air in it sounds like a kazoo.
      const breath = ctx.createBufferSource();
      breath.buffer = this.sharedNoise(ctx);
      const bf = ctx.createBiquadFilter();
      bf.type = 'bandpass';
      bf.frequency.setValueAtTime(1200 * pitch, now);
      bf.frequency.exponentialRampToValueAtTime(500 * pitch, now + dur);
      bf.Q.value = 0.8;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, now);
      bg.gain.exponentialRampToValueAtTime(0.16, now + 0.06);
      bg.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      breath.connect(bf).connect(bg).connect(master);
      breath.start(now, Math.random() * 1.2, dur + 0.05);
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
