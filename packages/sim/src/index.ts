export * as fx from './math/fixed.js';
export { type Fx, ONE, fromFloat, fromInt, toFloat } from './math/fixed.js';
export { type Vec2, vec } from './math/vec2.js';
export { Rng } from './math/rng.js';

export { ARENA_HEIGHT, ARENA_WIDTH, NAV_CELL_SIZE, clampToArena } from './config/arena.js';
export {
  ARENA_BRIDGES,
  ARENA_RIVER_MAX_Y,
  ARENA_RIVER_MIN_Y,
  applyArenaTerrain,
  centeredRiverRange,
  type ArenaBridge,
} from './config/arenaTerrain.js';
export {
  applyArenaConfigDraft,
  captureArenaConfigAsDefault,
  dumpArenaConfigDraft,
  dumpDefaultArenaConfigDraft,
  resetArenaConfigToDefault,
  validateArenaConfigDraft,
  type ArenaCameraDraft,
  type ArenaCameraMode,
  type ArenaColorsDraft,
  type ArenaConfigDraft,
} from './config/arenaConfig.js';
export {
  AIR_PROJECTILE_HEIGHT,
  AIR_UNIT_HOVER_HEIGHT,
  BOMB_ARC_APEX,
  GROUND_PROJECTILE_HEIGHT,
  TOWER_PROJECTILE_HEIGHT,
  REPATH_INTERVAL,
  RETARGET_INTERVAL,
  TICK_RATE,
} from './config/tuning.js';
export {
  BODY_SCALE_REFERENCE,
  MAX_UNIT_RADIUS,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  type AttackKind,
  type ChargeConfig,
  type ChargeConfigDraft,
  type DetonateConfig,
  type DetonateConfigDraft,
  type HealConfig,
  type HealConfigDraft,
  type InspireConfig,
  type InspireConfigDraft,
  type MovementLayer,
  type SummonConfig,
  type SummonConfigDraft,
  type UnitConfig,
  type UnitConfigDraft,
  type UnitLevelConfigDraft,
  type UnitTypeConfigDraft,
  type UnitTypeId,
  applyUnitConfigDrafts,
  captureUnitConfigsAsDefault,
  dumpDefaultUnitConfigDrafts,
  dumpUnitConfigDrafts,
  getUnitConfig,
  getUnitLevels,
  canBuildingAttack,
  isArcherTowerId,
  isBuildingConfig,
  recomputeMaxUnitRadius,
  resetUnitConfigsToDefault,
  toUnitConfigDraft,
  UNIT_LEVEL_CONFIGS,
  UNIT_LEVELS_ENABLED,
} from './config/units.js';
export {
  CARD_FORMATIONS,
  FORMATION_COL_SPACING,
  FORMATION_ROW_SPACING,
  FORMATION_THUMB_SCALE,
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_ORDER,
  HAND_CATEGORY_STRENGTH_ORDER,
  allocateCopiedFormationIdentity,
  applyCardFormationDrafts,
  captureCardFormationsAsDefault,
  cloneFormationDraft,
  createCardFormation,
  dumpCardFormationDrafts,
  dumpDefaultCardFormationDrafts,
  findFormationById,
  formatMatchRuleLabel,
  groupFormationsByMatch,
  matchRuleKey,
  resetCardFormationsToDefault,
  resolveCardFormation,
  validateCardFormationDrafts,
  type CardFormation,
  type CardFormationDrafts,
  type FormationDraft,
  type FormationMatchGroup,
  type FormationMatchRule,
  type FormationSlot,
  type FormationSpawnPoint,
  type FormationUnitEntry,
  type HandCategory,
  getExclusiveFormationUnitTag,
  getFormationBuildingTypeId,
  getFormationsFor,
  getFuseBombTypeId,
  isBuildingOnlyFormation,
  isFuseBombFormation,
  isFuseBombTypeId,
  isGiantBombFormation,
  resolveFormationSpawns,
  resolveFormationSpawnsFx,
  validateBuildingOnlyRows,
} from './config/cardFormations.js';
export {
  HALF_COURT_MID_Y,
  halfCourtSafeAnchor,
  halfCourtSafeBuildingAnchor,
  halfCourtYRange,
  isBuildingInsideHalfCourt,
  isDeployAnchorInsideHalfCourt,
  isFormationInsideHalfCourt,
  type SimPoint as HalfCourtPoint,
} from './config/halfCourt.js';

export {
  FRESH_CARD_WEIGHT,
  HAND_LIMIT_DOUBLE_SPEED,
  HAND_LIMIT_FINAL,
  HAND_LIMIT_NORMAL,
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PokerDeck,
  RETURNED_CARD_WEIGHT,
  clampHandSize,
  compareCardsByStrength,
  createPokerCards,
  getPokerCardById,
  getCardStrength,
  type CardRank,
  type CardSuit,
  type PlayingCard,
} from './cards/deck.js';
export { detectHandCategories, findStrongestHand, listPresentCategories } from './cards/handCategory.js';
export {
  FORMATION_MATCH_RANKS,
  FUSE_BOMB_DAMAGE_RANKS,
  FUSE_BOMB_DAMAGE_RANK_LABELS,
  cardsMatchRule,
  fuseBombDamageRankOf,
  getPreviewCardsForFormation,
  layoutMappedUnits,
  resolveFuseBombDamage,
  resolveMappedRows,
  type FuseBombDamageRank,
  type FuseBombDamageSource,
  type MappedFormationUnit,
} from './config/cardMapping.js';
export {
  HAND_ODDS_DEFAULT_TRIALS,
  HAND_ODDS_MAX_SIZE,
  HAND_ODDS_MIN_SIZE,
  createHitCounters,
  estimateHandCategoryOdds,
  estimateHandCategoryOddsSweep,
  isValidHandOddsSize,
  runHandCategoryOddsChunk,
  toProbabilities,
  type HandCategoryOddsOptions,
  type HandCategoryOddsResult,
  type HandCategoryOddsSweepResult,
} from './cards/handCategoryOdds.js';
export {
  CASTLE_PROTECT_CARDS,
  CASTLE_PROTECT_HP,
  CASTLE_PROTECT_HP_RATIO,
  DEFAULT_PHASE_DURATION_SECONDS,
  DEFAULT_PHASE_DURATION_TICKS,
  DOUBLE_SPEED_DRAW_INTERVAL_TICKS,
  DOUBLE_SPEED_START_TICKS,
  FINAL_DRAW_INTERVAL_TICKS,
  FINAL_START_TICKS,
  MATCH_END_TICKS,
  MatchState,
  NORMAL_DRAW_INTERVAL_TICKS,
  defaultMatchRules,
  type CastlePackState,
  type MatchDrawIntervals,
  type MatchEndReason,
  type MatchHandLimits,
  type MatchPhase,
  type MatchPhaseDurations,
  type MatchResult,
  type MatchRules,
} from './match/matchState.js';
export { SoloBotController, type SoloDifficulty } from './match/soloBot.js';

export { type Attributes } from './stats/attributes.js';
export { BUFF_STATS, type Buff, BuffOp, type BuffStat, recomputeStats } from './stats/buff.js';

export { Faction, NO_TARGET, type Unit, UnitState, isAlive, opposingFaction } from './entity/unit.js';
export {
  type Projectile,
  type ProjectileImpactFx,
  type ProjectileVisual,
} from './entity/projectile.js';

export { NavGrid } from './nav/grid.js';
export { PathFinder } from './nav/astar.js';
export { SpatialHash } from './spatial/hash.js';
export {
  type BuildingCellRect,
  buildingCellRange,
  isBuildingRectInsideArena,
  snapBuildingCenter,
} from './nav/buildingGrid.js';

export {
  type Command,
  CommandKind,
  type ClaimCastlePackCommand,
  type PlaceBuildingCommand,
  type PlayFormationCommand,
  type SpawnCommand,
  claimCastlePackCommand,
  placeBuildingCommand,
  playFormationCommand,
  spawnCommand,
} from './commands.js';
export {
  type AoePulseEffectSnapshot,
  type ExplosionEffectSnapshot,
  type HealEffectSnapshot,
  type ProjectileSnapshot,
  type Snapshot,
  type UnitSnapshot,
  emptySnapshot,
  takeSnapshot,
} from './snapshot.js';
export {
  type AoePulseKind,
  type AoePulseEffect,
  type ExplosionEffect,
  type HealEffect,
} from './entity/effect.js';
export { World } from './world.js';
export {
  DEFAULT_BALANCE_OPTIONS,
  runBalanceAnalysis,
  yieldToUi,
  type BalanceAnalysisHooks,
  type BalanceAnalysisOptions,
  type BalanceMode,
  type BalanceProgress,
  type BalanceReport,
} from './balance/runBalance.js';
export {
  NUMBERS_FLAT_NOTE,
  RANK_TIER_LABELS,
  formatRankTier,
  listBalanceEntries,
  rankTierOfCardRank,
  rankTierOfMatch,
  type Entry as BalanceEntry,
} from './balance/entries.js';
export {
  aggregatePairs,
  categoryMedians,
  checkMonotonicity,
  fitMeleeRatings,
  fitSoloRatings,
  intersectViolations,
  type EntryRating,
  type MonotonicityViolation,
  type PairAggregate,
  type SharedViolation,
} from './balance/rating.js';
export { renderMatchupCsv, renderStrengthMarkdown, type ReportInput } from './balance/report.js';
