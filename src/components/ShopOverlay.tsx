import { useAppStore } from '../state/appStore';
import { SPECIAL_WEAPON_LIST, SPECIAL_WEAPONS } from '../data/specialWeapons';
import type { SpecialWeaponId } from '../game/types';
import { audio } from '../game/audio/audioManager';
import { ScreenHeader } from './ScreenHeader';

interface Props {
  /** The player's single currently-held special weapon slot (run-scoped) —
   * `save.pendingSpecialWeapon` from the main menu,
   * `engine.player.hasSpecialWeaponId` mid-run. Only used to label the
   * buttons: the one already held cannot be bought again, and any other
   * purchase swaps it out. */
  heldWeaponId: SpecialWeaponId | null;
  /** Called once a purchase actually goes through — the caller decides where
   * the bought weapon id is stored (pendingSpecialWeapon vs. the live
   * engine's player), since this component has no idea whether a run is
   * active. */
  onPurchased: (id: SpecialWeaponId) => void;
  onClose: () => void;
  /** 'screen': a standalone full menu screen (reached from the main menu,
   * no run in progress). 'overlay': a dismissible panel on top of the game
   * (pause menu, or auto-offered right after a boss kill) — must never
   * force the player to buy anything, per the brief's "must not
   * unnecessarily interrupt combat" requirement. */
  variant: 'screen' | 'overlay';
  overlayTitle?: string;
  overlaySubtitle?: string;
  closeLabel?: string;
}

// Persistent-progression pass: the humorously-styled "Waffenkammer" shop —
// the only way to spend permanently-collected coins on one-time special
// weapons (see the brief's section 20: not a sober standard menu).
export function ShopOverlay({
  heldWeaponId, onPurchased, onClose, variant,
  overlayTitle = '💰 WAFFENKAMMER', overlaySubtitle = 'Was darf’s heute sein?', closeLabel = 'Weiter',
}: Props) {
  const coins = useAppStore((s) => s.save.coins);
  const unlocked = useAppStore((s) => s.save.unlockedSpecialWeapons);
  const purchaseSpecialWeapon = useAppStore((s) => s.purchaseSpecialWeapon);

  // Unlocked means buyable. Holding a weapon used to disable every single
  // buy button, which read as "you have to use up / buy things in a set
  // order before the next one is available" — buying a different one now
  // simply swaps what is in the slot, and the button says so.
  const buy = (id: SpecialWeaponId) => {
    if (id === heldWeaponId) return;
    if (!purchaseSpecialWeapon(id)) return;
    audio.play('shopBuy');
    onPurchased(id);
  };

  const list = (
    <div className="scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 400, flex: 1, minHeight: 0 }}>
      {SPECIAL_WEAPON_LIST.map((w) => {
        const isUnlocked = unlocked.includes(w.id);
        const canAfford = coins >= w.price;
        const isHeld = heldWeaponId === w.id;
        const disabled = !isUnlocked || !canAfford || isHeld;
        return (
          <div
            key={w.id}
            className="panel"
            style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12, opacity: isUnlocked ? 1 : 0.45 }}
          >
            <div style={{ fontSize: 30, width: 40, textAlign: 'center', flexShrink: 0 }}>{isUnlocked ? w.icon : '🔒'}</div>
            <div style={{ flex: 1, minWidth: 0, color: '#fff' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{isUnlocked ? w.name : '???'}</div>
              <div style={{ fontSize: 11.5, opacity: 0.75, fontStyle: 'italic' }}>
                {isUnlocked ? `„${w.tagline}“` : 'Noch nicht freigeschaltet'}
              </div>
            </div>
            <button
              className="big-button secondary"
              disabled={disabled}
              onClick={() => buy(w.id)}
              style={{ padding: '8px 12px', fontSize: 12.5, minHeight: 40, opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {isHeld ? 'DABEI' : heldWeaponId ? `🪙 ${w.price} · TAUSCH` : `🪙 ${w.price}`}
            </button>
          </div>
        );
      })}
    </div>
  );

  const header = (
    <div style={{ textAlign: 'center' }}>
      <p style={{ opacity: 0.8, margin: '0 0 8px', fontStyle: 'italic', color: '#fff' }}>{overlaySubtitle}</p>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#ffd54f' }}>🪙 {coins}</p>
      {heldWeaponId && (
        <p style={{ fontSize: 12, opacity: 0.85, color: '#ffcc80', marginTop: 6, maxWidth: 340 }}>
          Dabei: {SPECIAL_WEAPONS[heldWeaponId].icon} {SPECIAL_WEAPONS[heldWeaponId].name}. Ein Kauf tauscht sie aus.
        </p>
      )}
    </div>
  );

  if (variant === 'screen') {
    return (
      <div
        className="scroll-y"
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 14, padding: 20, background: 'radial-gradient(circle at 50% 10%, #3a2a12, #10160f 75%)',
          paddingTop: 'calc(20px + env(safe-area-inset-top,0px))', paddingBottom: 'calc(20px + env(safe-area-inset-bottom,0px))',
        }}
      >
        <div style={{ width: '100%', maxWidth: 400 }}>
          <ScreenHeader title="WAFFENKAMMER" onBack={onClose} />
        </div>
        {header}
        {list}
      </div>
    );
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(10,14,10,0.92)', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20, zIndex: 25,
    }}
    >
      <h2 style={{ margin: 0, color: '#ffd54f' }}>{overlayTitle}</h2>
      {header}
      {list}
      <button className="big-button" onClick={onClose} style={{ width: '100%', maxWidth: 400 }}>{closeLabel}</button>
    </div>
  );
}
