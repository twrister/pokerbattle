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
  type ArenaBridge,
} from './config/arenaTerrain.js';
export {
  AIR_PROJECTILE_HEIGHT,
  AIR_UNIT_HOVER_HEIGHT,
  GROUND_PROJECTILE_HEIGHT,
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
  type UnitTypeId,
  applyUnitConfigDrafts,
  captureUnitConfigsAsDefault,
  dumpDefaultUnitConfigDrafts,
  dumpUnitConfigDrafts,
  getUnitConfig,
  isBuildingConfig,
  recomputeMaxUnitRadius,
  resetUnitConfigsToDefault,
  toUnitConfigDraft,
} from './config/units.js';
export {
  CARD_FORMATIONS,
  FORMATION_COL_SPACING,
  FORMATION_ROW_SPACING,
  FORMATION_THUMB_SCALE,
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_ORDER,
  applyCardFormationDrafts,
  captureCardFormationsAsDefault,
  createCardFormation,
  dumpCardFormationDrafts,
  dumpDefaultCardFormationDrafts,
  findFormationById,
  resetCardFormationsToDefault,
  validateCardFormationDrafts,
  type CardFormation,
  type CardFormationDrafts,
  type FormationDraft,
  type FormationSlot,
  type FormationSpawnPoint,
  type FormationUnitEntry,
  type HandCategory,
  getFormationBuildingTypeId,
  getFormationsFor,
  isBuildingOnlyFormation,
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
  isFormationInsideHalfCourt,
  type SimPoint as HalfCourtPoint,
} from './config/halfCourt.js';

export {
  FRESH_CARD_WEIGHT,
  INITIAL_HAND_SIZE,
  MAX_HAND_SIZE,
  PokerDeck,
  RETURNED_CARD_WEIGHT,
  compareCardsByStrength,
  createPokerCards,
  getCardStrength,
  type CardRank,
  type CardSuit,
  type PlayingCard,
} from './cards/deck.js';
export { detectHandCategories, findStrongestHand } from './cards/handCategory.js';
export { DRAW_INTERVAL_TICKS, MatchState } from './match/matchState.js';

export { type Attributes } from './stats/attributes.js';
export { BUFF_STATS, type Buff, BuffOp, type BuffStat, recomputeStats } from './stats/buff.js';

export { Faction, NO_TARGET, type Unit, UnitState, isAlive, opposingFaction } from './entity/unit.js';
export { type Projectile } from './entity/projectile.js';

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
  type PlaceBuildingCommand,
  type PlayFormationCommand,
  type SpawnCommand,
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
