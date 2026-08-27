import { useAppStore } from './state/appStore';
import { ErrorBoundary } from './ErrorBoundary';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { GameScreen } from './screens/GameScreen';
import { EquipmentScreen } from './screens/EquipmentScreen';
import { SuperpowersScreen } from './screens/SuperpowersScreen';
import { HighscoreScreen } from './screens/HighscoreScreen';
import { OptionsScreen } from './screens/OptionsScreen';
import { GameOverScreen } from './screens/GameOverScreen';

export default function App() {
  const screen = useAppStore((s) => s.screen);
  const runId = useAppStore((s) => s.runId);

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
      </div>
    </ErrorBoundary>
  );
}
