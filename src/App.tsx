import { useEffect } from 'react';
import { useAppStore } from './state/appStore';
import { ErrorBoundary } from './ErrorBoundary';
import { audio } from './game/audio/audioManager';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { GameScreen } from './screens/GameScreen';
import { EquipmentScreen } from './screens/EquipmentScreen';
import { SuperpowersScreen } from './screens/SuperpowersScreen';
import { HighscoreScreen } from './screens/HighscoreScreen';
import { OptionsScreen } from './screens/OptionsScreen';
import { GameOverScreen } from './screens/GameOverScreen';
import { ShopScreen } from './screens/ShopScreen';
import { CharacterMenuScreen } from './screens/CharacterMenuScreen';

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const runId = useAppStore((s) => s.runId);
  const musicOn = useAppStore((s) => s.save.settings.musicOn);

  // Which music the current screen wants. Declared here rather than in
  // each screen so moving between menus (shop, options, character select,
  // game over) keeps one continuous menu track instead of restarting it
  // every time a screen mounts.
  useEffect(() => {
    audio.musicEnabled = musicOn;
    if (!musicOn) return;
    audio.playMusic(screen === 'game' ? 'game' : 'menu');
  }, [screen, musicOn]);

  // Browsers refuse to play anything until the player has interacted, and
  // the main menu is on screen before they have touched it — so the very
  // first touch anywhere releases whatever is waiting. Every button
  // already unlocks on tap; this covers a first touch that lands
  // somewhere else.
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('touchstart', unlock, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('touchstart', unlock, { capture: true });
    };
  }, []);

  return (
    <ErrorBoundary>
      <div className="app-root">
        {screen === 'mainMenu' && <MainMenuScreen />}
        {screen === 'game' && <GameScreen key={runId} />}
        {screen === 'equipment' && <EquipmentScreen />}
        {screen === 'superpowers' && <SuperpowersScreen />}
        {screen === 'highscore' && <HighscoreScreen />}
        {screen === 'options' && <OptionsScreen />}
        {screen === 'gameOver' && <GameOverScreen />}
        {screen === 'shop' && <ShopScreen />}
        {screen === 'characterMenu' && <CharacterMenuScreen />}
      </div>
    </ErrorBoundary>
  );
}
