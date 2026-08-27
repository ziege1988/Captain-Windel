import { useAppStore } from '../state/appStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { audio } from '../game/audio/audioManager';

// Section 43: sound/music/vibration/reduced-effects toggles.
export function OptionsScreen() {
  const save = useAppStore((s) => s.save);
  const setScreen = useAppStore((s) => s.setScreen);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const toggle = (key: keyof typeof save.settings) => {
    const next = !save.settings[key];
    updateSettings({ [key]: next });
    if (key === 'soundOn') audio.soundEnabled = next;
    if (key === 'musicOn') audio.musicEnabled = next;
    if (key === 'vibrationOn') audio.vibrationEnabled = next;
  };

  return (
    <div className="scroll-y" style={{ width: '100%', height: '100%', padding: 20, paddingTop: 'calc(20px + env(safe-area-inset-top,0px))' }}>
      <ScreenHeader title="OPTIONEN" onBack={() => setScreen('mainMenu')} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ToggleRow label="Sound" value={save.settings.soundOn} onToggle={() => toggle('soundOn')} />
        <ToggleRow label="Musik" value={save.settings.musicOn} onToggle={() => toggle('musicOn')} />
        <ToggleRow label="Vibration" value={save.settings.vibrationOn} onToggle={() => toggle('vibrationOn')} />
        <ToggleRow label="Reduzierte Effekte" value={save.settings.reducedEffects} onToggle={() => toggle('reducedEffects')} />
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <button
      className="panel"
      onClick={onToggle}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, color: '#fff' }}
    >
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{
        width: 52, height: 28, borderRadius: 14, background: value ? '#4caf50' : 'rgba(255,255,255,0.15)',
        position: 'relative', transition: 'background 150ms',
      }}
      >
        <span style={{
          position: 'absolute', top: 3, left: value ? 27 : 3, width: 22, height: 22, borderRadius: '50%',
          background: '#fff', transition: 'left 150ms',
        }}
        />
      </span>
    </button>
  );
}
