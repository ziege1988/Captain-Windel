import type { LevelDef } from '../game/types';
import { BALANCE } from './balance';
import { ARENA_CHAPTERS, CHAOS_ARENA_POOL } from './arenas';
import { ENEMY_LIST } from './enemies';
import { BOSS_ORDER } from './bosses';

// Section 12/13/50: the 50-level campaign is generated from data instead of
// being 50 hand-written blocks. A rotating pool of enemy types is picked
// deterministically per level, difficulty/size scale continuously, and
// every 5th level is a boss level using the matching chapter's boss arena.
const ENEMY_ROTATION = ENEMY_LIST.map((e) => e.id);

function pickEnemyForLevel(levelIndex: number): string {
  // Weighted-ish rotation: harder enemy archetypes appear more often at
  // higher levels by widening the pool slice as the level increases.
  const unlockedCount = Math.min(
    ENEMY_ROTATION.length,
    3 + Math.floor(levelIndex / 4),
  );
  const pool = ENEMY_ROTATION.slice(0, unlockedCount);
  const idx = (levelIndex * 7 + 3) % pool.length;
  return pool[idx];
}

function chapterFor(levelIndex: number) {
  const chapterIdx = Math.min(
    ARENA_CHAPTERS.length - 1,
    Math.floor((levelIndex - 1) / 5),
  );
  return ARENA_CHAPTERS[chapterIdx];
}

function buildCampaign(): LevelDef[] {
  const levels: LevelDef[] = [];
  for (let i = 1; i <= BALANCE.campaign.totalLevels; i++) {
    const isBoss = (BALANCE.campaign.bossLevels as readonly number[]).includes(i);
    const chapter = chapterFor(i);
    const difficultyScale = 1 + (i - 1) * BALANCE.enemyScaling.healthGrowthPerLevel;
    const sizeScale = Math.min(
      BALANCE.enemyScaling.maxSizeMult,
      1 + (i - 1) * BALANCE.enemyScaling.sizeGrowthPerLevel,
    );
    if (isBoss) {
      const bossOrderIdx = (BALANCE.campaign.bossLevels as readonly number[]).indexOf(i);
      levels.push({
        index: i,
        enemyId: '',
        isBoss: true,
        bossId: BOSS_ORDER[bossOrderIdx],
        arenaId: chapter.boss,
        difficultyScale,
        sizeScale,
      });
    } else {
      levels.push({
        index: i,
        enemyId: pickEnemyForLevel(i),
        isBoss: false,
        arenaId: chapter.normal,
        difficultyScale,
        sizeScale,
      });
    }
  }
  return levels;
}

export const CAMPAIGN_LEVELS: LevelDef[] = buildCampaign();

export function getLevel(index: number): LevelDef {
  if (index <= CAMPAIGN_LEVELS.length) return CAMPAIGN_LEVELS[index - 1];
  return getChaosLevel(index);
}

// Section 36/61: Chaos Mode — infinite generated levels beyond 50. Growth
// continues, bosses can appear at random, and arenas are picked randomly
// from the full pool for variety.
export function getChaosLevel(index: number): LevelDef {
  const chaosStep = index - BALANCE.chaos.startLevel + 1;
  const difficultyScale =
    1 + (BALANCE.campaign.totalLevels - 1) * BALANCE.enemyScaling.healthGrowthPerLevel +
    chaosStep * BALANCE.chaos.healthGrowthPerLevel;
  const sizeScale = Math.min(
    2.6,
    BALANCE.enemyScaling.maxSizeMult + chaosStep * 0.015,
  );

  // Deterministic pseudo-random per index so re-rendering the same level
  // (e.g. after a pause) doesn't reshuffle it.
  const rand = mulberry32(index * 2654435761);
  const arenaId = CHAOS_ARENA_POOL[Math.floor(rand() * CHAOS_ARENA_POOL.length)];
  const isBoss = rand() < BALANCE.chaos.bossChancePerLevel;

  if (isBoss) {
    const bossId = BOSS_ORDER[Math.floor(rand() * BOSS_ORDER.length)];
    return { index, enemyId: '', isBoss: true, bossId, arenaId, difficultyScale, sizeScale };
  }
  const enemyId = ENEMY_ROTATION[Math.floor(rand() * ENEMY_ROTATION.length)];
  return { index, enemyId, isBoss: false, arenaId, difficultyScale, sizeScale };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
