import { useAppStore } from '../state/appStore';
import { ShopOverlay } from '../components/ShopOverlay';

// Persistent-progression pass: the main-menu entry point into the
// "Waffenkammer" — reachable any time, run or no run. A purchase made here
// (before a run exists) is stashed in save.pendingSpecialWeapon and handed
// to the player's single special-weapon slot the moment the next
// GameEngine starts (see GameEngine's constructor).
export function ShopScreen() {
  const setScreen = useAppStore((s) => s.setScreen);
  const pendingSpecialWeapon = useAppStore((s) => s.save.pendingSpecialWeapon);
  const setPendingSpecialWeapon = useAppStore((s) => s.setPendingSpecialWeapon);

  return (
    <ShopOverlay
      variant="screen"
      heldWeaponId={pendingSpecialWeapon}
      onPurchased={(id) => setPendingSpecialWeapon(id)}
      onClose={() => setScreen('mainMenu')}
    />
  );
}
