import type { CSSProperties } from 'react';
import { useAppStore } from '../state/appStore';
import { audio } from '../game/audio/audioManager';
import { MenuArenaBackground } from '../components/MenuArenaBackground';

// Menu-visual pass: the previous layout (large title, a standalone 210px
// character preview, one full-width button per action) reliably overflowed
// a real phone viewport — HIGH SCORE sat below the fold with no scrolling.
// This compacts the header and folds every secondary action into a 2-column
// grid so the *entire* menu, including its lowest button, fits inside the
// safe area on a small screen with no scrolling, while a small looping
// arena scene now lives behind everything as a living background instead of
// a flat gradient.
export function MainMenuScreen() {
  const save = useAppStore((s) => s.save);
  const startNewRun = useAppStore((s) => s.startNewRun);
  const continueRun = useAppStore((s) => s.continueRun);
  const setScreen = useAppStore((s) => s.setScreen);

  const canContinue = save.highestLevelReached > 1;

  const tap = (fn: () => void) => () => {
    audio.unlock();
    audio.play('menuTap');
    fn();
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#10160f' }}>
      <MenuArenaBackground characterId={save.selectedCharacter} capeColorId={save.equippedCapeColor} />

      {/* A soft top/bottom darkening so text and buttons stay readable over
          the animated scene without needing a heavy, distracting overlay. */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(8,12,8,0.72) 0%, rgba(8,12,8,0.1) 22%, rgba(8,12,8,0.1) 60%, rgba(8,12,8,0.8) 100%)' }} />

      <div
        style={{
          position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
          paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))',
          paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h1 style={{
            fontSize: 'clamp(1.5rem, 8vw, 2.1rem)', margin: 0, letterSpacing: 1,
            color: '#ffd54f', textShadow: '0 2px 0 #7a5200, 0 4px 8px rgba(0,0,0,0.5)',
          }}
          >
            CAPTAIN WINDEL
          </h1>
          <p style={{ opacity: 0.85, marginTop: 2, marginBottom: 0, fontSize: 12.5, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            Windel. Umhang. Absurde Superkräfte.
          </p>
          <p style={{ marginTop: 4, fontSize: 13.5, fontWeight: 700, color: '#ffd54f', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
            🪙 {save.coins}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 360 }}>
          <button className="big-button" style={primaryStyle} onClick={tap(startNewRun)}>SPIELEN</button>
          {canContinue && (
            <button className="big-button secondary" style={compactStyle} onClick={tap(continueRun)}>
              WEITER (Level {save.highestLevelReached})
            </button>
          )}
          <div style={gridStyle}>
            <button className="big-button secondary" style={gridButtonStyle} onClick={tap(() => setScreen('characterMenu'))}>🦸 MEIN CHARAKTER</button>
            <button className="big-button secondary" style={gridButtonStyle} onClick={tap(() => setScreen('shop'))}>💰 WAFFENKAMMER</button>
            <button className="big-button secondary" style={gridButtonStyle} onClick={tap(() => setScreen('equipment'))}>AUSRÜSTUNG</button>
            <button className="big-button secondary" style={gridButtonStyle} onClick={tap(() => setScreen('superpowers'))}>SUPERKRÄFTE</button>
            <button className="big-button secondary" style={gridButtonStyle} onClick={tap(() => setScreen('highscore'))}>HIGH SCORE</button>
            <button className="big-button secondary" style={gridButtonStyle} onClick={tap(() => setScreen('options'))}>OPTIONEN</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const primaryStyle: CSSProperties = { minHeight: 46, padding: '10px 20px', fontSize: '1.05rem' };
const compactStyle: CSSProperties = { minHeight: 38, padding: '8px 16px', fontSize: '0.85rem' };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };
const gridButtonStyle: CSSProperties = { minHeight: 40, padding: '6px 8px', fontSize: '0.72rem', lineHeight: 1.2 };
