import type { ArenaDef } from '../game/types';

// Section 14 & 37: 10 visual "chapters", each with a bright normal variant
// and a darker boss variant. The renderer (engine/renderArena.ts) is
// entirely generic and driven by these colour/flag fields, so a new arena
// chapter is just a new data entry.
export const ARENAS: Record<string, ArenaDef> = {
  meadow: {
    id: 'meadow', name: 'Wiese', palette: 'meadow',
    skyTop: '#63b8ff', skyBottom: '#bdeaff', groundColor: '#5fb955', groundColor2: '#4a9c42',
    accentColor: '#ffd54f', isDark: false, hasLightning: false, hasFog: false,
  },
  meadowBoss: {
    id: 'meadowBoss', name: 'Düstere Wiese', palette: 'darkMeadow',
    skyTop: '#1b1f3b', skyBottom: '#3a2f52', groundColor: '#33452f', groundColor2: '#263620',
    accentColor: '#b39ddb', isDark: true, hasLightning: false, hasFog: true,
  },
  forest: {
    id: 'forest', name: 'Dunkler Wald', palette: 'forest',
    skyTop: '#3f6b4f', skyBottom: '#7fae7f', groundColor: '#3c5a3a', groundColor2: '#2d4629',
    accentColor: '#8bc34a', isDark: false, hasLightning: false, hasFog: true,
  },
  forestBoss: {
    id: 'forestBoss', name: 'Wald-Boss-Arena', palette: 'forest',
    skyTop: '#0f1f14', skyBottom: '#1f3322', groundColor: '#1c2b1a', groundColor2: '#121f11',
    accentColor: '#66bb6a', isDark: true, hasLightning: false, hasFog: true,
  },
  volcano: {
    id: 'volcano', name: 'Vulkan', palette: 'volcano',
    skyTop: '#4a1c1c', skyBottom: '#a13a1f', groundColor: '#4a2318', groundColor2: '#331810',
    accentColor: '#ff7043', isDark: false, hasLightning: false, hasFog: false,
  },
  volcanoBoss: {
    id: 'volcanoBoss', name: 'Vulkan-Boss-Arena', palette: 'volcano',
    skyTop: '#26090a', skyBottom: '#5c1a12', groundColor: '#2b120c', groundColor2: '#1a0b08',
    accentColor: '#ff5722', isDark: true, hasLightning: false, hasFog: true,
  },
  ice: {
    id: 'ice', name: 'Eislandschaft', palette: 'ice',
    skyTop: '#a7d8f0', skyBottom: '#e3f6ff', groundColor: '#dff3fb', groundColor2: '#bde3f2',
    accentColor: '#4fc3f7', isDark: false, hasLightning: false, hasFog: false,
  },
  iceBoss: {
    id: 'iceBoss', name: 'Eis-Boss-Arena', palette: 'ice',
    skyTop: '#0d1b2a', skyBottom: '#1b3a4b', groundColor: '#264d5c', groundColor2: '#1a3540',
    accentColor: '#81d4fa', isDark: true, hasLightning: false, hasFog: true,
  },
  desert: {
    id: 'desert', name: 'Wüste', palette: 'desert',
    skyTop: '#ffb74d', skyBottom: '#ffe0b2', groundColor: '#e0b062', groundColor2: '#c99a4f',
    accentColor: '#ff8f00', isDark: false, hasLightning: false, hasFog: false,
  },
  desertBoss: {
    id: 'desertBoss', name: 'Wüsten-Boss-Arena', palette: 'desert',
    skyTop: '#3b1f0a', skyBottom: '#6b3a12', groundColor: '#4a3216', groundColor2: '#33220f',
    accentColor: '#ffab40', isDark: true, hasLightning: false, hasFog: true,
  },
  ruins: {
    id: 'ruins', name: 'Burgruine', palette: 'ruins',
    skyTop: '#7d8ea3', skyBottom: '#b8c4d1', groundColor: '#8d8577', groundColor2: '#726a5c',
    accentColor: '#9e9e9e', isDark: false, hasLightning: false, hasFog: true,
  },
  ruinsBoss: {
    id: 'ruinsBoss', name: 'Ruinen-Boss-Arena', palette: 'ruins',
    skyTop: '#1a1a24', skyBottom: '#33333f', groundColor: '#2b2b28', groundColor2: '#1e1e1c',
    accentColor: '#b0bec5', isDark: true, hasLightning: false, hasFog: true,
  },
  graveyard: {
    id: 'graveyard', name: 'Friedhof', palette: 'graveyard',
    skyTop: '#4a4a5c', skyBottom: '#7a7a8c', groundColor: '#4f5347', groundColor2: '#3a3d33',
    accentColor: '#9fa8a0', isDark: false, hasLightning: false, hasFog: true,
  },
  graveyardBoss: {
    id: 'graveyardBoss', name: 'Friedhof-Boss-Arena', palette: 'graveyard',
    skyTop: '#0e0e14', skyBottom: '#22222e', groundColor: '#1c1e19', groundColor2: '#131410',
    accentColor: '#78909c', isDark: true, hasLightning: false, hasFog: true,
  },
  storm: {
    id: 'storm', name: 'Gewitterarena', palette: 'storm',
    skyTop: '#37474f', skyBottom: '#607d8b', groundColor: '#3e4a52', groundColor2: '#2c363c',
    accentColor: '#fff176', isDark: false, hasLightning: true, hasFog: false,
  },
  stormBoss: {
    id: 'stormBoss', name: 'Gewitter-Boss-Arena', palette: 'storm',
    skyTop: '#10161a', skyBottom: '#243138', groundColor: '#1c2529', groundColor2: '#12171a',
    accentColor: '#ffee58', isDark: true, hasLightning: true, hasFog: false,
  },
  chaosArena: {
    id: 'chaosArena', name: 'Chaos-Arena', palette: 'chaos',
    skyTop: '#3a0d3f', skyBottom: '#7a1f5c', groundColor: '#3d1030', groundColor2: '#280a1f',
    accentColor: '#e040fb', isDark: false, hasLightning: true, hasFog: true,
  },
  chaosArenaBoss: {
    id: 'chaosArenaBoss', name: 'Chaos-Boss-Arena', palette: 'chaos',
    skyTop: '#170617', skyBottom: '#3d0f38', groundColor: '#200a1c', groundColor2: '#140611',
    accentColor: '#ea80fc', isDark: true, hasLightning: true, hasFog: true,
  },
  finalDark: {
    id: 'finalDark', name: 'Finale Dunkle Arena', palette: 'chaos',
    skyTop: '#050208', skyBottom: '#1a0a1f', groundColor: '#14101a', groundColor2: '#0a0810',
    accentColor: '#ff1744', isDark: true, hasLightning: true, hasFog: true,
  },
  finalDarkBoss: {
    id: 'finalDarkBoss', name: 'Windels Letzte Prüfung', palette: 'chaos',
    skyTop: '#000000', skyBottom: '#1a0510', groundColor: '#100810', groundColor2: '#080408',
    accentColor: '#ff1744', isDark: true, hasLightning: true, hasFog: true,
  },
};

// Ordered chapters used by the level generator (section 37).
export const ARENA_CHAPTERS: { normal: string; boss: string }[] = [
  { normal: 'meadow', boss: 'meadowBoss' },
  { normal: 'forest', boss: 'forestBoss' },
  { normal: 'volcano', boss: 'volcanoBoss' },
  { normal: 'ice', boss: 'iceBoss' },
  { normal: 'desert', boss: 'desertBoss' },
  { normal: 'ruins', boss: 'ruinsBoss' },
  { normal: 'graveyard', boss: 'graveyardBoss' },
  { normal: 'storm', boss: 'stormBoss' },
  { normal: 'chaosArena', boss: 'chaosArenaBoss' },
  { normal: 'finalDark', boss: 'finalDarkBoss' },
];

export const CHAOS_ARENA_POOL = Object.values(ARENAS).map((a) => a.id);
