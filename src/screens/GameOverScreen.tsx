import { useAppStore } from '../state/appStore';

// Section 33: game-over summary + restart / main menu.
export function GameOverScreen() {
  const summary = useAppStore((s) => s.lastRunSummary);
  const save = useAppStore((s) => s.save);
  const startNewRun = useAppStore((s) => s.startNewRun);
  const setScreen = useAppStore((s) => s.setScreen);

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center',
      background: 'radial-gradient(circle at 50% 20%, #3a1414, #10160f 70%)',
    }}
    >
      <h1 style={{ color: '#ef5350', margin: 0 }}>GAME OVER</h1>
      {summary && (
        <div className="panel" style={{ padding: 20, width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Row label="Level erreicht" value={String(summary.levelReached)} />
          <Row label="Besiegte Gegner" value={String(summary.enemiesDefeated)} />
          <Row label="Besiegte Bosse" value={String(summary.bossesDefeated)} />
          <Row label="Score" value={summary.score.toLocaleString('de-DE')} />
          <Row label="Höchste Combo" value={`x${summary.highestCombo}`} />
          {summary.score >= save.highScore && summary.score > 0 && (
            <div style={{ color: '#ffd54f', fontWeight: 700, marginTop: 4 }}>🏆 NEUER HIGHSCORE!</div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320, marginTop: 8 }}>
        <button className="big-button" onClick={startNewRun}>NOCHMAL SPIELEN</button>
        <button className="big-button secondary" onClick={() => setScreen('mainMenu')}>HAUPTMENÜ</button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}
