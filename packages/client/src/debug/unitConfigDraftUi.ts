import {
  applyUnitConfigDrafts,
  captureUnitConfigsAsDefault,
  dumpDefaultUnitConfigDrafts,
  dumpUnitConfigDrafts,
  resetUnitConfigsToDefault,
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

/** 总览表优先展示的战斗向字段（其余仍可在「更多」列编辑）。 */
export const PRIMARY_NUMERIC_KEYS = [
  'maxHp',
  'damage',
  'attackInterval',
  'range',
  'moveSpeed',
] as const satisfies ReadonlyArray<keyof UnitConfigDraft>;

/** 紧挨攻击方式前展示的字段（固定窄列）。 */
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

/** 去掉多余尾零，方便编辑。 */
export function formatDraftNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** 从带 data-field 的控件读回草稿。 */
export function readControlsIntoDrafts(
  root: ParentNode,
  drafts: UnitDraftMap,
): void {
  for (const el of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]')) {
    const typeId = el.dataset.unit as UnitTypeId | undefined;
    const field = el.dataset.field as keyof UnitConfigDraft | undefined;
    if (!typeId || !field) continue;
    const draft = drafts[typeId];
    if (!draft) continue;
    if (field === 'name') {
      draft.name = el.value.trim() || draft.name;
      continue;
    }
    if (field === 'attackKind') {
      getLevelDraft(draft, Number(el.dataset.level) || 1).attackKind =
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
      getLevelDraft(draft, Number(el.dataset.level) || 1).movementLayer =
        el.value === 'air' ? 'air' : 'ground';
      continue;
    }
    const num = Number(el.value);
    if (!Number.isFinite(num)) continue;
    assignNumericField(getLevelDraft(draft, Number(el.dataset.level) || 1), field, num);
  }
}
