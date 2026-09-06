import { useAppStore } from '../state/appStore';
import { ShopOverlay } from '../components/ShopOverlay';

// Persistent-progression pass: the main-menu entry point into the
// "Waffenkammer" — reachable any time, run or no run. Purchases go
// straight into save.specialWeaponStock, which is also what a running
// fight reads from, so there is nothing to hand over between the two.
export function ShopScreen() {
  const setScreen = useAppStore((s) => s.setScreen);
  return <ShopOverlay variant="screen" onClose={() => setScreen('mainMenu')} />;
}
