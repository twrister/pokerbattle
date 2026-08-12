import {
  UNIT_TYPE_IDS,
  applyUnitConfigDrafts,
  captureUnitConfigsAsDefault,
  dumpDefaultUnitConfigDrafts,
  dumpUnitConfigDrafts,
  resetUnitConfigsToDefault,
  type ChargeConfigDraft,
  type DetonateConfigDraft,
  type HealConfigDraft,
  type InspireConfigDraft,
  type UnitConfigDraft,
  type UnitLevelConfigDraft,
  type UnitTypeConfigDraft,
  type UnitTypeId,
} from '@pb/sim';

/** 表单字段元数据：label + 输入控件步进 */
export const NUMERIC_FIELDS: ReadonlyArray<{
  key: keyof UnitConfigDraft;
  label: string;
  step: string;
  hint?: string;
}> = [
  { key: 'radius', label: '半径', step: '0.05', hint: '碰撞' },
  { key: 'bodyScale', label: '体型', step: '0.05', hint: '民兵=1' },
  { key: 'mass', label: '质量', step: '0.1', hint: '推挤权重' },
  { key: 'maxHp', label: '生命', step: '10' },
  { key: 'damage', label: '伤害', step: '5' },
  { key: 'attackInterval', label: '攻击间隔', step: '1', hint: 'tick，20≈1秒' },
  { key: 'attackWindup', label: '前摇', step: '1', hint: 'tick' },
  { key: 'range', label: '射程', step: '0.1', hint: '最大，边缘到边缘' },
  { key: 'minRange', label: '最小射程', step: '0.1', hint: '0=无近距限制' },
  { key: 'moveSpeed', label: '移速', step: '0.1', hint: '单位/秒' },
  { key: 'sightRange', label: '索敌', step: '1' },
  { key: 'projectileSpeed', label: '弹速', step: '0.5', hint: '仅远程' },
  { key: 'aoeRadius', label: '范围半径', step: '0.1', hint: '仅范围弹道' },
];

/** 技能配置块键；与 UnitConfigDraft 可选技能字段一一对应。 */
export type SkillBlockKey = 'charge' | 'inspire' | 'heal' | 'summon' | 'detonate';

/** 技能数值字段元数据。 */
export type SkillNumericFieldMeta = {
  key: string;
  label: string;
  step: string;
  hint?: string;
  kind: 'number';
};

/** 召唤目标兵种下拉（仅 summon.unitTypeId）。 */
export type SkillSelectFieldMeta = {
  key: 'unitTypeId';
  label: string;
  kind: 'select';
  options: readonly UnitTypeId[];
};

export type SkillFieldMeta = SkillNumericFieldMeta | SkillSelectFieldMeta;

export type SkillGroupMeta = {
  key: SkillBlockKey;
  title: string;
  fields: readonly SkillFieldMeta[];
};

/** 有技能块时在参数面板展示的分组；仅编辑已有块，不凭空创建。 */
export const SKILL_GROUPS: readonly SkillGroupMeta[] = [
  {
    key: 'charge',
    title: '冲锋',
    fields: [
      { key: 'cooldown', label: '冷却', step: '1', hint: 'tick，20≈1秒', kind: 'number' },
      { key: 'windup', label: '前摇', step: '1', hint: 'tick', kind: 'number' },
      { key: 'distance', label: '距离', step: '0.1', hint: '格', kind: 'number' },
      { key: 'speedMul', label: '速倍', step: '0.1', kind: 'number' },
      { key: 'triggerMin', label: '触发下限', step: '0.1', hint: '中心距', kind: 'number' },
      { key: 'triggerMax', label: '触发上限', step: '0.1', hint: '中心距', kind: 'number' },
      { key: 'hitDamage', label: '途伤', step: '1', kind: 'number' },
      { key: 'knockback', label: '击退', step: '0.1', hint: '格', kind: 'number' },
      { key: 'aoeRadius', label: '溅射', step: '0.1', hint: '格', kind: 'number' },
    ],
  },
  {
    key: 'inspire',
    title: '振奋',
    fields: [
      { key: 'radius', label: '半径', step: '0.1', hint: '格', kind: 'number' },
      {
        key: 'attackIntervalMul',
        label: '攻间隔倍',
        step: '0.05',
        hint: '<1 更快',
        kind: 'number',
      },
      { key: 'moveSpeedMul', label: '移速倍', step: '0.05', kind: 'number' },
    ],
  },
  {
    key: 'heal',
    title: '治疗',
    fields: [
      { key: 'cooldown', label: '冷却', step: '1', hint: 'tick，20≈1秒', kind: 'number' },
      { key: 'targetRange', label: '射程', step: '0.1', hint: '中心距', kind: 'number' },
      { key: 'amount', label: '治疗量', step: '1', kind: 'number' },
    ],
  },
  {
    key: 'summon',
    title: '召唤',
    fields: [
      { key: 'cooldown', label: '冷却', step: '1', hint: 'tick，20≈1秒', kind: 'number' },
      { key: 'unitTypeId', label: '召唤物', kind: 'select', options: UNIT_TYPE_IDS },
    ],
  },
  {
    key: 'detonate',
    title: '自爆',
    fields: [
      { key: 'fuse', label: '引信', step: '1', hint: 'tick，20≈1秒', kind: 'number' },
      { key: 'aoeRadius', label: '爆径', step: '0.1', hint: '格', kind: 'number' },
    ],
  },
];

/** 草稿上已存在的技能分组（用于渲染，不创建新块）。 */
export function presentSkillGroups(levelDraft: UnitLevelConfigDraft): SkillGroupMeta[] {
  return SKILL_GROUPS.filter((group) => levelDraft[group.key] != null);
}

/** 总览表优先展示的战斗向字段（其余仍可在「更多」列编辑）。 */
export const PRIMARY_NUMERIC_KEYS = [
  'maxHp',
  'damage',
  'attackInterval',
  'range',
  'moveSpeed',
] as const satisfies ReadonlyArray<keyof UnitConfigDraft>;

/** 紧挨移速后展示的体型字段（固定列宽 100）。 */
export const POST_MOVE_NUMERIC_KEYS = ['radius', 'bodyScale'] as const satisfies ReadonlyArray<
  keyof UnitConfigDraft
>;

/** 紧挨体型后展示的字段（固定窄列）。 */
export const PRE_ATTACK_NUMERIC_KEYS = ['attackWindup'] as const satisfies ReadonlyArray<
  keyof UnitConfigDraft
>;

export type UnitDraftMap = Record<UnitTypeId, UnitTypeConfigDraft>;

/** 从运行时拉取当前草稿。 */
export function loadUnitDrafts(): UnitDraftMap {
  return dumpUnitConfigDrafts();
}

/** 恢复文件快照草稿。 */
export function loadDefaultUnitDrafts(): UnitDraftMap {
  resetUnitConfigsToDefault();
  return dumpDefaultUnitConfigDrafts();
}

/** 应用到运行时并尝试写回 units.json。 */
export async function saveUnitDrafts(
  drafts: UnitDraftMap,
): Promise<{ ok: true } | { ok: false; error: string }> {
  applyUnitConfigDrafts(drafts);
  const result = await persistDraftsToFile(drafts);
  if (result.ok) captureUnitConfigsAsDefault();
  return result;
}

/** POST 到 Vite 开发中间件写盘；preview/build 下接口不存在。 */
export async function persistDraftsToFile(
  drafts: UnitDraftMap,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/__pb/unit-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(drafts),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        // 非 JSON 错误体时沿用 status
      }
      if (res.status === 404) {
        return { ok: false, error: '需在 pnpm dev 下保存' };
      }
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** 取得当前等级参数；旧配置首次编辑时自动迁移成完整的一级配置。 */
export function getLevelDraft(draft: UnitTypeConfigDraft, level: number): UnitLevelConfigDraft {
  if (!draft.levels) {
    const { id: _id, name: _name, levels: _levels, ...levelOne } = draft;
    draft.levels = { 1: levelOne };
  }
  const current = draft.levels[String(level)];
  if (current) return current;
  const fallback = draft.levels['1'];
  if (!fallback) throw new Error('兵种至少需要保留一个等级');
  draft.levels[String(level)] = { ...fallback };
  return draft.levels[String(level)]!;
}

/** 只接受数值字段，避免把 name/attackKind/技能块误写成 number。 */
export function assignNumericField(
  draft: UnitLevelConfigDraft,
  field: keyof UnitConfigDraft,
  value: number,
): void {
  switch (field) {
    case 'radius':
    case 'bodyScale':
    case 'mass':
    case 'maxHp':
    case 'damage':
    case 'attackInterval':
    case 'attackWindup':
    case 'range':
    case 'minRange':
    case 'moveSpeed':
    case 'sightRange':
    case 'projectileSpeed':
    case 'aoeRadius':
      draft[field] = value;
      break;
    default:
      break;
  }
}

/**
 * 写入已有技能块的数值字段；块不存在时跳过，避免凭空创建技能。
 * 各 case 收窄嵌套类型，防止误写 unitTypeId 等非数值键。
 */
export function assignSkillNumericField(
  draft: UnitLevelConfigDraft,
  skill: SkillBlockKey,
  field: string,
  value: number,
): void {
  switch (skill) {
    case 'charge': {
      const block = draft.charge;
      if (!block) return;
      assignChargeNumeric(block, field, value);
      break;
    }
    case 'inspire': {
      const block = draft.inspire;
      if (!block) return;
      assignInspireNumeric(block, field, value);
      break;
    }
    case 'heal': {
      const block = draft.heal;
      if (!block) return;
      assignHealNumeric(block, field, value);
      break;
    }
    case 'summon': {
      const block = draft.summon;
      if (!block) return;
      if (field === 'cooldown') block.cooldown = value;
      break;
    }
    case 'detonate': {
      const block = draft.detonate;
      if (!block) return;
      assignDetonateNumeric(block, field, value);
      break;
    }
    default:
      break;
  }
}

function assignChargeNumeric(block: ChargeConfigDraft, field: string, value: number): void {
  switch (field) {
    case 'cooldown':
    case 'windup':
    case 'distance':
    case 'speedMul':
    case 'triggerMin':
    case 'triggerMax':
    case 'hitDamage':
    case 'knockback':
    case 'aoeRadius':
      block[field] = value;
      break;
    default:
      break;
  }
}

function assignInspireNumeric(block: InspireConfigDraft, field: string, value: number): void {
  switch (field) {
    case 'radius':
    case 'attackIntervalMul':
    case 'moveSpeedMul':
      block[field] = value;
      break;
    default:
      break;
  }
}

function assignHealNumeric(block: HealConfigDraft, field: string, value: number): void {
  switch (field) {
    case 'cooldown':
    case 'targetRange':
    case 'amount':
      block[field] = value;
      break;
    default:
      break;
  }
}

function assignDetonateNumeric(block: DetonateConfigDraft, field: string, value: number): void {
  switch (field) {
    case 'fuse':
    case 'aoeRadius':
      block[field] = value;
      break;
    default:
      break;
  }
}

/** 写入召唤目标兵种；仅当召唤块已存在且选项合法时生效。 */
export function assignSummonUnitTypeId(
  draft: UnitLevelConfigDraft,
  unitTypeId: string,
): void {
  const block = draft.summon;
  if (!block) return;
  if (!(UNIT_TYPE_IDS as readonly string[]).includes(unitTypeId)) return;
  block.unitTypeId = unitTypeId as UnitTypeId;
}

/** 去掉多余尾零，方便编辑。 */
export function formatDraftNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** 从带 data-field 的控件读回草稿（含 data-skill 嵌套技能字段）。 */
export function readControlsIntoDrafts(
  root: ParentNode,
  drafts: UnitDraftMap,
): void {
  for (const el of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')) {
    const typeId = el.dataset.unit as UnitTypeId | undefined;
    const field = el.dataset.field;
    if (!typeId || !field) continue;
    const draft = drafts[typeId];
    if (!draft) continue;
    const levelDraft = getLevelDraft(draft, Number(el.dataset.level) || 1);
    const skill = el.dataset.skill as SkillBlockKey | undefined;
    if (skill) {
      readSkillControl(levelDraft, skill, field, el.value);
      continue;
    }
    if (field === 'name') {
      draft.name = el.value.trim() || draft.name;
      continue;
    }
    if (field === 'attackKind') {
      levelDraft.attackKind =
        el.value === 'projectile_aoe'
          ? 'projectile_aoe'
          : el.value === 'projectile'
            ? 'projectile'
            : el.value === 'melee_aoe'
              ? 'melee_aoe'
              : 'melee';
      continue;
    }
    if (field === 'movementLayer') {
      levelDraft.movementLayer = el.value === 'air' ? 'air' : 'ground';
      continue;
    }
    const num = Number(el.value);
    if (!Number.isFinite(num)) continue;
    assignNumericField(levelDraft, field as keyof UnitConfigDraft, num);
  }
}

/** 按技能块类型写回控件值；summon.unitTypeId 走下拉，其余走数值。 */
function readSkillControl(
  levelDraft: UnitLevelConfigDraft,
  skill: SkillBlockKey,
  field: string,
  raw: string,
): void {
  if (skill === 'summon' && field === 'unitTypeId') {
    assignSummonUnitTypeId(levelDraft, raw);
    return;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return;
  assignSkillNumericField(levelDraft, skill, field, num);
}
