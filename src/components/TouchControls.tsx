import { useRef, type CSSProperties } from 'react';
import type { GameEngine } from '../game/engine/GameEngine';
import type { HudState } from '../game/engine/GameEngine';
import type { SpecialWeaponId, SuperpowerId } from '../game/types';
import { SUPERPOWERS } from '../data/superpowers';
import { SPECIAL_WEAPONS } from '../data/specialWeapons';
import { audio } from '../game/audio/audioManager';

interface Props {
  engine: GameEngine;
  equippedSuperpowers: (SuperpowerId | null)[];
  cooldowns: Record<SuperpowerId, number>;
  weaponName: string;
  hasBanana: boolean;
  hasBonusWeapon: boolean;
  airSupportUnlocked: boolean;
  airSupportCooldownMs: number;
  bananaCooldownMs: number;
  hasStorkBonusWeapon: boolean;
  /** The special weapons carried into this fight — at most two kinds,
   * each with how many are left. Empty while nothing is bought. */
  specialWeapons: HudState['specialWeapons'];
  /** The current hero's signature ability. Never null — every character has
   * exactly one and it swaps with the character, so this button is a fixed
   * part of the layout rather than something that comes and goes. */
  characterAbility: HudState['characterAbility'];
}

// Section 7/40: large two-thumb touch layout — left thumb for movement,
// right thumb for combat actions. No control smaller than ~56px.
export function TouchControls({
  engine, equippedSuperpowers, cooldowns, weaponName, hasBanana, hasBonusWeapon,
  airSupportUnlocked, airSupportCooldownMs, bananaCooldownMs, hasStorkBonusWeapon, specialWeapons,
  characterAbility,
}: Props) {
  const activeDir = useRef<-1 | 0 | 1>(0);

  const setDir = (dir: -1 | 0 | 1) => {
    activeDir.current = dir;
    engine.setMoveDir(dir);
  };

  return (
    <div style={touchLayerStyle}>
      {/* Left cluster: superpowers (off-center, out of the way — section
          1 of the polish pass), movement + jump */}
      <div style={leftClusterStyle}>
        <div style={superpowerRowStyle}>
          {equippedSuperpowers.map((id, i) => {
            if (!id) return <div key={i} style={{ width: 44, height: 44 }} />;
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
                  width: 44, height: 44, borderRadius: '50%',
                  background: ready ? def.color : 'rgba(255,255,255,0.15)',
                  border: '2px solid rgba(255,255,255,0.4)',
                  fontSize: 19, position: 'relative', opacity: ready ? 1 : 0.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {def.icon}
                {!ready && (
                  <span style={{ position: 'absolute', bottom: -15, fontSize: 9, color: '#fff' }}>
                    {Math.ceil(cd / 1000)}s
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div style={dpadRowStyle}>
          <TouchButton label="◀" size={64} onDown={() => setDir(-1)} onUp={() => activeDir.current === -1 && setDir(0)} />
          <TouchButton label="▶" size={64} onDown={() => setDir(1)} onUp={() => activeDir.current === 1 && setDir(0)} />
        </div>
        <TouchButton label="⤒ SPRUNG" size={64} wide onDown={() => engine.jump()} />
      </div>

      {/* Right cluster: combat */}
      <div style={rightClusterStyle}>
        {/* Labels have to fit INSIDE the button. "AUSWEICHEN" is about
            twice the width of a 58px circle and "SCHLAG (Klopapier)" far
            wider than its own, so both used to spill out of the button and
            off the right edge of the screen — the button looked like it was
            hanging off the display. Short words only; the equipped weapon
            is named on its own line above the attack button instead. */}
        <div style={comboRowStyle}>
          {/* The hero's own signature ability. Deliberately its own button
              rather than a fourth slot in the superpower row on the left:
              those are earned and swappable, this one IS the character, so
              it never moves, never empties and is always in the same place
              no matter who is being played. It shares this row rather than
              taking one of its own because the control stack already
              reaches a long way up the screen, and pushing it further would
              start covering the fight. */}
          <SignatureButton ability={characterAbility} onUse={() => engine.useCharacterAbility()} />
          <TouchButton label="BLOCK" size={58} onDown={() => engine.blockStart()} onUp={() => engine.blockEnd()} />
          <TouchButton label="↺ ROLLE" size={58} onDown={() => engine.dodge()} />
        </div>
        <div style={weaponLabelStyle}>{weaponName}</div>
        <div style={comboRowStyle}>
          <TouchButton label="TRITT" size={62} onDown={() => engine.kick()} />
          <TouchButton label="SCHLAG" size={86} primary onDown={() => engine.attack()} />
        </div>
        <div style={comboRowStyle}>
          {hasBanana && (
            // The banana has a real cooldown; without showing it the button
            // just silently did nothing between uses and read as broken.
            <TouchButton
              label={bananaCooldownMs > 0 ? `🍌\n${Math.ceil(bananaCooldownMs / 1000)}s` : '🍌'}
              size={50}
              dimmed={bananaCooldownMs > 0}
              onDown={() => { if (bananaCooldownMs <= 0) engine.placeBananaPeel(); }}
            />
          )}
          {hasBonusWeapon && (
            <TouchButton label="🎁💣" size={54} onDown={() => engine.throwBonusWeapon()} />
          )}
          {hasStorkBonusWeapon && (
            <TouchButton label="🦢👶" size={54} onDown={() => engine.throwStorkBonusWeapon()} />
          )}
          {airSupportUnlocked && (
            <TouchButton
              label={airSupportCooldownMs > 0 ? `🦢\n${Math.ceil(airSupportCooldownMs / 1000)}s` : '🦢'}
              size={50}
              onDown={() => { if (airSupportCooldownMs <= 0) engine.useAirSupport(); }}
            />
          )}
          <TouchButton label="⇄ WAFFE" size={50} onDown={() => engine.cycleWeapon()} />
        </div>
        {/* One button per kind carried, side by side, each spending from
            its own count. Nothing bought means no buttons at all rather
            than a permanent dead "Keine Sonderwaffe" bar taking up the
            width of the whole cluster. */}
        {specialWeapons.length > 0 && (
          <div style={comboRowStyle}>
            {specialWeapons.map((w) => (
              <SpecialWeaponButton key={w.id} entry={w} onUse={() => engine.useSpecialWeapon(w.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Persistent-progression pass (brief section 5/18): a dedicated, clearly
// distinguishable button per shop-bought special weapon — its own icon
// and a pulsing gold glow, never confusable with the normal attack/kick
// buttons above it. The count sits in the corner of the icon, so how many
// are left is readable at a glance mid-fight without doing arithmetic on
// how many have been used.
function SpecialWeaponButton({ entry, onUse }: { entry: HudState['specialWeapons'][number]; onUse: () => void }) {
  const def = SPECIAL_WEAPONS[entry.id];
  const loaded = entry.count > 0;
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        audio.unlock();
        if (loaded) onUse();
      }}
      onContextMenu={(e) => e.preventDefault()}
      disabled={!loaded}
      title={`${def.name} einsetzen (${entry.count}x)`}
      style={{
        position: 'relative',
        width: 80, minHeight: 50, borderRadius: 14,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0,
        background: loaded ? 'linear-gradient(180deg,#ff8f00,#e65100)' : 'rgba(20,24,18,0.55)',
        color: loaded ? '#fff8e1' : 'rgba(255,255,255,0.5)',
        border: loaded ? '2px solid #ffd54f' : '2px solid rgba(255,255,255,0.15)',
        boxShadow: loaded ? '0 0 14px rgba(255,193,7,0.7)' : 'none',
        animation: loaded ? 'specialWeaponPulse 1.3s ease-in-out infinite' : 'none',
        fontWeight: 800, fontSize: 9, touchAction: 'none', whiteSpace: 'nowrap',
        opacity: loaded ? 1 : 0.45, overflow: 'visible', padding: 2,
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1 }}>{def.icon}</span>
      <span style={{ letterSpacing: 0.3 }}>SONDER</span>
      <span style={specialCountStyle}>{entry.count}x</span>
    </button>
  );
}

// Bottom-right corner of the button, over the icon — the same badge the
// shop puts on its icons, so "3x" reads identically in both places.
const specialCountStyle: CSSProperties = {
  position: 'absolute', right: -5, top: -6,
  fontSize: 11, fontWeight: 900, color: '#3e2723', background: '#ffd54f',
  border: '1.5px solid rgba(0,0,0,0.35)',
  borderRadius: 9, padding: '0 4px', lineHeight: '16px', minWidth: 20, textAlign: 'center',
};

/** The signature-ability button. Ready state gets the character's own
 * colour and a slow pulse so it reads as available at a glance; recharging
 * greys it out and counts down, so a tap that does nothing is never a
 * surprise. */
function SignatureButton({ ability, onUse }: { ability: HudState['characterAbility']; onUse: () => void }) {
  const { ready, cooldownMs, icon, label, color } = ability;
  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); audio.unlock(); if (ready) onUse(); }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 1, width: 68, height: 58, borderRadius: 16,
        background: ready
          ? `linear-gradient(160deg, ${color}, rgba(0,0,0,0.45))`
          : 'rgba(255,255,255,0.12)',
        border: `2px solid ${ready ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)'}`,
        boxShadow: ready ? `0 0 14px ${color}, 0 0 4px rgba(255,255,255,0.6) inset` : 'none',
        color: '#fff', opacity: ready ? 1 : 0.55,
        touchAction: 'none', overflow: 'hidden', padding: 2,
        animation: ready ? 'signatureReady 1.6s ease-in-out infinite' : 'none',
      }}
    >
      <span style={{ fontSize: 19, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
        {ready ? label : `${Math.ceil(cooldownMs / 1000)}s`}
      </span>
    </button>
  );
}

function TouchButton({
  label, size, onDown, onUp, primary, wide, dimmed,
}: { label: string; size: number; onDown: () => void; onUp?: () => void; primary?: boolean; wide?: boolean; dimmed?: boolean }) {
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
        opacity: dimmed ? 0.45 : 1,
        // A label that does not fit is clipped to the button rather than
        // spilling across the arena and off the edge of the screen.
        overflow: 'hidden',
        padding: 2,
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
const comboRowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' };
// The equipped weapon still has to be readable, it just cannot live inside
// a 78px circle — it sits above the attack button as its own caption.
const weaponLabelStyle: CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#ffe082', textAlign: 'right', width: '100%',
  textShadow: '0 1px 3px rgba(0,0,0,0.9)', marginBottom: -2, letterSpacing: 0.2,
  maxWidth: 168, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

// Section 1 (polish pass): superpowers used to float dead-center over the
// arena, right on top of the fighters' animations. Anchored to the left
// control cluster instead — off to the side, out of the fighters' way,
// still reachable by the same thumb that handles movement.
const superpowerRowStyle: CSSProperties = {
  display: 'flex', gap: 8, marginBottom: 2,
};
