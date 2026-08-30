import type { CSSProperties } from 'react';
import { useAppStore } from '../state/appStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { StickFigurePreview } from '../components/StickFigurePreview';
import { CAPE_COLOR_LIST, CHARACTER_LIST } from '../data/characters';
import { audio } from '../game/audio/audioManager';

// Character-system overhaul: "MEIN CHARAKTER" — switch between the four
// unlocked-or-locked heroes (WÄHLE DEINEN HELDEN) and change the purely
// cosmetic cape color, all paid for with the same permanent coin balance
// used everywhere else. Nothing bought here ever changes a stat.
export function CharacterMenuScreen() {
  const save = useAppStore((s) => s.save);
  const setScreen = useAppStore((s) => s.setScreen);
  const selectCharacter = useAppStore((s) => s.selectCharacter);
  const purchaseCharacter = useAppStore((s) => s.purchaseCharacter);
  const equipCapeColor = useAppStore((s) => s.equipCapeColor);
  const purchaseCapeColor = useAppStore((s) => s.purchaseCapeColor);

  const tap = (fn: () => void) => () => {
    audio.unlock();
    fn();
  };

  return (
    <div className="scroll-y" style={{ width: '100%', height: '100%', padding: 20, paddingTop: 'calc(20px + env(safe-area-inset-top,0px))' }}>
      <ScreenHeader title="MEIN CHARAKTER" onBack={() => setScreen('mainMenu')} />
      <p style={{ textAlign: 'center', color: '#ffd54f', fontWeight: 700, marginTop: -4 }}>🪙 {save.coins}</p>

      <h3 style={sectionTitleStyle}>Wähle deinen Helden</h3>
      <div style={heroGridStyle}>
        {CHARACTER_LIST.map((def) => {
          const unlocked = save.unlockedCharacters.includes(def.id);
          const selected = save.selectedCharacter === def.id;
          return (
            <div key={def.id} className="panel" style={heroCardStyle}>
              <div style={{ opacity: unlocked ? 1 : 0.35, filter: unlocked ? 'none' : 'grayscale(1)' }}>
                <StickFigurePreview characterId={def.id} width={110} height={128} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{def.icon} {def.name}</div>
              <div style={{ fontSize: 11.5, opacity: 0.75, textAlign: 'center', minHeight: 30 }}>{def.tagline}</div>
              <div style={{ fontSize: 10.5, opacity: 0.6, fontStyle: 'italic' }}>{def.personality}</div>
              {selected ? (
                <button className="big-button secondary" disabled style={smallButtonStyle}>AUSGEWÄHLT</button>
              ) : unlocked ? (
                <button className="big-button" onClick={tap(() => selectCharacter(def.id))} style={smallButtonStyle}>AUSWÄHLEN</button>
              ) : (
                <button
                  className="big-button secondary"
                  disabled={save.coins < def.unlockCost}
                  onClick={tap(() => { if (purchaseCharacter(def.id)) audio.play('shopBuy'); })}
                  style={{ ...smallButtonStyle, opacity: save.coins < def.unlockCost ? 0.5 : 1 }}
                >
                  🔒 🪙 {def.unlockCost}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <h3 style={sectionTitleStyle}>Umhangfarbe</h3>
      <div style={capeGridStyle}>
        {CAPE_COLOR_LIST.map((cape) => {
          const unlocked = save.unlockedCapeColors.includes(cape.id);
          const equipped = save.equippedCapeColor === cape.id;
          return (
            <div key={cape.id} className="panel" style={capeCardStyle}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: cape.primary, border: `3px solid ${cape.secondary}` }} />
              <div style={{ fontSize: 11, fontWeight: 700, textAlign: 'center' }}>{cape.name}</div>
              {equipped ? (
                <button className="big-button secondary" disabled style={smallButtonStyle}>AKTIV</button>
              ) : unlocked ? (
                <button className="big-button" onClick={tap(() => equipCapeColor(cape.id))} style={smallButtonStyle}>TRAGEN</button>
              ) : (
                <button
                  className="big-button secondary"
                  disabled={save.coins < cape.price}
                  onClick={tap(() => { if (purchaseCapeColor(cape.id)) audio.play('shopBuy'); })}
                  style={{ ...smallButtonStyle, opacity: save.coins < cape.price ? 0.5 : 1 }}
                >
                  🔒 🪙 {cape.price}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const sectionTitleStyle: CSSProperties = { color: '#ffd54f', marginTop: 20, marginBottom: 10 };
const heroGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 };
const heroCardStyle: CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: '#fff' };
const capeGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10, paddingBottom: 20 };
const capeCardStyle: CSSProperties = { padding: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#fff' };
const smallButtonStyle: CSSProperties = { padding: '8px 10px', fontSize: 11.5, minHeight: 36, width: '100%' };
