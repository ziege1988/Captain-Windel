import { useAppStore } from '../state/appStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { isPersistent } from '../storage/storage';

// Section 34: locally persisted highscore stats.
export function HighscoreScreen() {
  const save = useAppStore((s) => s.save);
  const setScreen = useAppStore((s) => s.setScreen);

  return (
    <div className="scroll-y" style={{ width: '100%', height: '100%', padding: 20, paddingTop: 'calc(20px + env(safe-area-inset-top,0px))' }}>
      <ScreenHeader title="HIGH SCORE" onBack={() => setScreen('mainMenu')} />

      <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Row label="Höchster Score" value={save.highScore.toLocaleString('de-DE')} big />
        <Row label="Höchstes Level" value={String(save.highestLevelReached)} />
        <Row label="Höchste Combo" value={`x${save.highestCombo}`} />
        <Row label="Besiegte Bosse" value={`${save.bossesDefeated.length} / 10`} />
        <Row label="Freigeschaltete Waffen" value={`${save.unlockedWeapons.length} / 10`} />
        <Row label="Freigeschaltete Superkräfte" value={`${save.unlockedSuperpowers.length} / 6`} />
        {save.longestChaosRun > 0 && <Row label="Längster Chaos-Run" value={`${save.longestChaosRun} Level`} />}
      </div>

      {!isPersistent() && (
        <p style={{ fontSize: 12, opacity: 0.6, marginTop: 14 }}>
          Hinweis: Dein Browser erlaubt keinen dauerhaften Speicher — Fortschritt bleibt nur für diese Sitzung erhalten.
        </p>
      )}
    </div>
  );
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ opacity: 0.75, fontSize: 14 }}>{label}</span>
      <span style={{ fontWeight: 800, fontSize: big ? 22 : 15, color: big ? '#ffd54f' : '#fff' }}>{value}</span>
    </div>
  );
}
