import { useState, type CSSProperties } from 'react';
import { useAppStore } from '../state/appStore';
import { PLAYER_WEAPON_LIST, WEAPON_MAX_LEVEL, weaponUpgradeCost, weaponUpgradeStats } from '../data/weapons';
import { SUPERPOWER_LIST, unlockBossName } from '../data/superpowers';
import { BOSSES } from '../data/bosses';
import { ScreenHeader } from '../components/ScreenHeader';
import { audio } from '../game/audio/audioManager';
import type { WeaponId } from '../game/types';

// Section 42: unlocked weapons/superpowers shown normally, locked ones as
// silhouettes — plus the coin sink: every unlocked weapon can be sharpened
// a level at a time, and the card states exactly what the next level buys
// and what it costs before you spend anything.
export function EquipmentScreen() {
  const save = useAppStore((s) => s.save);
  const setScreen = useAppStore((s) => s.setScreen);
  const upgradeWeapon = useAppStore((s) => s.upgradeWeapon);
  const [notice, setNotice] = useState<string | null>(null);

  const buy = (id: WeaponId) => {
    const result = upgradeWeapon(id);
    if (result === 'ok') {
      audio.play('upgrade');
      setNotice(null);
      return;
    }
    setNotice(result === 'tooPoor' ? 'Nicht genug Münzen.' : result === 'maxed' ? 'Schon voll ausgebaut.' : 'Noch nicht freigeschaltet.');
  };

  return (
    <div className="scroll-y" style={{ width: '100%', height: '100%', padding: 20, paddingTop: 'calc(20px + env(safe-area-inset-top,0px))' }}>
      <ScreenHeader title="AUSRÜSTUNG" onBack={() => setScreen('mainMenu')} />

      <p style={{ textAlign: 'center', color: '#ffd54f', fontWeight: 700, margin: '0 0 4px' }}>🪙 {save.coins}</p>
      <p style={{ textAlign: 'center', fontSize: 11.5, opacity: 0.75, color: '#fff', margin: 0 }}>
        Münzen schärfen Waffen. Jede Stufe: mehr Schaden, mehr Rückstoß, schnellere Schläge.
      </p>
      {notice && (
        <p style={{ textAlign: 'center', fontSize: 12, color: '#ff8a65', fontWeight: 700, marginTop: 6 }}>{notice}</p>
      )}

      <h3 style={sectionTitleStyle}>Waffen</h3>
      <div style={gridStyle}>
        {PLAYER_WEAPON_LIST.map((w) => {
          const unlocked = save.unlockedWeapons.includes(w.id);
          const level = save.weaponLevels[w.id] ?? 0;
          const cost = weaponUpgradeCost(w.id, level);
          const now = weaponUpgradeStats(level);
          const next = weaponUpgradeStats(level + 1);
          const affordable = cost != null && save.coins >= cost;
          return (
            <div
              key={w.id}
              className="panel"
              style={{
                ...cardStyle,
                opacity: unlocked ? 1 : 0.4,
                border: level > 0 ? '2px solid #ffd54f' : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 22 }}>{unlocked ? '⚔️' : '🔒'}</span>
                <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{unlocked ? w.name : '???'}</span>
                {unlocked && <span style={levelPillStyle}>Stufe {level + 1}</span>}
              </div>
              {unlocked && <div style={{ fontSize: 11, opacity: 0.75 }}>{w.description}</div>}
              {unlocked && (
                <>
                  {/* One pip per level, so how far along this weapon is
                      reads at a glance without counting numbers. */}
                  <div style={{ display: 'flex', gap: 3 }}>
                    {Array.from({ length: WEAPON_MAX_LEVEL }, (_, i) => (
                      <span key={i} style={{ ...pipStyle, background: i < level ? '#ffd54f' : 'rgba(255,255,255,0.16)' }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#aed581' }}>
                    Jetzt: +{Math.round((now.damageMult - 1) * 100)}% Schaden
                  </div>
                  {cost == null ? (
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#ffd54f' }}>★ Voll ausgebaut</div>
                  ) : (
                    <button
                      className="big-button secondary"
                      disabled={!affordable}
                      onClick={() => buy(w.id)}
                      style={{ padding: '7px 10px', fontSize: 11.5, minHeight: 34, opacity: affordable ? 1 : 0.5 }}
                    >
                      🪙 {cost} · +{Math.round((next.damageMult - now.damageMult) * 100)}% SCHADEN
                    </button>
                  )}
                </>
              )}
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
                {unlocked ? s.description : (() => {
                  const bossId = unlockBossName(s);
                  return bossId ? `Freischaltung: Boss "${BOSSES[bossId].name}" besiegen` : 'Freischaltung: von Anfang an';
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const sectionTitleStyle = { color: '#ffd54f', marginTop: 20, marginBottom: 10 };
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 };
const cardStyle: CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column', gap: 5, color: '#fff' };
const levelPillStyle: CSSProperties = {
  fontSize: 10, fontWeight: 800, color: '#3e2723', background: '#ffd54f',
  borderRadius: 8, padding: '1px 6px', whiteSpace: 'nowrap',
};
const pipStyle: CSSProperties = { flex: 1, height: 5, borderRadius: 3 };
