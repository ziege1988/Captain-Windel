// Section 38: sound architecture built around named categories so real
// sample files can replace the synthesized placeholders later without
// touching any call site — every call site just does
// `audio.play('criticalHit')`.
export type SoundId =
  | 'hit' | 'heavyHit' | 'criticalHit' | 'jump' | 'land' | 'weaponSwing'
  | 'enemyHit' | 'vomit' | 'fart' | 'explosion' | 'superpower'
  | 'victory' | 'gameOver' | 'bossIntro' | 'block' | 'dodge' | 'upgrade' | 'menuTap';

interface SoundSpec {
  wave: OscillatorType | 'noise';
  freqStart: number;
  freqEnd: number;
  durationMs: number;
  volume: number;
}

const SOUND_SPECS: Record<SoundId, SoundSpec> = {
  hit: { wave: 'square', freqStart: 220, freqEnd: 120, durationMs: 80, volume: 0.35 },
  heavyHit: { wave: 'square', freqStart: 160, freqEnd: 70, durationMs: 140, volume: 0.45 },
  criticalHit: { wave: 'sawtooth', freqStart: 320, freqEnd: 60, durationMs: 220, volume: 0.55 },
  jump: { wave: 'sine', freqStart: 300, freqEnd: 520, durationMs: 120, volume: 0.25 },
  land: { wave: 'sine', freqStart: 200, freqEnd: 80, durationMs: 90, volume: 0.25 },
  weaponSwing: { wave: 'triangle', freqStart: 500, freqEnd: 300, durationMs: 90, volume: 0.2 },
  enemyHit: { wave: 'square', freqStart: 180, freqEnd: 90, durationMs: 90, volume: 0.3 },
  vomit: { wave: 'noise', freqStart: 200, freqEnd: 80, durationMs: 350, volume: 0.3 },
  fart: { wave: 'noise', freqStart: 140, freqEnd: 40, durationMs: 450, volume: 0.5 },
  explosion: { wave: 'noise', freqStart: 220, freqEnd: 40, durationMs: 400, volume: 0.55 },
  superpower: { wave: 'sawtooth', freqStart: 100, freqEnd: 700, durationMs: 400, volume: 0.4 },
  victory: { wave: 'sine', freqStart: 440, freqEnd: 880, durationMs: 500, volume: 0.4 },
  gameOver: { wave: 'sine', freqStart: 300, freqEnd: 90, durationMs: 700, volume: 0.4 },
  bossIntro: { wave: 'sawtooth', freqStart: 80, freqEnd: 220, durationMs: 600, volume: 0.45 },
  block: { wave: 'square', freqStart: 400, freqEnd: 350, durationMs: 60, volume: 0.25 },
  dodge: { wave: 'sine', freqStart: 500, freqEnd: 650, durationMs: 80, volume: 0.2 },
  upgrade: { wave: 'sine', freqStart: 400, freqEnd: 900, durationMs: 250, volume: 0.35 },
  menuTap: { wave: 'sine', freqStart: 600, freqEnd: 700, durationMs: 50, volume: 0.2 },
};

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

  play(id: SoundId): void {
    if (!this.soundEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const spec = SOUND_SPECS[id];
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(spec.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + spec.durationMs / 1000);
      gain.connect(ctx.destination);

      if (spec.wave === 'noise') {
        const bufferSize = Math.floor(ctx.sampleRate * (spec.durationMs / 1000));
        const buffer = ctx.createBuffer(1, Math.max(1, bufferSize), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(spec.freqStart, now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, spec.freqEnd), now + spec.durationMs / 1000);
        src.connect(filter).connect(gain);
        src.start(now);
        src.stop(now + spec.durationMs / 1000);
      } else {
        const osc = ctx.createOscillator();
        osc.type = spec.wave;
        osc.frequency.setValueAtTime(spec.freqStart, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, spec.freqEnd), now + spec.durationMs / 1000);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + spec.durationMs / 1000);
      }
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
