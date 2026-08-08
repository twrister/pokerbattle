export * as fx from './math/fixed.js';
export { type Fx, ONE, fromFloat, fromInt, toFloat } from './math/fixed.js';
export { type Vec2, vec } from './math/vec2.js';
export { Rng } from './math/rng.js';

export { ARENA_HEIGHT, ARENA_WIDTH, NAV_CELL_SIZE, clampToArena } from './config/arena.js';
export { REPATH_INTERVAL, RETARGET_INTERVAL, TICK_RATE } from './config/tuning.js';
export {
  BODY_SCALE_REFERENCE,
  MAX_UNIT_RADIUS,
  UNIT_CONFIGS,
  UNIT_TYPE_IDS,
  type ChargeConfig,
  type ChargeConfigDraft,
  type HealConfig,
  type HealConfigDraft,
  type InspireConfig,
  type InspireConfigDraft,
  type UnitConfig,
  type UnitConfigDraft,
  type UnitTypeId,
  applyUnitConfigDrafts,
  captureUnitConfigsAsDefault,
  dumpDefaultUnitConfigDrafts,
  dumpUnitConfigDrafts,
  getUnitConfig,
  recomputeMaxUnitRadius,
  resetUnitConfigsToDefault,
  toUnitConfigDraft,
} from './config/units.js';
export {
  CARD_FORMATIONS,
  FORMATION_COL_SPACING,
  FORMATION_ROW_SPACING,
  HAND_CATEGORY_NAMES,
  HAND_CATEGORY_ORDER,
  applyCardFormationDrafts,
  captureCardFormationsAsDefault,
  createCardFormation,
  dumpCardFormationDrafts,
  dumpDefaultCardFormationDrafts,
  resetCardFormationsToDefault,
  validateCardFormationDrafts,
  type CardFormation,
  type CardFormationDrafts,
  type FormationDraft,
  type FormationSlot,
  type FormationSpawnPoint,
  type FormationUnitEntry,
  type HandCategory,
  getFormationsFor,
  resolveFormationSpawns,
  resolveFormationSpawnsFx,
} from './config/cardFormations.js';

export { type Attributes } from './stats/attributes.js';
export { BUFF_STATS, type Buff, BuffOp, type BuffStat, recomputeStats } from './stats/buff.js';

export { Faction, NO_TARGET, type Unit, UnitState, isAlive, opposingFaction } from './entity/unit.js';
export { type Projectile } from './entity/projectile.js';

export { NavGrid } from './nav/grid.js';
export { PathFinder } from './nav/astar.js';
export { SpatialHash } from './spatial/hash.js';

export { type Command, CommandKind, type SpawnCommand, spawnCommand } from './commands.js';
export {
  type AoePulseEffectSnapshot,
  type HealEffectSnapshot,
  type ProjectileSnapshot,
  type Snapshot,
  type UnitSnapshot,
  emptySnapshot,
  takeSnapshot,
} from './snapshot.js';
export { type AoePulseKind, type AoePulseEffect, type HealEffect } from './entity/effect.js';
export { World } from './world.js';
