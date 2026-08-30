import { useEffect, useRef } from 'react';
import { Fighter } from '../game/entities/Fighter';
import { BALANCE } from '../data/balance';
import { renderFighter } from '../game/engine/renderFighter';
import { renderArena, type ArenaLayout } from '../game/engine/renderArena';
import { ARENAS } from '../data/arenas';
import { CHARACTERS } from '../data/characters';
import type { CapeColorId, CharacterId } from '../game/types';

interface Props {
  characterId: CharacterId;
  capeColorId: CapeColorId;
}

const LOOP_MS = 8000;

/** Menu-visual pass: a small live arena scene behind the main menu instead
 * of a flat gradient — the same renderArena/renderFighter functions the
 * real game uses, driven by a short scripted 8s loop (idle -> an enemy
 * runs through -> a quick kick pose -> the enemy reacts -> resets) rather
 * than a real GameEngine, since this is purely decorative and never needs
 * physics/combat/input. Kept deliberately calm (slow loop, no UI of its
 * own) so it reads as "a living background," not something competing with
 * the actual menu buttons for attention. */
export function MenuArenaBackground({ characterId, capeColorId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth || 360;
      h = canvas.clientHeight || 640;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const def = CHARACTERS[characterId];
    const player = new Fighter('menu_player', 'player', def.name, { ...BALANCE.player.baseStats }, 0, 0);
    player.characterId = characterId;
    player.color = def.bodyColor;
    player.capeColorId = capeColorId;
    player.accessories = characterId === 'windelmann' ? ['diaper', 'cape'] : ['cape'];
    player.scale = 1.25;
    player.facing = 1;
    player.setAnim('idle', true);

    const enemy = new Fighter('menu_enemy', 'enemy', 'Herausforderer', { ...BALANCE.player.baseStats, maxHealth: 60 }, 0, 0);
    enemy.color = '#37474f';
    enemy.accessories = ['boxingGloves'];
    enemy.facing = -1;
    enemy.scale = 1.15;
    enemy.setAnim('idle', true);

    let raf = 0;
    let last = performance.now();
    const startedAt = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      resize();
      const groundY = h * 0.78;
      const layout: ArenaLayout = { width: w, height: h, groundY, minX: w * 0.06, maxX: w * 0.94 };

      const t = (now - startedAt) % LOOP_MS;
      const p = t / LOOP_MS;
      const playerX = w * 0.34;
      const farX = w * 1.15;
      const nearX = w * 0.63;

      if (p < 0.3) {
        enemy.setAnim('idle');
        enemy.body.pos.x = farX;
      } else if (p < 0.5) {
        const q = (p - 0.3) / 0.2;
        enemy.setAnim('run');
        enemy.body.pos.x = farX + (nearX - farX) * q;
        enemy.facing = -1;
      } else if (p < 0.6) {
        player.setAnim('kick', true);
        enemy.setAnim('idle');
        enemy.body.pos.x = nearX;
      } else if (p < 0.78) {
        enemy.setAnim('hit', true);
        enemy.body.pos.x = nearX + w * 0.05;
      } else if (p < 0.96) {
        const q = (p - 0.78) / 0.18;
        enemy.setAnim('run');
        enemy.facing = -1;
        enemy.body.pos.x = nearX + (farX - nearX) * q;
      } else {
        enemy.setAnim('idle');
        enemy.body.pos.x = farX;
      }
      if (player.anim === 'kick' && p >= 0.6) player.setAnim('idle');

      player.body.pos.x = playerX;
      player.body.pos.y = groundY;
      player.body.groundY = groundY;
      player.body.grounded = true;
      enemy.body.pos.y = groundY;
      enemy.body.groundY = groundY;
      enemy.body.grounded = true;
      player.updateTimers(dt);
      enemy.updateTimers(dt);

      ctx.clearRect(0, 0, w, h);
      renderArena(ctx, ARENAS.meadow, layout, now / 1000);
      const dtSec = dt / 1000;
      const fighters = enemy.body.pos.x < playerX ? [enemy, player] : [player, enemy];
      for (const f of fighters) renderFighter(ctx, f, dtSec);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [characterId, capeColorId]);

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />;
}
