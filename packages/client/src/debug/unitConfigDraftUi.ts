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
  { key: 'aoeRadius', label: '爆炸范围', step: '0.1', hint: '仅范围弹道' },
];

/** 技能配置块键；与 UnitConfigDraft 可选技能字段一一对应。 */
export type SkillBlockKey = 'charge' | 'inspire' | 'heal' | 'summon' | 'detonate' | 'deathSpawn';

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
  {
    key: 'deathSpawn',
    title: '阵亡生成',
    fields: [
      { key: 'count', label: '人数', step: '1', hint: '阵亡后原地生成', kind: 'number' },
      { key: 'unitTypeId', label: '生成兵种', kind: 'select', options: UNIT_TYPE_IDS },
    ],
  },
];

/** 草稿上已存在的技能分组（用于渲染，不创建新块）。 */
export function presentSkillGroups(draft: UnitConfigDraft): SkillGroupMeta[] {
  return SKILL_GROUPS.filter((group) => draft[group.key] != null);
}

/** 总览表优先展示的战斗向字段（其余仍可在「更多」列编辑）。 */
export const PRIMARY_NUMERIC_KEYS = [
  'maxHp',
  'damage',
  'attackInterval',
  'range',
  'sightRange',
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

/** 紧挨攻击方式后展示的落点爆炸范围（仅 projectile_aoe 可编辑）。 */
export const AOE_NUMERIC_KEYS = ['aoeRadius'] as const satisfies ReadonlyArray<
  keyof UnitConfigDraft
>;

export type UnitDraftMap = Record<UnitTypeId, UnitConfigDraft>;

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

export type SyncUnitConfigsResult =
  | { applied: true }
  | { applied: false; reason: 'unavailable' };

/** 单位参数页未保存草稿；验证时优先于磁盘，避免 GET 把界面改动盖掉。 */
let pendingUnitDrafts: UnitDraftMap | null = null;

/** 深拷贝草稿，避免页面后续编辑污染已暂存的验证快照。 */
function cloneDrafts(drafts: UnitDraftMap): UnitDraftMap {
  return JSON.parse(JSON.stringify(drafts)) as UnitDraftMap;
}

/** 记下单位参数页的未保存草稿，供强度验证覆盖运行时。 */
export function rememberUnitDrafts(drafts: UnitDraftMap): void {
  pendingUnitDrafts = cloneDrafts(drafts);
}

/** 保存成功且已写盘后清掉暂存，让后续验证改读磁盘。 */
export function clearRememberedUnitDrafts(): void {
  pendingUnitDrafts = null;
}

/** 读取当前暂存草稿；没有则返回 null。 */
export function peekRememberedUnitDrafts(): UnitDraftMap | null {
  return pendingUnitDrafts;
}

/** 把暂存草稿应用到运行时；没有暂存则返回 false。 */
export function applyRememberedUnitDrafts(): boolean {
  if (!pendingUnitDrafts) return false;
  applyUnitConfigDrafts(pendingUnitDrafts);
  return true;
}

/**
 * 强度验证前同步单位配置：未保存的参数页草稿优先，否则读盘。
 * preview/build 下没有读盘接口时沿用当前运行时，不阻断验证。
 */
export async function syncUnitConfigsForBalance(): Promise<SyncUnitConfigsResult> {
  if (pendingUnitDrafts) {
    applyUnitConfigDrafts(pendingUnitDrafts);
    return { applied: true };
  }
  return syncUnitConfigsFromDevServer();
}

/**
 * 从开发服拉取磁盘上最新 units.json 并应用到运行时。
 * preview/build 下接口不存在（404），沿用当前打包配置，不阻断验证。
 */
export async function syncUnitConfigsFromDevServer(): Promise<SyncUnitConfigsResult> {
  const res = await fetch('/__pb/unit-configs');
  if (res.status === 404) {
    return { applied: false, reason: 'unavailable' };
  }
  if (!res.ok) {
    throw new Error(`读取单位配置失败：${await readHttpError(res)}`);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new Error('读取单位配置失败：响应不是合法 JSON');
  }
  applyUnitConfigDrafts(parseUnitDraftMap(parsed));
  return { applied: true };
}

/** 校验开发服返回的草稿表，缺兵种或关键战斗字段则拒绝应用。 */
function parseUnitDraftMap(value: unknown): UnitDraftMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('读取单位配置失败：响应必须是对象');
  }
  const drafts = value as Record<string, unknown>;
  for (const id of UNIT_TYPE_IDS) {
    const draft = drafts[id];
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      throw new Error(`读取单位配置失败：缺少兵种 ${id}`);
    }
    const rec = draft as Record<string, unknown>;
    if (typeof rec.maxHp !== 'number' || !Number.isFinite(rec.maxHp)) {
      throw new Error(`读取单位配置失败：${id}.maxHp 非法`);
    }
    if (typeof rec.damage !== 'number' || !Number.isFinite(rec.damage)) {
      throw new Error(`读取单位配置失败：${id}.damage 非法`);
    }
  }
  return drafts as UnitDraftMap;
}

/** 优先用服务端 error 字段，非 JSON 体时回落 HTTP 状态。 */
async function readHttpError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // 非 JSON 错误体时沿用 status
  }
  return `HTTP ${res.status}`;
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

/** 只接受数值字段，避免把 name/attackKind/技能块误写成 number。 */
export function assignNumericField(
  draft: UnitConfigDraft,
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
  draft: UnitConfigDraft,
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
    case 'deathSpawn': {
      const block = draft.deathSpawn;
      if (!block) return;
      if (field === 'count') block.count = value;
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

/** 写入召唤/阵亡生成目标兵种；仅当对应块已存在且选项合法时生效。 */
export function assignSummonUnitTypeId(
  draft: UnitConfigDraft,
  unitTypeId: string,
): void {
  assignSkillUnitTypeId(draft.summon, unitTypeId);
}

/** 写入阵亡生成兵种；块不存在或选项非法时跳过。 */
export function assignDeathSpawnUnitTypeId(
  draft: UnitConfigDraft,
  unitTypeId: string,
): void {
  assignSkillUnitTypeId(draft.deathSpawn, unitTypeId);
}

function assignSkillUnitTypeId(
  block: { unitTypeId: UnitTypeId } | undefined,
  unitTypeId: string,
): void {
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
    const skill = el.dataset.skill as SkillBlockKey | undefined;
    if (skill) {
      readSkillControl(draft, skill, field, el.value);
      continue;
    }
    if (field === 'name') {
      draft.name = el.value.trim() || draft.name;
      continue;
    }
    if (field === 'tag') {
      const tag = el.value.trim();
      if (tag) draft.tag = tag;
      else delete draft.tag;
      continue;
    }
    if (field === 'attackKind') {
      draft.attackKind =
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
      draft.movementLayer = el.value === 'air' ? 'air' : 'ground';
      continue;
    }
    const num = Number(el.value);
    if (!Number.isFinite(num)) continue;
    assignNumericField(draft, field as keyof UnitConfigDraft, num);
  }
}

/** 按技能块类型写回控件值；summon / deathSpawn 的 unitTypeId 走下拉，其余走数值。 */
function readSkillControl(
  draft: UnitConfigDraft,
  skill: SkillBlockKey,
  field: string,
  raw: string,
): void {
  if (field === 'unitTypeId') {
    if (skill === 'summon') assignSummonUnitTypeId(draft, raw);
    else if (skill === 'deathSpawn') assignDeathSpawnUnitTypeId(draft, raw);
    return;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return;
  assignSkillNumericField(draft, skill, field, num);
}
