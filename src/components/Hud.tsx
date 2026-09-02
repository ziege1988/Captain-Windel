import type { CSSProperties } from 'react';
import type { HudState } from '../game/engine/GameEngine';

interface Props {
  hud: HudState;
  onPause: () => void;
}

// Section 31: clean HUD, health bars top-left/top-right, score/combo/level
// centered, doesn't obstruct the arena.
export function Hud({ hud, onPause }: Props) {
  const playerPct = clampPct(hud.playerHealth / Math.max(1, hud.playerMaxHealth));
  const enemyPct = clampPct(hud.enemyHealth / Math.max(1, hud.enemyMaxHealth));
  // Section 9: warn the player clearly once they're genuinely close to a
  // Game Over, not at any old scratch — the bar turns red and blinks only
  // below this threshold, staying calm/normal above it.
  const playerCritical = playerPct > 0 && playerPct < 0.2;

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none', padding: '10px 12px' }}>
      <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={nameLabelStyle}>Captain Windel</div>
            <HealthBar pct={playerPct} color="#4caf50" critical={playerCritical} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pointerEvents: 'auto' }}>
            <button
              onClick={onPause}
              style={{
                width: 42, height: 42, borderRadius: 12, background: 'rgba(0,0,0,0.5)',
                color: '#fff', fontSize: 18, border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              ⏸
            </button>
            <div style={levelLabelStyle}>
              {hud.chaosMode ? `CHAOS ${hud.level - 50}` : `LEVEL ${hud.level}`}
            </div>
            <LivesRow remaining={hud.livesRemaining} max={hud.maxLives} />
          </div>

          <div style={{ flex: 1, textAlign: 'right' }}>
            <div style={{ ...nameLabelStyle, textAlign: 'right' }}>
              {hud.isBossFight ? `👑 ${hud.enemyName}` : hud.enemyName}
            </div>
            <HealthBar pct={enemyPct} color={hud.isBossFight ? '#e53935' : '#ff9800'} reverse tall={hud.isBossFight} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 6 }}>
          <div style={scoreChipStyle}>SCORE {hud.score.toLocaleString('de-DE')}</div>
          {hud.combo > 1 && (
            <div style={{ ...scoreChipStyle, color: '#ffd54f' }}>COMBO x{hud.combo}</div>
          )}
          <div
            key={hud.coinFlash ? 'flash' : 'still'}
            style={{
              ...scoreChipStyle, color: '#ffd54f',
              animation: hud.coinFlash ? 'coinFlashPulse 0.55s ease-out' : 'none',
            }}
          >
            🪙 {hud.coins.toLocaleString('de-DE')}
          </div>
        </div>
      </div>

      {hud.toast && (
        <div style={toastStyle}>{hud.toast}</div>
      )}
    </div>
  );
}

function HealthBar({
  pct, color, reverse, tall, critical,
}: { pct: number; color: string; reverse?: boolean; tall?: boolean; critical?: boolean }) {
  return (
    <div style={{
      width: '100%', height: tall ? 16 : 12, borderRadius: 8, background: 'rgba(0,0,0,0.45)',
      border: critical ? '1px solid rgba(255,82,82,0.6)' : '1px solid rgba(255,255,255,0.25)', overflow: 'hidden',
    }}
    >
      <div style={{
        width: `${pct * 100}%`, height: '100%', background: critical ? '#ff1744' : color,
        transition: 'width 150ms ease-out, background 200ms ease-out', marginLeft: reverse ? 'auto' : 0,
        // Section 9: a gentle pulse, not a frantic strobe — slow enough to
        // read as a calm warning rather than a distracting screen effect,
        // and it never covers anything beyond the bar itself.
        animation: critical ? 'hudCriticalBlink 1.1s ease-in-out infinite' : 'none',
      }}
      />
    </div>
  );
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Persistent-progression pass (brief section 12/18): lives shown as
// ❤️/🖤 hearts — matches the brief's own worked example ("❤️❤️🖤") rather
// than the earlier baby-icon lives row.
function LivesRow({ remaining, max }: { remaining: number; max: number }) {
  return (
    <div style={{ display: 'flex', gap: 3 }} title={`${remaining} Leben übrig`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ fontSize: 12 }}>
          {i < remaining ? '❤️' : '🖤'}
        </span>
      ))}
    </div>
  );
}

const nameLabelStyle: CSSProperties = {
  fontSize: 12, fontWeight: 700, textShadow: '0 1px 2px rgba(0,0,0,0.8)', marginBottom: 3,
};
const levelLabelStyle: CSSProperties = {
  fontSize: 10, fontWeight: 700, background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: 6,
};
const scoreChipStyle: CSSProperties = {
  fontSize: 13, fontWeight: 700, background: 'rgba(0,0,0,0.45)', padding: '3px 10px', borderRadius: 10,
  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
};
const toastStyle: CSSProperties = {
  position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
  fontSize: 22, fontWeight: 800, color: '#ffd54f', textShadow: '0 2px 6px rgba(0,0,0,0.8)',
  animation: 'none',
};
