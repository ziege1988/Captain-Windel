import type { CapeColorDef, CapeColorId, CharacterDef, CharacterId } from '../game/types';

// Character-system overhaul: four playable heroes sharing one rig
// (renderFighter.ts computes/draws them all identically) but each with a
// distinct palette, hairstyle, proportions and personality — see the
// per-character drawing branches in renderFighter.ts for hair/face/clothing.
// Windelmann stays free/default; the other three are permanent coin unlocks
// (see appStore.purchaseCharacter), matching the existing coin economy.
export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  windelmann: {
    id: 'windelmann', name: 'Windelmann', icon: '🩲',
    tagline: 'Windel. Umhang. Keine Angst vor gar nichts.',
    personality: 'frech, mutig, chaotisch',
    unlockCost: 0, build: 'slim',
    bodyColor: '#111111', hairColor: '#3e2723',
    clothColor: '#f5f5f5', clothColor2: '#ffd54f',
    defaultCape: 'red',
  },
  grandpa: {
    id: 'grandpa', name: 'Grandpa', icon: '👴',
    tagline: 'Unterschätz ihn nicht — er hat noch ein paar Tricks drauf.',
    personality: 'gemütlich, verschmitzt, überraschend stark',
    unlockCost: 60, build: 'slim',
    bodyColor: '#2f2a26', hairColor: '#e0e0e0',
    clothColor: '#8d6e63', clothColor2: '#5d4037',
    defaultCape: 'green',
  },
  punk: {
    id: 'punk', name: 'Punk', icon: '🤘',
    tagline: 'Regeln sind für andere Leute.',
    personality: 'frech, rebellisch, selbstbewusst',
    unlockCost: 90, build: 'slim',
    bodyColor: '#141414', hairColor: '#43a047',
    clothColor: '#212121', clothColor2: '#c0392b',
    defaultCape: 'purple',
  },
  brawler: {
    id: 'brawler', name: 'Bruno', icon: '💪',
    tagline: 'Groß, gutmütig, ein bisschen tollpatschig.',
    personality: 'gutmütig, stark, etwas tollpatschig',
    unlockCost: 130, build: 'heavy',
    bodyColor: '#4a3222', hairColor: '#2b1d12',
    clothColor: '#37474f', clothColor2: '#ffb300',
    defaultCape: 'gold',
  },
};

export const CHARACTER_LIST = Object.values(CHARACTERS);

export const CAPE_COLORS: Record<CapeColorId, CapeColorDef> = {
  red: { id: 'red', name: 'Klassisch Rot', price: 0, primary: '#c0392b', secondary: '#8e2318' },
  blue: { id: 'blue', name: 'Sturmblau', price: 40, primary: '#1e6fa8', secondary: '#154d76' },
  purple: { id: 'purple', name: 'Rebellenlila', price: 40, primary: '#8e24aa', secondary: '#6a1b9a' },
  gold: { id: 'gold', name: 'Heldengold', price: 70, primary: '#ffb300', secondary: '#c98700' },
  green: { id: 'green', name: 'Waldgrün', price: 40, primary: '#2e7d32', secondary: '#1b5e20' },
};

export const CAPE_COLOR_LIST = Object.values(CAPE_COLORS);
