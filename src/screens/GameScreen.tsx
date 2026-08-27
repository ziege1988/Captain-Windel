import { useEffect, useRef, useState } from 'react';
import { GameEngine, type HudState } from '../game/engine/GameEngine';
import { useAppStore } from '../state/appStore';
import { Hud } from '../components/Hud';
import { TouchControls } from '../components/TouchControls';
import { PauseOverlay } from '../components/PauseOverlay';
import { UpgradeOverlay } from '../components/UpgradeOverlay';
import { CampaignCompleteOverlay } from '../components/CampaignCompleteOverlay';
import { TutorialOverlay } from '../components/TutorialOverlay';
import { WEAPONS } from '../data/weapons';
import { BALANCE } from '../data/balance';
import { audio } from '../game/audio/audioManager';

type Stage = 'tutorial' | 'playing' | 'paused' | 'campaignComplete' | 'upgrade';

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const save = useAppStore((s) => s.save);
  const startFromLevel = useAppStore((s) => s.startFromLevel);
  const finishRun = useAppStore((s) => s.finishRun);
  const recordKill = useAppStore((s) => s.recordKill);
  const markTutorialSeen = useAppStore((s) => s.markTutorialSeen);
  const setScreen = useAppStore((s) => s.setScreen);

  const [hud, setHud] = useState<HudState | null>(null);
  const [stage, setStage] = useState<Stage>(save.tutorialSeen ? 'playing' : 'tutorial');
  const wasLevelWon = useRef(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    audio.soundEnabled = save.settings.soundOn;
    audio.musicEnabled = save.settings.musicOn;
    audio.vibrationEnabled = save.settings.vibrationOn;

    const engine = new GameEngine(canvasRef.current, save, startFromLevel, (h) => {
      setHud(h);

      if (h.phase === 'levelWon' && !wasLevelWon.current) {
        wasLevelWon.current = true;
        const finalBoss = engine.levelIndex === BALANCE.campaign.totalLevels && engine.isBossLevel;
        recordKill(engine.isBossLevel ? (engine.bossDefId ?? undefined) : undefined);
        setStage(finalBoss ? 'campaignComplete' : 'upgrade');
      }
      if (h.phase === 'gameOver' && h.gameOverSummary) {
        finishRun({
          score: h.gameOverSummary.score,
          levelReached: h.gameOverSummary.level,
          enemiesDefeated: h.gameOverSummary.kills,
          bossesDefeated: h.gameOverSummary.bosses,
          highestCombo: h.gameOverSummary.combo,
          chaosMode: h.chaosMode,
        });
      }
      if (h.phase === 'playing') wasLevelWon.current = false;
    });
    engineRef.current = engine;
    if (!save.tutorialSeen) engine.setPaused(true);
    engine.start();

    const preventTouch = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', preventTouch, { passive: false });

    const handleResize = () => engine.resize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      engine.stop();
      document.removeEventListener('touchmove', preventTouch);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const engine = engineRef.current;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      >
        <canvas ref={canvasRef} style={{ display: 'block', touchAction: 'none' }} />
      </div>

      {engine && hud && stage === 'playing' && (
        <>
          <Hud hud={hud} onPause={() => { engine.setPaused(true); setStage('paused'); }} />
          <TouchControls
            engine={engine}
            equippedSuperpowers={save.equippedSuperpowerSlots}
            cooldowns={hud.superpowerCooldowns}
            weaponName={WEAPONS[hud.weaponId].name}
            hasBanana={engine.player.equippedUpgradeIds.includes('banana_peel')}
          />
        </>
      )}

      {hud && hud.phase === 'bossIntro' && stage === 'playing' && (
        <div style={bossIntroStyle}>
          <div style={{ fontSize: 13, letterSpacing: 3, color: '#ff5252', marginBottom: 6 }}>BOSS</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{hud.enemyName}</div>
          <div style={{ marginTop: 10, opacity: 0.85, maxWidth: 320 }}>{hud.bossIntroText}</div>
        </div>
      )}

      {stage === 'tutorial' && (
        <TutorialOverlay onDone={() => { markTutorialSeen(); engine?.setPaused(false); setStage('playing'); }} />
      )}

      {engine && stage === 'paused' && (
        <PauseOverlay
          onResume={() => { engine.setPaused(false); setStage('playing'); }}
          onRestartLevel={() => { engine.restartFromLevel(engine.levelIndex); engine.setPaused(false); setStage('playing'); }}
          onMainMenu={() => { setScreen('mainMenu'); }}
        />
      )}

      {engine && stage === 'campaignComplete' && (
        <CampaignCompleteOverlay
          score={engine.score}
          onContinue={() => setStage('upgrade')}
        />
      )}

      {engine && stage === 'upgrade' && (
        <UpgradeOverlay
          engine={engine}
          onDone={() => {
            engine.proceedToNextLevel();
            setStage('playing');
          }}
        />
      )}
    </div>
  );
}

const bossIntroStyle: import('react').CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', textAlign: 'center',
  background: 'rgba(0,0,0,0.55)', color: '#fff', padding: 24,
};
