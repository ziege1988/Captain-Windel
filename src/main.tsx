import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML = '<p style="color:white;padding:20px">Fehler: Root-Element nicht gefunden.</p>';
} else {
  try {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (err) {
    rootEl.innerHTML = `<p style="color:white;padding:20px">Captain Windel konnte nicht gestartet werden. Bitte Seite neu laden.</p>`;
    console.error(err);
  }
}
