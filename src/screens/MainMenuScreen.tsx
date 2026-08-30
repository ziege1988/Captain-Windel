import { useAppStore } from '../state/appStore';
import { audio } from '../game/audio/audioManager';
import { StickFigurePreview } from '../components/StickFigurePreview';

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
    <div
      style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-between', padding: '32px 20px',
        background: 'radial-gradient(circle at 50% 20%, #2f5233, #10160f 75%)',
        paddingTop: 'calc(32px + env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          fontSize: 'clamp(2rem, 9vw, 3rem)', margin: 0, letterSpacing: 1,
          color: '#ffd54f', textShadow: '0 3px 0 #7a5200, 0 6px 10px rgba(0,0,0,0.4)',
        }}
        >
          CAPTAIN WINDEL
        </h1>
        <p style={{ opacity: 0.75, marginTop: 8 }}>Windel. Umhang. Absurde Superkräfte.</p>
        <p style={{ marginTop: 10, fontSize: 15, fontWeight: 700, color: '#ffd54f' }}>🪙 {save.coins}</p>
      </div>

      <StickFigurePreview characterId={save.selectedCharacter} capeColorId={save.equippedCapeColor} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 340 }}>
        <button className="big-button" onClick={tap(startNewRun)}>SPIELEN</button>
        {canContinue && (
          <button className="big-button secondary" onClick={tap(continueRun)}>
            WEITER (Level {save.highestLevelReached})
          </button>
        )}
        <button className="big-button secondary" onClick={tap(() => setScreen('characterMenu'))}>🦸 MEIN CHARAKTER</button>
        <button className="big-button secondary" onClick={tap(() => setScreen('shop'))}>💰 WAFFENKAMMER</button>
        <button className="big-button secondary" onClick={tap(() => setScreen('equipment'))}>AUSRÜSTUNG</button>
        <button className="big-button secondary" onClick={tap(() => setScreen('superpowers'))}>SUPERKRÄFTE</button>
        <button className="big-button secondary" onClick={tap(() => setScreen('highscore'))}>HIGH SCORE</button>
        <button className="big-button secondary" onClick={tap(() => setScreen('options'))}>OPTIONEN</button>
      </div>
    </div>
  );
}
