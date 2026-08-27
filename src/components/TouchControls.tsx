import { useRef, type CSSProperties } from 'react';
import type { GameEngine } from '../game/engine/GameEngine';
import type { SuperpowerId } from '../game/types';
import { SUPERPOWERS } from '../data/superpowers';
import { audio } from '../game/audio/audioManager';

interface Props {
  engine: GameEngine;
  equippedSuperpowers: (SuperpowerId | null)[];
  cooldowns: Record<SuperpowerId, number>;
  weaponName: string;
  hasBanana: boolean;
}

// Section 7/40: large two-thumb touch layout — left thumb for movement,
// right thumb for combat actions. No control smaller than ~56px.
export function TouchControls({ engine, equippedSuperpowers, cooldowns, weaponName, hasBanana }: Props) {
  const activeDir = useRef<-1 | 0 | 1>(0);

  const setDir = (dir: -1 | 0 | 1) => {
    activeDir.current = dir;
    engine.setMoveDir(dir);
  };

  return (
    <div style={touchLayerStyle}>
      {/* Left cluster: movement + jump */}
      <div style={leftClusterStyle}>
        <div style={dpadRowStyle}>
          <TouchButton label="◀" size={64} onDown={() => setDir(-1)} onUp={() => activeDir.current === -1 && setDir(0)} />
          <TouchButton label="▶" size={64} onDown={() => setDir(1)} onUp={() => activeDir.current === 1 && setDir(0)} />
        </div>
        <TouchButton label="⤒ SPRUNG" size={64} wide onDown={() => engine.jump()} />
      </div>

      {/* Right cluster: combat */}
      <div style={rightClusterStyle}>
        <div style={comboRowStyle}>
          <TouchButton label="BLOCK" size={58} onDown={() => engine.blockStart()} onUp={() => engine.blockEnd()} />
          <TouchButton label="AUSWEICHEN" size={58} onDown={() => engine.dodge()} />
        </div>
        <div style={comboRowStyle}>
          <TouchButton label="TRITT" size={62} onDown={() => engine.kick()} />
          <TouchButton label={`SCHLAG\n(${weaponName})`} size={78} primary onDown={() => engine.attack()} />
        </div>
        <div style={comboRowStyle}>
          {hasBanana && (
            <TouchButton label="🍌" size={50} onDown={() => engine.placeBananaPeel()} />
          )}
          <TouchButton label="⇄ WAFFE" size={50} onDown={() => engine.cycleWeapon()} />
        </div>
      </div>

      {/* Superpower slots */}
      <div style={superpowerRowStyle}>
        {equippedSuperpowers.map((id, i) => {
          if (!id) return <div key={i} style={{ width: 56, height: 56 }} />;
          const def = SUPERPOWERS[id];
          const cd = cooldowns[id] ?? 0;
          const ready = cd <= 0;
          return (
            <button
              key={id}
              onPointerDown={(e) => {
                e.preventDefault();
                audio.unlock();
                if (ready) engine.useSuperpower(id);
              }}
              style={{
                width: 56, height: 56, borderRadius: '50%',
                background: ready ? def.color : 'rgba(255,255,255,0.15)',
                border: '2px solid rgba(255,255,255,0.4)',
                fontSize: 24, position: 'relative', opacity: ready ? 1 : 0.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {def.icon}
              {!ready && (
                <span style={{ position: 'absolute', bottom: -16, fontSize: 10, color: '#fff' }}>
                  {Math.ceil(cd / 1000)}s
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TouchButton({
  label, size, onDown, onUp, primary, wide,
}: { label: string; size: number; onDown: () => void; onUp?: () => void; primary?: boolean; wide?: boolean }) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        audio.unlock();
        onDown();
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        onUp?.();
      }}
      onPointerLeave={() => onUp?.()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: wide ? size * 2 + 12 : size,
        height: size,
        borderRadius: size / 2,
        background: primary ? 'linear-gradient(180deg,#ffd54f,#ffb300)' : 'rgba(20,24,18,0.75)',
        color: primary ? '#2a1e00' : '#fff',
        fontWeight: 700,
        fontSize: primary ? 13 : 12,
        border: '2px solid rgba(255,255,255,0.25)',
        whiteSpace: 'pre-line',
        lineHeight: 1.1,
        touchAction: 'none',
      }}
    >
      {label}
    </button>
  );
}

const touchLayerStyle: CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none',
  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
  paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
};

const leftClusterStyle: CSSProperties = {
  position: 'absolute', left: 'calc(14px + env(safe-area-inset-left, 0px))', bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
  display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', pointerEvents: 'auto',
};

const rightClusterStyle: CSSProperties = {
  position: 'absolute', right: 'calc(14px + env(safe-area-inset-right, 0px))', bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))',
  display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', pointerEvents: 'auto',
};

const dpadRowStyle: CSSProperties = { display: 'flex', gap: 10 };
const comboRowStyle: CSSProperties = { display: 'flex', gap: 8 };

const superpowerRowStyle: CSSProperties = {
  position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(180px + env(safe-area-inset-bottom, 0px))',
  display: 'flex', gap: 10, pointerEvents: 'auto',
};
