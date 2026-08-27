interface Props {
  score: number;
  onContinue: () => void;
}

// Section 60/61: distinct final-boss payoff screen before the normal
// upgrade flow continues into Chaos Mode.
export function CampaignCompleteOverlay({ score, onContinue }: Props) {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 30%, #3a0d3f, #000 80%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 30, padding: 20, textAlign: 'center',
    }}
    >
      <h1 style={{ color: '#ffd54f', fontSize: 'clamp(1.6rem, 7vw, 2.4rem)', margin: 0 }}>KAMPAGNE GESCHAFFT!</h1>
      <p style={{ opacity: 0.85 }}>Captain Shadow ist besiegt. Gesamtpunktzahl: {score.toLocaleString('de-DE')}</p>
      <div style={{ fontSize: 22, color: '#e040fb', fontWeight: 800, marginTop: 8 }}>🌪️ CHAOS MODE FREIGESCHALTET 🌪️</div>
      <p style={{ opacity: 0.7, maxWidth: 320 }}>Ab jetzt wird alles endlos schwerer. Wie lange überlebst du?</p>
      <button className="big-button" onClick={onContinue}>WEITER</button>
    </div>
  );
}
