import { useAppStore } from '../state/appStore';
import { SUPERPOWER_LIST } from '../data/superpowers';
import { ScreenHeader } from '../components/ScreenHeader';
import { BALANCE } from '../data/balance';

// Section 24: choose which unlocked superpowers occupy the 3 active slots
// before a run. Activation itself always stays a deliberate in-combat
// player action (never automatic).
export function SuperpowersScreen() {
  const save = useAppStore((s) => s.save);
  const setScreen = useAppStore((s) => s.setScreen);
  const setSlot = useAppStore((s) => s.setSuperpowerSlot);

  const toggle = (id: (typeof SUPERPOWER_LIST)[number]['id']) => {
    const slots = save.equippedSuperpowerSlots;
    const currentIdx = slots.indexOf(id);
    if (currentIdx !== -1) {
      setSlot(currentIdx, null);
      return;
    }
    const freeIdx = slots.findIndex((s) => s === null);
    if (freeIdx !== -1) setSlot(freeIdx, id);
  };

  return (
    <div className="scroll-y" style={{ width: '100%', height: '100%', padding: 20, paddingTop: 'calc(20px + env(safe-area-inset-top,0px))' }}>
      <ScreenHeader title="SUPERKRÄFTE" onBack={() => setScreen('mainMenu')} />
      <p style={{ opacity: 0.75, fontSize: 13 }}>
        Wähle bis zu {BALANCE.player.superpowerSlots} aktive Superkräfte für deinen nächsten Kampf.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {SUPERPOWER_LIST.map((s) => {
          const unlocked = save.unlockedSuperpowers.includes(s.id);
          const equipped = save.equippedSuperpowerSlots.includes(s.id);
          return (
            <button
              key={s.id}
              className="panel"
              disabled={!unlocked}
              onClick={() => toggle(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: 14, textAlign: 'left',
                color: '#fff', opacity: unlocked ? 1 : 0.4,
                border: equipped ? '2px solid #ffd54f' : '2px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ fontSize: 28 }}>{unlocked ? s.icon : '🔒'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{unlocked ? s.name : `Freischaltung bei ${s.unlockAtKills} Kills`}</div>
                {unlocked && <div style={{ fontSize: 12, opacity: 0.75 }}>{s.description}</div>}
              </div>
              {equipped && <div style={{ fontSize: 12, color: '#ffd54f', fontWeight: 700 }}>AKTIV</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
