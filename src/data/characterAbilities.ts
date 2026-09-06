import type { CharacterAbilityDef, CharacterAbilityId, CharacterId } from '../game/types';

// Character-identity pass: every hero carries one signature ability that
// belongs to them and nobody else. This is the "A" category of the brief —
// fixed to the character, always available from the very first fight, never
// equipped or unequipped — as opposed to the boss-unlocked SUPERPOWERS in
// superpowers.ts, which are the "B" category: earned, swappable and shared
// by every hero.
//
// The four are deliberately built on four different mechanics rather than
// four recolors of one effect, so each one plays differently and not just
// looks different:
//
//   Windelmann  area / control    — a wide cone right in front of him
//   Grandpa     single target     — one thrown object that has to connect
//   Punk        mid range         — a travelling wave that shoves back
//   Bruno       close range       — a ground shock that throws upward
//
// Damage sits between a strong weapon swing and the heavier superpowers:
// enough that a normal enemy visibly loses a quarter to two-fifths of its
// health, never enough to end a fight on its own.
export const CHARACTER_ABILITIES: Record<CharacterAbilityId, CharacterAbilityDef> = {
  pressureFart: {
    id: 'pressureFart',
    characterId: 'windelmann',
    name: 'Druck-Furz',
    shortLabel: 'FURZ',
    icon: '💨',
    description: 'Windelmann dreht sich um, bückt sich und lässt einen Druckstoß los, der den Gegner wegschiebt und benebelt zurücklässt.',
    playstyle: 'Flächeneffekt & Kontrolle',
    cooldownMs: 15000,
    damage: 30,
    range: 210,
    color: '#8bc34a',
  },
  dentures: {
    id: 'dentures',
    characterId: 'grandpa',
    name: 'Gebiss-Angriff',
    shortLabel: 'GEBISS',
    icon: '🦷',
    description: 'Opa nimmt sein Gebiss heraus und wirft es. Es klappert quer durch die Arena, prallt am Gegner ab und kommt zurück — meistens.',
    playstyle: 'Präziser Einzelziel-Wurf',
    cooldownMs: 14000,
    damage: 34,
    range: 460,
    color: '#f5f5f5',
  },
  rockWave: {
    id: 'rockWave',
    characterId: 'punk',
    name: 'Punk-Rock-Schockwelle',
    shortLabel: 'ROCK',
    icon: '🤘',
    description: 'Punk geht in Pose, die Frisur stellt sich auf, und ein Akkord schickt eine Druckwelle nach vorn, die alles wegschiebt.',
    playstyle: 'Mittlere Distanz & Rückstoß',
    cooldownMs: 15000,
    damage: 28,
    range: 330,
    color: '#ba68c8',
  },
  groundStomp: {
    id: 'groundStomp',
    characterId: 'brawler',
    name: 'Bodenstampfer',
    shortLabel: 'STAMPF',
    icon: '💪',
    description: 'Bruno stampft so fest auf, dass ein Riss durch den Boden läuft und den Gegner in die Luft schleudert.',
    playstyle: 'Nahkampf & Aufwärtsschleuder',
    cooldownMs: 16000,
    damage: 32,
    // Short on purpose: it travels along the ground, so it is the one
    // ability the enemy can dodge simply by standing on the platform.
    range: 260,
    color: '#ffb300',
  },
};

export const CHARACTER_ABILITY_LIST = Object.values(CHARACTER_ABILITIES);

const BY_CHARACTER = CHARACTER_ABILITY_LIST.reduce((acc, def) => {
  acc[def.characterId] = def;
  return acc;
}, {} as Record<CharacterId, CharacterAbilityDef>);

/** The signature ability of a hero. There is always exactly one — swapping
 * character in the menu swaps the ability with it, with nothing for the
 * player to assign by hand. */
export function abilityForCharacter(id: CharacterId): CharacterAbilityDef {
  return BY_CHARACTER[id] ?? CHARACTER_ABILITIES.pressureFart;
}
