// Section 44: single source of truth for every balancing knob. Nothing here
// is duplicated elsewhere — enemy/level scaling, score values and upgrade
// odds all read from this file.

export const BALANCE = {
  player: {
    baseStats: {
      maxHealth: 100,
      meleeDamage: 12,
      defense: 0,
      moveSpeed: 210,
      attackSpeed: 1,
      attackControl: 1,
    },
    superpowerSlots: 3,
    invulnerableAfterHitMs: 350,
  },
  enemyScaling: {
    // Per level (index starting at 1), how much stronger a same-type enemy
    // becomes. Kept gentle and continuous — no sudden spikes.
    healthGrowthPerLevel: 0.065,
    damageGrowthPerLevel: 0.05,
    speedGrowthPerLevel: 0.012,
    defenseGrowthPerLevel: 0.004,
    sizeGrowthPerLevel: 0.025, // ~2.5% per level as requested
    maxSizeMult: 1.9,
  },
  boss: {
    healthMult: 6,
    damageMult: 1.6,
    sizeMult: 1.6,
    scoreBonus: 5000,
  },
  campaign: {
    totalLevels: 50,
    bossLevels: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
  },
  chaos: {
    startLevel: 51,
    healthGrowthPerLevel: 0.05,
    damageGrowthPerLevel: 0.04,
    speedGrowthPerLevel: 0.01,
    bossChancePerLevel: 0.12,
    scoreMultiplierGrowth: 0.02,
  },
  score: {
    hit: 100,
    heavyHit: 250,
    criticalHit: 500,
    perfectBonus: 300,
    knockdown: 250,
    kill: 400,
    bossKill: 5000,
    comboStepBonus: 20,
    dodgePerfect: 150,
    superpowerHit: 200,
  },
  combo: {
    resetAfterMs: 2200,
  },
  hit: {
    critChance: 0.12,
    heavyChance: 0.28,
    vomitChanceOnCrit: 0.35,
    hitStopMs: 90,
    critHitStopMs: 180,
  },
  physics: {
    gravity: 2200,
    groundFriction: 0.86,
    airDrag: 0.98,
    knockbackDecay: 0.9,
  },
} as const;
