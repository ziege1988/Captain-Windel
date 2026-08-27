# Captain Windel

Ein absurdes 2D-Arcade-Prügelspiel für den mobilen Browser: Strichmännchen,
Windel, Umhang, alberne Superkräfte — auf einer wunderschönen Cartoon-Wiese.

Gebaut mit React, TypeScript und Vite, das eigentliche Spiel läuft auf einem
HTML5-Canvas. Kein Backend, kein Login, kein Server — Fortschritt und
Highscore werden lokal im Browser gespeichert (`localStorage`, mit
In-Memory-Fallback falls nicht verfügbar).

## Entwicklung

```bash
npm install
npm run dev      # Dev-Server mit Hot Reload
npm run build    # Production-Build nach dist/
npm run preview  # Production-Build lokal testen
```

Deployment: `npm run build` erzeugt ein statisches `dist/`-Verzeichnis, das
direkt auf Vercel (oder jedem anderen Static Host) deploybar ist.

## Architektur

Datengetrieben statt 50 handgeschriebener Level: Gegner, Bosse, Waffen,
Upgrades, Superkräfte, Arenen und die 50-Level-Kampagne (plus Chaos Mode ab
Level 51) sind in `src/data/` als Konfiguration definiert. Die Engine in
`src/game/engine/GameEngine.ts` ist komplett generisch und braucht für neue
Inhalte keine Änderungen — neue Gegner/Waffen/Bosse/Arenen sind neue
Daten-Einträge.

```
src/
  game/
    engine/     Game Loop, Canvas-Rendering, Kampfsystem
    entities/   Fighter-Basisklasse + Player/Enemy/Boss-Factories
    ai/         Gegner-KI-Typen (melee/ranged/ninja/defensive/boss)
    physics/    einfache 2D-Arcade-Physik
    effects/    Partikelsystem, Screen Shake, Hit-Stop
    audio/      synthetisierte Soundeffekte (WebAudio), keine Audio-Assets
  data/         Balance-Konfiguration + Inhalte (Gegner, Bosse, Waffen, ...)
  state/        globaler App-Zustand (Zustand-Store)
  storage/      localStorage-Persistenz
  screens/      React-Bildschirme (Menü, Spiel, Ausrüstung, ...)
  components/   HUD, Touch-Steuerung, Overlays
```
