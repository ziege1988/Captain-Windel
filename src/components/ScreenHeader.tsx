export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <button
        onClick={onBack}
        style={{
          width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.1)',
          color: '#fff', fontSize: 18, flexShrink: 0,
        }}
      >
        ←
      </button>
      <h1 style={{ fontSize: '1.4rem', margin: 0, color: '#ffd54f' }}>{title}</h1>
    </div>
  );
}
