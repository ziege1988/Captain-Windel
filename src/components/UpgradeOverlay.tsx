import { useMemo } from 'react';
import type { GameEngine } from '../game/engine/GameEngine';
import { UPGRADES } from '../data/upgrades';
import type { UpgradeDef } from '../game/types';
import { applyUpgradeToPlayer } from '../game/entities/factory';
import { useAppStore } from '../state/appStore';
import { audio } from '../game/audio/audioManager';

interface Props {
  engine: GameEngine;
  onDone: () => void;
}

function pickThreeUpgrades(excludeMaxed: UpgradeDef[]): UpgradeDef[] {
  const pool = excludeMaxed;
  const chosen: UpgradeDef[] = [];
  const remaining = [...pool];
  const totalWeight = () => remaining.reduce((s, u) => s + u.weight, 0);
  while (chosen.length < 3 && remaining.length > 0) {
    let r = Math.random() * totalWeight();
    let idx = 0;
    for (; idx < remaining.length; idx++) {
      r -= remaining[idx].weight;
      if (r <= 0) break;
    }
    const pick = remaining.splice(Math.min(idx, remaining.length - 1), 1)[0];
    chosen.push(pick);
  }
  return chosen;
}

// Section 20-22: after every won level, three random upgrades are offered;
// the player picks exactly one, and it becomes visible on the character
// immediately (section 21, handled by Fighter.accessories via factory.ts).
export function UpgradeOverlay({ engine, onDone }: Props) {
  const unlockWeapon = useAppStore((s) => s.unlockWeapon);
  const score = engine.score;

  const options = useMemo(() => {
    const available = UPGRADES.filter((u) => {
      const owned = engine.player.equippedUpgradeIds.filter((id) => id === u.id).length;
      const max = u.maxStacks ?? 1;
      if (owned >= max) return false;
      if ((u.minLevel ?? 1) > engine.levelIndex) return false;
      if (u.grantsWeapon && engine.save.unlockedWeapons.includes(u.grantsWeapon)) return false;
      if (u.grantsAbility && engine.player.equippedUpgradeIds.includes(u.id)) return false;
      return true;
    });
    return pickThreeUpgrades(available.length >= 3 ? available : UPGRADES.filter((u) => (u.maxStacks ?? 1) === Infinity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (u: UpgradeDef) => {
    audio.play('upgrade');
    applyUpgradeToPlayer(engine.player, u.id);
    if (u.grantsWeapon && !engine.save.unlockedWeapons.includes(u.grantsWeapon)) {
      engine.save.unlockedWeapons = [...engine.save.unlockedWeapons, u.grantsWeapon];
      unlockWeapon(u.grantsWeapon);
    }
    onDone();
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(10,14,10,0.92)', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 20, zIndex: 20,
    }}
    >
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: 0, color: '#ffd54f' }}>SIEG!</h2>
        <p style={{ opacity: 0.85, margin: '4px 0 0' }}>Score: {score.toLocaleString('de-DE')}</p>
        <p style={{ opacity: 0.7, marginTop: 10 }}>Wähle ein Upgrade:</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
        {options.map((u) => (
          <button
            key={u.id}
            className="panel"
            onClick={() => choose(u)}
            style={{ padding: 16, textAlign: 'left', color: '#fff', display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <span style={{ fontWeight: 700, fontSize: 16 }}>{u.name}</span>
            <span style={{ fontSize: 13, opacity: 0.8 }}>{u.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
