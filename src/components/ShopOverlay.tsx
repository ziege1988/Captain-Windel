import { useState } from 'react';
import { useAppStore } from '../state/appStore';
import { SPECIAL_WEAPON_LIST, SPECIAL_WEAPONS, SPECIAL_WEAPON_SLOTS, stockKinds } from '../data/specialWeapons';
import type { SpecialWeaponId } from '../game/types';
import { audio } from '../game/audio/audioManager';
import { ScreenHeader } from './ScreenHeader';

interface Props {
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
// the only way to spend permanently-collected coins on special weapons
// (see the brief's section 20: not a sober standard menu).
//
// Stock, not a slot: a weapon can be bought as many times as you can
// afford it, and the count is what gets spent one use at a time. The only
// limit is how many DIFFERENT kinds go into a fight — two — so a purchase
// is a choice about what to bring rather than about what to give up.
export function ShopOverlay({
  onClose, variant,
  overlayTitle = '💰 WAFFENKAMMER', overlaySubtitle = 'Was darf’s heute sein?', closeLabel = 'Weiter',
}: Props) {
  const coins = useAppStore((s) => s.save.coins);
  const unlocked = useAppStore((s) => s.save.unlockedSpecialWeapons);
  const stock = useAppStore((s) => s.save.specialWeaponStock);
  const purchaseSpecialWeapon = useAppStore((s) => s.purchaseSpecialWeapon);
  const discardSpecialWeapon = useAppStore((s) => s.discardSpecialWeapon);
  const [notice, setNotice] = useState<string | null>(null);

  const kinds = stockKinds(stock);
  const slotsFull = kinds.length >= SPECIAL_WEAPON_SLOTS;

  const buy = (id: SpecialWeaponId) => {
    const result = purchaseSpecialWeapon(id);
    if (result === 'ok') {
      audio.play('shopBuy');
      setNotice(null);
      return;
    }
    // A refused purchase says why. A disabled button that gives no reason
    // is exactly what made the old shop read as "you must buy things in a
    // fixed order".
    setNotice(
      result === 'noSlot'
        ? `Du kannst nur ${SPECIAL_WEAPON_SLOTS} verschiedene mitnehmen. Wirf eine weg, um Platz zu machen.`
        : result === 'tooPoor' ? 'Nicht genug Münzen.'
          : 'Noch nicht freigeschaltet.',
    );
  };

  const list = (
    <div className="scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 400, flex: 1, minHeight: 0 }}>
      {SPECIAL_WEAPON_LIST.map((w) => {
        const isUnlocked = unlocked.includes(w.id);
        const owned = stock[w.id] ?? 0;
        const canAfford = coins >= w.price;
        const blockedBySlots = owned === 0 && slotsFull;
        const disabled = !isUnlocked || !canAfford || blockedBySlots;
        return (
          <div
            key={w.id}
            className="panel"
            style={{
              padding: 14, display: 'flex', alignItems: 'center', gap: 12,
              opacity: isUnlocked ? 1 : 0.45,
              border: owned > 0 ? '2px solid #ffd54f' : undefined,
            }}
          >
            <div style={{ fontSize: 30, width: 40, textAlign: 'center', flexShrink: 0, position: 'relative' }}>
              {isUnlocked ? w.icon : '🔒'}
              {owned > 0 && <span style={countBadgeStyle}>{owned}x</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0, color: '#fff' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{isUnlocked ? w.name : '???'}</div>
              <div style={{ fontSize: 11.5, opacity: 0.75, fontStyle: 'italic' }}>
                {isUnlocked ? `„${w.tagline}“` : 'Noch nicht freigeschaltet'}
              </div>
              {owned > 0 && (
                <button
                  className="big-button secondary"
                  onClick={() => { audio.play('menuTap'); discardSpecialWeapon(w.id); setNotice(null); }}
                  style={{ padding: '3px 8px', fontSize: 10.5, minHeight: 0, marginTop: 4 }}
                >
                  Wegwerfen
                </button>
              )}
            </div>
            <button
              className="big-button secondary"
              disabled={disabled}
              onClick={() => buy(w.id)}
              style={{ padding: '8px 12px', fontSize: 12.5, minHeight: 40, opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {blockedBySlots && isUnlocked ? 'PLATZ VOLL' : `🪙 ${w.price}${owned > 0 ? ' · MEHR' : ''}`}
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
      <p style={{ fontSize: 12, opacity: 0.85, color: '#ffcc80', marginTop: 6, maxWidth: 340 }}>
        {kinds.length === 0
          ? `Kaufe so viele du willst — mit in den Kampf kommen ${SPECIAL_WEAPON_SLOTS} verschiedene.`
          : `Dabei: ${kinds.map((id) => `${SPECIAL_WEAPONS[id].icon} ${stock[id]}x`).join('  ·  ')}`}
        {slotsFull && ' — beide Plätze belegt. Von diesen zwei kannst du beliebig nachkaufen.'}
      </p>
      {notice && (
        <p style={{ fontSize: 12, color: '#ff8a65', marginTop: 6, maxWidth: 340, fontWeight: 700 }}>{notice}</p>
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

// Sits on the corner of the icon, the same place the combat button shows
// it, so "3x" means the same thing in the shop and in the fight.
const countBadgeStyle: import('react').CSSProperties = {
  position: 'absolute', right: -6, bottom: -4,
  fontSize: 11, fontWeight: 800, color: '#111', background: '#ffd54f',
  borderRadius: 8, padding: '0 4px', lineHeight: '15px', minWidth: 18,
};
