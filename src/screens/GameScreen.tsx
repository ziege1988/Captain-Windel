import { useEffect, useRef, useState } from 'react';
import { GameEngine, type HudState } from '../game/engine/GameEngine';
import { useAppStore } from '../state/appStore';
import { Hud } from '../components/Hud';
import { TouchControls } from '../components/TouchControls';
import { PauseOverlay } from '../components/PauseOverlay';
import { UpgradeOverlay } from '../components/UpgradeOverlay';
import { CampaignCompleteOverlay } from '../components/CampaignCompleteOverlay';
import { TutorialOverlay } from '../components/TutorialOverlay';
import { ShopOverlay } from '../components/ShopOverlay';
import { WEAPONS } from '../data/weapons';
import { SUPERPOWERS } from '../data/superpowers';
import { BALANCE, shouldOfferUpgrade } from '../data/balance';
import { audio } from '../game/audio/audioManager';

type Stage = 'tutorial' | 'playing' | 'paused' | 'campaignComplete' | 'upgrade' | 'shop';

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const save = useAppStore((s) => s.save);
  const startFromLevel = useAppStore((s) => s.startFromLevel);
  const finishRun = useAppStore((s) => s.finishRun);
  const recordKill = useAppStore((s) => s.recordKill);
  const noteLevelStarted = useAppStore((s) => s.noteLevelStarted);
  const setBossCheckpoint = useAppStore((s) => s.setBossCheckpoint);
  const markTutorialSeen = useAppStore((s) => s.markTutorialSeen);
  const setScreen = useAppStore((s) => s.setScreen);

  const [hud, setHud] = useState<HudState | null>(null);
  const [stage, setStage] = useState<Stage>(save.tutorialSeen ? 'playing' : 'tutorial');
  const wasLevelWon = useRef(false);
  const autoAdvanceTimeout = useRef<number | null>(null);
  // Persistent-progression pass: where to go once the shop overlay closes —
  // back to the pause menu it was opened from, or onward through the normal
  // post-victory flow (upgrade screen / next level) when it was auto-offered
  // right after a boss kill.
  const shopFromPause = useRef(false);
  const afterShopStage = useRef<'upgrade' | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    audio.soundEnabled = save.settings.soundOn;
    audio.musicEnabled = save.settings.musicOn;
    audio.vibrationEnabled = save.settings.vibrationOn;

    const engine = new GameEngine(canvasRef.current, save, startFromLevel, (h) => {
      setHud(h);
      // Record progress as it happens rather than only at the end of a run:
      // this is what lets the main menu offer to carry on from where the
      // player left off after they quit out mid-run.
      if (!h.chaosMode) noteLevelStarted(h.level);

      if (h.phase === 'levelWon' && !wasLevelWon.current) {
        wasLevelWon.current = true;
        const finalBoss = engine.levelIndex === BALANCE.campaign.totalLevels && engine.isBossLevel;
        const newlyUnlocked = recordKill(engine.isBossLevel ? (engine.bossDefId ?? undefined) : undefined);
        // Bosses are the campaign's checkpoints: beating one is what a
        // later Game Over rewinds to, so the fallback point moves to the
        // level right after this one.
        if (engine.isBossLevel && !engine.chaosMode) setBossCheckpoint(engine.levelIndex + 1);
        // Point 59: a boss kill that unlocks a new permanent superpower is a
        // real milestone — replace the engine's own brief "SIEG!" toast with
        // a proper showcase naming what was just earned.
        if (engine.isBossLevel && newlyUnlocked.length > 0) {
          const def = SUPERPOWERS[newlyUnlocked[0]];
          engine.toastMessage = `🏆 BOSS BESIEGT! Neue Spezialfähigkeit: ${def.icon} ${def.name}`;
          engine.toastTimerMs = 3200;
        }
        if (finalBoss) {
          setStage('campaignComplete');
        } else {
          const nextStage: 'upgrade' | null = shouldOfferUpgrade(engine.levelIndex, engine.isBossLevel) ? 'upgrade' : null;
          // Persistent-progression pass (brief section 3/16): "möglicherweise
          // automatisch nach einem Boss angeboten" — after a boss kill, if
          // the player has coins to spend and an empty special-weapon slot,
          // offer the shop right away (still fully skippable via "Weiter",
          // so it never forces a purchase or blocks progress).
          const offerShop = engine.isBossLevel
            && !engine.player.hasSpecialWeaponId
            && useAppStore.getState().save.unlockedSpecialWeapons.length > 0;
          if (offerShop) {
            shopFromPause.current = false;
            afterShopStage.current = nextStage;
            setStage('shop');
          } else if (nextStage) {
            setStage(nextStage);
          } else {
            // Not every win needs a new item — the engine's own post-kill
            // celebration beat (GameEngine.celebrationTimerMs) already gave
            // the player a real ~2.5s "I just won that" pause for normal
            // kills before phase even reached 'levelWon'; this is just a
            // short confirming beat before continuing on.
            autoAdvanceTimeout.current = window.setTimeout(() => {
              if (engine.phase === 'levelWon') engine.proceedToNextLevel();
            }, 700);
          }
        }
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
      if (autoAdvanceTimeout.current) window.clearTimeout(autoAdvanceTimeout.current);
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
            hasBonusWeapon={hud.hasBonusWeapon}
            airSupportUnlocked={hud.airSupportUnlocked}
            airSupportCooldownMs={hud.airSupportCooldownMs}
            bananaCooldownMs={hud.bananaCooldownMs}
            hasStorkBonusWeapon={hud.hasStorkBonusWeapon}
            specialWeaponId={hud.specialWeaponId}
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
          onResume={() => {
            engine.setPaused(false);
            setStage('playing');
            // If the level was won (and skipping the upgrade screen) while
            // paused, its auto-advance timer fired into a paused engine and
            // no-opped — pick it back up now instead of staying stuck.
            if (engine.phase === 'levelWon') engine.proceedToNextLevel();
          }}
          onRestartLevel={() => { engine.restartFromLevel(engine.levelIndex); engine.setPaused(false); setStage('playing'); }}
          onMainMenu={() => { setScreen('mainMenu'); }}
          onShop={() => { shopFromPause.current = true; setStage('shop'); }}
        />
      )}

      {engine && stage === 'shop' && (
        <ShopOverlay
          variant="overlay"
          heldWeaponId={engine.player.hasSpecialWeaponId}
          onPurchased={(id) => { engine.player.hasSpecialWeaponId = id; }}
          onClose={() => {
            if (shopFromPause.current) {
              shopFromPause.current = false;
              setStage('paused');
              return;
            }
            const next = afterShopStage.current;
            afterShopStage.current = null;
            if (next === 'upgrade') {
              setStage('upgrade');
            } else {
              setStage('playing');
              engine.proceedToNextLevel();
            }
          }}
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
