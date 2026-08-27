import type { CSSProperties } from 'react';
import { useAppStore } from '../state/appStore';
import { WEAPON_LIST } from '../data/weapons';
import { SUPERPOWER_LIST } from '../data/superpowers';
import { ScreenHeader } from '../components/ScreenHeader';

// Section 42: unlocked weapons/superpowers shown normally, locked ones as
// silhouettes.
export function EquipmentScreen() {
  const save = useAppStore((s) => s.save);
  const setScreen = useAppStore((s) => s.setScreen);

  return (
    <div className="scroll-y" style={{ width: '100%', height: '100%', padding: 20, paddingTop: 'calc(20px + env(safe-area-inset-top,0px))' }}>
      <ScreenHeader title="AUSRÜSTUNG" onBack={() => setScreen('mainMenu')} />

      <h3 style={sectionTitleStyle}>Waffen</h3>
      <div style={gridStyle}>
        {WEAPON_LIST.map((w) => {
          const unlocked = save.unlockedWeapons.includes(w.id);
          return (
            <div key={w.id} className="panel" style={{ ...cardStyle, opacity: unlocked ? 1 : 0.4 }}>
              <div style={{ fontSize: 22 }}>{unlocked ? '⚔️' : '🔒'}</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{unlocked ? w.name : '???'}</div>
              {unlocked && <div style={{ fontSize: 11, opacity: 0.75 }}>{w.description}</div>}
            </div>
          );
        })}
      </div>

      <h3 style={sectionTitleStyle}>Superkräfte</h3>
      <div style={gridStyle}>
        {SUPERPOWER_LIST.map((s) => {
          const unlocked = save.unlockedSuperpowers.includes(s.id);
          return (
            <div key={s.id} className="panel" style={{ ...cardStyle, opacity: unlocked ? 1 : 0.4 }}>
              <div style={{ fontSize: 22 }}>{unlocked ? s.icon : '🔒'}</div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{unlocked ? s.name : '???'}</div>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                {unlocked ? s.description : `Freischaltung bei ${s.unlockAtKills} Kills`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const sectionTitleStyle = { color: '#ffd54f', marginTop: 20, marginBottom: 10 };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 };
const cardStyle: CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column', gap: 4, color: '#fff' };
