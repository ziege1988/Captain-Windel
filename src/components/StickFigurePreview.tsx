import { useEffect, useRef } from 'react';
import { Fighter } from '../game/entities/Fighter';
import { BALANCE } from '../data/balance';
import { renderFighter } from '../game/engine/renderFighter';
import { CHARACTERS } from '../data/characters';
import type { AnimState, CapeColorId, CharacterId } from '../game/types';

interface Props {
  characterId?: CharacterId;
  capeColorId?: CapeColorId;
  anim?: AnimState;
  width?: number;
  height?: number;
}

// Lightweight standalone preview (main menu hero shot + character-select
// cards) — reuses the exact same rig renderer as the real game, parameterized
// by character/cape so every hero always looks consistent with how they
// actually play, but runs its own tiny animation loop independent of the
// GameEngine.
export function StickFigurePreview({ characterId = 'windelmann', capeColorId, anim = 'idle', width = 180, height = 210 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = 220;
    const h = 260;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const def = CHARACTERS[characterId];
    const groundY = h - 30;
    const f = new Fighter('preview', 'player', def.name, { ...BALANCE.player.baseStats }, w / 2, groundY);
    f.characterId = characterId;
    f.color = def.bodyColor;
    f.capeColorId = capeColorId ?? def.defaultCape;
    f.accessories = characterId === 'windelmann' ? ['diaper', 'cape'] : ['cape'];
    f.facing = 1;
    f.setAnim(anim, true);

    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(40, t - last);
      last = t;
      f.updateTimers(dt);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(10, groundY);
      ctx.lineTo(w - 10, groundY);
      ctx.stroke();
      ctx.restore();
      renderFighter(ctx, f, dt / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [characterId, capeColorId, anim]);

  return <canvas ref={canvasRef} style={{ width, height }} />;
}
