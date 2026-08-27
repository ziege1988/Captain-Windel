import React from 'react';

interface Props {
  children: React.ReactNode;
}
interface State {
  hasError: boolean;
}

// Section 56: never show a blank white screen — catch render errors and
// offer a restart instead.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown): void {
    console.error('Captain Windel crashed:', error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16, color: '#fff',
          background: '#10160f', textAlign: 'center', padding: 24,
        }}
        >
          <h1 style={{ fontSize: '1.4rem' }}>Huch, Captain Windel ist hingefallen!</h1>
          <p>Etwas ist schiefgelaufen.</p>
          <button
            className="big-button"
            onClick={() => window.location.reload()}
          >
            Neu starten
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
