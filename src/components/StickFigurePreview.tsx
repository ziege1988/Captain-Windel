import { useEffect, useRef } from 'react';
import { Fighter } from '../game/entities/Fighter';
import { BALANCE } from '../data/balance';
import { renderFighter } from '../game/engine/renderFighter';

// Lightweight standalone preview (main menu hero shot) — reuses the same
// stickman renderer as the real game so Captain Windel always looks
// consistent, but runs its own tiny animation loop independent of the
// GameEngine.
export function StickFigurePreview() {
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

    const groundY = h - 30;
    const f = new Fighter('preview', 'player', 'Captain Windel', { ...BALANCE.player.baseStats }, w / 2, groundY);
    f.accessories = ['diaper', 'cape'];
    f.facing = 1;
    f.setAnim('idle', true);

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
  }, []);

  return <canvas ref={canvasRef} style={{ width: 180, height: 210 }} />;
}
