interface Props {
  onResume: () => void;
  onRestartLevel: () => void;
  onMainMenu: () => void;
}

// Section 32: pause menu — Weiter / Neustart / Hauptmenü.
export function PauseOverlay({ onResume, onRestartLevel, onMainMenu }: Props) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 20,
    }}
    >
      <div className="panel" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 14, width: 280 }}>
        <h2 style={{ margin: 0, textAlign: 'center' }}>PAUSE</h2>
        <button className="big-button" onClick={onResume}>Weiter</button>
        <button className="big-button secondary" onClick={onRestartLevel}>Neustart</button>
        <button className="big-button danger" onClick={onMainMenu}>Hauptmenü</button>
      </div>
    </div>
  );
}
