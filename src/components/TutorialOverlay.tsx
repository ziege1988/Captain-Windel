import { useState } from 'react';

const STEPS = [
  { title: 'Bewegen', text: 'Nutze die Pfeile unten links, um zu laufen und zu springen.' },
  { title: 'Angreifen', text: 'SCHLAG und TRITT unten rechts treffen den Gegner. Timing schlägt Spammen.' },
  { title: 'Ausweichen', text: 'BLOCK und AUSWEICHEN schützen dich — perfektes Timing bringt Bonuspunkte.' },
];

// Section 57: minimal onboarding, then straight into the game.
export function TutorialOverlay({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 25, padding: 24,
    }}
    >
      <div className="panel" style={{ padding: 24, maxWidth: 320, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, color: '#ffd54f' }}>{current.title}</h2>
        <p style={{ margin: 0, opacity: 0.9 }}>{current.text}</p>
        <button
          className="big-button"
          onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : onDone())}
        >
          {step < STEPS.length - 1 ? 'WEITER' : 'LOS GEHT\'S'}
        </button>
      </div>
    </div>
  );
}
