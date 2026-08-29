// Section 44: single source of truth for every balancing knob. Nothing here
// is duplicated elsewhere — enemy/level scaling, score values and upgrade
// odds all read from this file.

export const BALANCE = {
  player: {
    baseStats: {
      maxHealth: 100,
      // Slight edge over the level-1 enemy (section 11: "Captain Windel
      // soll am Anfang einen Vorteil haben. Nicht extrem.").
      meleeDamage: 14,
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
    // becomes before the difficulty curve multiplier (below) tapers it for
    // early levels and ramps it back up later.
    healthGrowthPerLevel: 0.05,
    damageGrowthPerLevel: 0.04,
    speedGrowthPerLevel: 0.008,
    defenseGrowthPerLevel: 0.004,
    sizeGrowthPerLevel: 0.02, // ~2% per level (section 10)
    maxSizeMult: 1.9,
  },
  // Section 6/10: "Lernkurve statt sofortiger Schwierigkeit". Levels 1-3 get
  // only a fraction of the normal growth rate, 4-5 a bit more, 6-10 close to
  // normal, and beyond level 10 the curve is allowed to accelerate past 1x.
  difficultyCurve: [
    { uptoLevel: 3, multiplier: 0.3 },
    { uptoLevel: 5, multiplier: 0.5 },
    { uptoLevel: 10, multiplier: 0.75 },
    { uptoLevel: 20, multiplier: 1.0 },
    { uptoLevel: 35, multiplier: 1.2 },
    { uptoLevel: Infinity, multiplier: 1.4 },
  ],
  boss: {
    // Deutlich stärker, aber nicht unfair (section 12) — tuned down a
    // further ~15-20% from the previous 4.5x/1.35x pass, which still felt
    // too punishing. A boss remains a clear, real step up, just no longer
    // a grind or an unfair damage race.
    healthMult: 3.7,
    damageMult: 1.1,
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
  // Section 1/2: the fight-start protection window (spawn-apart "READY!" →
  // "FIGHT!" beat) and how passive/hesitant/telegraphed enemies still are
  // in the first handful of levels. All keyed by campaign level index;
  // chaos-mode levels (way past this range) fall through to the last entry.
  combatStart: {
    // How long the pre-fight protection lasts (no hits possible for either
    // side, enemy stands still) before combat actually begins. Boss levels
    // use the existing, separate boss-intro timer instead.
    readyDurationMs: [
      { uptoLevel: 1, ms: 2600 },
      { uptoLevel: 2, ms: 2000 },
      { uptoLevel: 3, ms: 1700 },
      { uptoLevel: Infinity, ms: 1500 },
    ],
    // How eagerly an enemy takes an attack opportunity once it's in range
    // (1 = always). Lower values mean visible hesitation/openings.
    aggression: [
      { uptoLevel: 2, value: 0.45 },
      { uptoLevel: 4, value: 0.6 },
      { uptoLevel: 8, value: 0.75 },
      { uptoLevel: Infinity, value: 0.9 },
    ],
    // Section (boss AI overhaul, quality update): lowered further — bosses
    // now lean on their named special abilities (see bossBehavior.ts +
    // GameEngine.executeBossAbility) as their signature threat instead of
    // relentless plain punches, so this only governs how often they still
    // throw an ordinary melee swing between specials. A boss that swings
    // less relentlessly with fists also reads as a distinct, more
    // dangerous character rather than "a normal enemy with more HP."
    bossAggression: 0.35,
    // How long an attack telegraphs (visible windup) before the hit-check
    // resolves. The player's own attacks stay snappy — this only slows
    // down enemy/boss swings so they're readable (section 8).
    enemyTelegraphMs: [
      { uptoLevel: 2, ms: 420 },
      { uptoLevel: 4, ms: 340 },
      { uptoLevel: 8, ms: 260 },
      { uptoLevel: Infinity, ms: 200 },
    ],
    bossTelegraphMs: 300,
    // Extra cooldown tacked onto an enemy's attack (beyond the weapon's own
    // cadence) so it can't immediately re-engage — gives the player a real
    // opening and stops the enemy from just pinning them down (section 7/9).
    recoveryBonusMs: [
      { uptoLevel: 3, ms: 480 },
      { uptoLevel: 6, ms: 320 },
      { uptoLevel: 10, ms: 180 },
      { uptoLevel: Infinity, ms: 80 },
    ],
    // Bosses use their own, level-independent recovery floor rather than
    // the normal-enemy curve above — otherwise a late-campaign boss (whose
    // level index falls into the low end of that curve) would end up
    // attacking almost back-to-back. Raised further (boss AI overhaul) —
    // together with the lower bossAggression above, this leaves clearer
    // idle/movement beats between a boss's plain attacks, so its named
    // specials (with their own explicit telegraph) read as the moves that
    // actually define the fight.
    bossRecoveryBonusMs: 650,
  },
  // Section 1 (item pacing pass): items shouldn't feel mandatory after
  // every single win. Bosses always reward one (they're a real milestone);
  // normal levels only every other win, so upgrades stay a deliberate,
  // occasional strategic choice instead of a routine step.
  upgradePacing: {
    normalLevelInterval: 2,
  },
} as const;

function pickByLevel(table: readonly { uptoLevel: number }[], valueKey: string, levelIndex: number): number {
  for (const entry of table) {
    if (levelIndex <= entry.uptoLevel) return (entry as unknown as Record<string, number>)[valueKey];
  }
  return (table[table.length - 1] as unknown as Record<string, number>)[valueKey];
}

export function difficultyCurveMultiplier(levelIndex: number): number {
  return pickByLevel(BALANCE.difficultyCurve, 'multiplier', levelIndex);
}

export function readyDurationMs(levelIndex: number): number {
  return pickByLevel(BALANCE.combatStart.readyDurationMs, 'ms', levelIndex);
}

export function enemyAggression(levelIndex: number, isBoss: boolean): number {
  return isBoss ? BALANCE.combatStart.bossAggression : pickByLevel(BALANCE.combatStart.aggression, 'value', levelIndex);
}

export function enemyTelegraphMs(levelIndex: number, isBoss: boolean): number {
  return isBoss ? BALANCE.combatStart.bossTelegraphMs : pickByLevel(BALANCE.combatStart.enemyTelegraphMs, 'ms', levelIndex);
}

export function enemyRecoveryBonusMs(levelIndex: number, isBoss: boolean): number {
  return isBoss ? BALANCE.combatStart.bossRecoveryBonusMs : pickByLevel(BALANCE.combatStart.recoveryBonusMs, 'ms', levelIndex);
}

// Section 1 (item pacing pass): should this level's win offer an upgrade
// choice? Every boss does (it's a milestone); normal levels only every
// Nth win, so items stay a deliberate, occasional reward rather than a
// routine step after every fight.
export function shouldOfferUpgrade(levelIndex: number, isBoss: boolean): boolean {
  if (isBoss) return true;
  return levelIndex % BALANCE.upgradePacing.normalLevelInterval === 0;
}
