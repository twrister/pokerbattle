import {
  Faction,
  opposingFaction,
  teamSlots,
  toFloat,
  type MatchResult,
  type MatchState,
  type SlotDamageStats,
} from '@pb/sim';
import { sfx } from '../audio/sfx.js';

export interface BattleResultContext {
  localName: string;
  opponentName: string;
  /** 本机席位；缺省等于本地阵营，兼容 1v1。 */
  localSlot?: number;
  teammateName?: string;
  teammateSlot?: number | null;
  opponentSlot?: number;
  extraOpponentName?: string;
  extraOpponentSlot?: number | null;
}

export interface BattleResultHandle {
  /** 写入双方显示名，结算时与残血一起展示。 */
  setContext(context: BattleResultContext): void;
  /** 联机结算回房间，单机结算回主界面。 */
  setReturnLabel(label: string): void;
  show(result: MatchResult, playerFaction: Faction, match?: MatchState): void;
  hide(): void;
}

interface ResultMember {
  name: string;
  slot: number;
}

/** 一条左右对比行：双方数值 + 分割条，三行指标共用同一结构。 */
interface CompareRow {
  selfValue: HTMLElement;
  oppValue: HTMLElement;
  selfBar: HTMLElement;
  split: HTMLElement;
}

/** 展示本局权威结算，并将阵营结果转换为本地玩家视角。 */
export function createBattleResult(onReturnToMenu: () => void): BattleResultHandle {
  const root = requiredElement<HTMLElement>('#battle-result-dialog');
  const title = requiredElement<HTMLElement>('#battle-result-title');
  const detail = requiredElement<HTMLElement>('#battle-result-detail');
  const selfCard = requiredElement<HTMLElement>('#battle-result-self');
  const oppCard = requiredElement<HTMLElement>('#battle-result-opp');
  const selfName = requiredElement<HTMLElement>('#battle-result-self-name');
  const oppName = requiredElement<HTMLElement>('#battle-result-opp-name');
  const hpRow: CompareRow = {
    selfValue: requiredElement('#battle-result-self-hp'),
    oppValue: requiredElement('#battle-result-opp-hp'),
    selfBar: requiredElement('#battle-result-hp-bar'),
    split: requiredElement('#battle-result-hp-split'),
  };
  const castleRow: CompareRow = {
    selfValue: requiredElement('#battle-result-self-castle-value'),
    oppValue: requiredElement('#battle-result-opp-castle-value'),
    selfBar: requiredElement('#battle-result-self-castle-bar'),
    split: requiredElement('#battle-result-castle-split'),
  };
  const unitsRow: CompareRow = {
    selfValue: requiredElement('#battle-result-self-units-value'),
    oppValue: requiredElement('#battle-result-opp-units-value'),
    selfBar: requiredElement('#battle-result-self-units-bar'),
    split: requiredElement('#battle-result-units-split'),
  };
  const memberTable = requiredElement<HTMLElement>('#battle-result-members');
  const button = requiredElement<HTMLButtonElement>('#btn-battle-result-return');
  button.addEventListener('click', onReturnToMenu);

  /** 联机结算回房间，单机结算回主界面。 */
  const setReturnLabel = (label: string): void => {
    button.textContent = label;
  };

  let context: BattleResultContext = {
    localName: '玩家',
    opponentName: '对手',
  };

  return {
    setReturnLabel,
    setContext(next) {
      context = {
        localName: next.localName || '玩家',
        opponentName: next.opponentName || '对手',
        localSlot: next.localSlot,
        teammateName: next.teammateName,
        teammateSlot: next.teammateSlot,
        opponentSlot: next.opponentSlot,
        extraOpponentName: next.extraOpponentName,
        extraOpponentSlot: next.extraOpponentSlot,
      };
    },
    show(result, playerFaction, match) {
      const outcome = result.winner === null ? '平局' : result.winner === playerFaction ? '胜利' : '失败';
      // 胜负用不同短音，平局走中性音，避免输了还响胜利号
      sfx.play(result.winner === null ? 'result_draw' : result.winner === playerFaction ? 'result_win' : 'result_lose');
      const is2v2 = match?.mode === '2v2';
      title.textContent = outcome;
      root.dataset.outcome = outcome;
      root.classList.toggle('is-2v2', Boolean(is2v2));
      detail.textContent = resultDetail(result);

      const selfFaction = playerFaction;
      const oppFaction = opposingFaction(playerFaction);
      fillHead(
        selfCard,
        oppCard,
        selfName,
        oppName,
        is2v2 ? '己方队伍' : context.localName,
        is2v2 ? '对方队伍' : context.opponentName,
        result,
        selfFaction,
        oppFaction,
      );

      // 血量行：数值写当前/上限，条宽按双方当前血量占比
      const selfHp = match ? toFloat(match.getCastleHp(selfFaction)) : null;
      const oppHp = match ? toFloat(match.getCastleHp(oppFaction)) : null;
      fillCompareRow(
        hpRow,
        match ? hpText(match, selfFaction) : '—',
        match ? hpText(match, oppFaction) : '—',
        selfHp,
        oppHp,
      );

      // 伤害两行：2v2 卡面写全队合计，1v1 就是本人
      const selfStats = match ? sumSlotDamage(match, damageSlots(context, selfFaction, true, match)) : null;
      const oppStats = match ? sumSlotDamage(match, damageSlots(context, oppFaction, false, match)) : null;
      fillDamageRow(castleRow, selfStats?.toCastle ?? null, oppStats?.toCastle ?? null);
      fillDamageRow(unitsRow, selfStats?.toUnits ?? null, oppStats?.toUnits ?? null);

      // 2v2 才需要逐人明细，1v1 上面三行已是全部信息
      fillMemberTable(
        memberTable,
        sideMembers(context, selfFaction, true, match),
        sideMembers(context, oppFaction, false, match),
        match,
      );

      root.classList.remove('is-hidden');
      root.setAttribute('aria-hidden', 'false');
    },
    hide() {
      root.classList.add('is-hidden');
      root.setAttribute('aria-hidden', 'true');
    },
  };
}

function resultDetail(result: MatchResult): string {
  if (result.reason === 'base_destroyed') return '基地被摧毁，对局提前结束。';
  if (result.reason === 'simultaneous_destroyed') return '双方基地同时被摧毁。';
  return result.winner === null ? '双方已无法改写胜负，基地血量相同。' : '已无法改写胜负，基地血量更高的一方获胜。';
}

/** 表头只写名字与胜负高亮；2v2 用队伍名代替个人名。 */
function fillHead(
  selfCard: HTMLElement,
  oppCard: HTMLElement,
  selfName: HTMLElement,
  oppName: HTMLElement,
  selfLabel: string,
  oppLabel: string,
  result: MatchResult,
  selfFaction: Faction,
  oppFaction: Faction,
): void {
  selfName.textContent = selfLabel;
  oppName.textContent = oppLabel;
  const draw = result.winner === null;
  selfCard.classList.toggle('is-winner', result.winner === selfFaction);
  selfCard.classList.toggle('is-loser', !draw && result.winner !== selfFaction);
  oppCard.classList.toggle('is-winner', result.winner === oppFaction);
  oppCard.classList.toggle('is-loser', !draw && result.winner !== oppFaction);
}

/** 填一条对比行：数值可为 null（无对局数据），此时显示占位并让条走中灰。 */
function fillCompareRow(
  row: CompareRow,
  selfText: string,
  oppText: string,
  selfAmount: number | null,
  oppAmount: number | null,
): void {
  row.selfValue.textContent = selfText;
  row.oppValue.textContent = oppText;
  const total = (selfAmount ?? 0) + (oppAmount ?? 0);
  // 双方都是 0 时底色会整条显示成对方色，改用灰底避免误读成“打满”
  row.split.classList.toggle('is-neutral', total <= 0);
  row.selfBar.style.width = barWidth(selfAmount ?? 0, total);
}

/** 伤害行把定点伤害取整后交给通用对比行。 */
function fillDamageRow(row: CompareRow, selfAmount: number | null, oppAmount: number | null): void {
  fillCompareRow(
    row,
    selfAmount === null ? '—' : formatDamageAmount(selfAmount),
    oppAmount === null ? '—' : formatDamageAmount(oppAmount),
    selfAmount,
    oppAmount,
  );
}

/** 主堡血量文案，取整与局内 HUD 一致。 */
function hpText(match: MatchState, faction: Faction): string {
  const hp = Math.ceil(toFloat(match.getCastleHp(faction)));
  const maxHp = Math.ceil(toFloat(match.getCastleMaxHp(faction)));
  return `${hp} / ${maxHp}`;
}

/**
 * 2v2 队员明细表：一行一人，列为 队员 / 血量 / 基地伤害 / 兵种伤害。
 * 己方两行在对方之前，血量为 0 的行置灰，一眼看出谁先阵亡。
 */
function fillMemberTable(
  table: HTMLElement,
  selfTeam: readonly ResultMember[],
  oppTeam: readonly ResultMember[],
  match?: MatchState,
): void {
  const show = Boolean(match && selfTeam.length > 0 && oppTeam.length > 0);
  table.classList.toggle('is-hidden', !show);
  table.replaceChildren();
  if (!show || !match) return;
  table.append(createTableHead());
  for (const member of selfTeam) table.append(createMemberRow(match, member, 'is-self'));
  for (const member of oppTeam) table.append(createMemberRow(match, member, 'is-opp'));
}

/** 明细表表头：列名靠右对齐，与数值列对齐。 */
function createTableHead(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'battle-result-table-row is-head';
  for (const label of ['队员', '血量', '基地', '兵种']) {
    const cell = document.createElement('span');
    if (label === '队员') cell.className = 'battle-result-table-name';
    cell.textContent = label;
    row.append(cell);
  }
  return row;
}

/** 明细表单人一行；血量归零标 is-down 降透明度。 */
function createMemberRow(match: MatchState, member: ResultMember, side: 'is-self' | 'is-opp'): HTMLElement {
  const hp = Math.ceil(toFloat(match.getSlotCastleHp(member.slot)));
  const maxHp = Math.ceil(toFloat(match.getSlotCastleMaxHp(member.slot)));
  const stats = match.getSlotDamageStats(member.slot);
  const row = document.createElement('div');
  row.className = `battle-result-table-row ${side}`;
  if (hp <= 0) row.classList.add('is-down');
  const name = document.createElement('span');
  name.className = 'battle-result-table-name';
  name.textContent = member.name;
  const hpEl = document.createElement('span');
  hpEl.className = 'battle-result-member-hp';
  hpEl.textContent = `${hp} / ${maxHp}`;
  const castle = document.createElement('span');
  castle.className = 'battle-result-member-castle';
  castle.textContent = formatDamageAmount(stats.toCastle);
  const units = document.createElement('span');
  units.className = 'battle-result-member-units';
  units.textContent = formatDamageAmount(stats.toUnits);
  row.append(name, hpEl, castle, units);
  return row;
}

/** 卡片伤害行对应的席位：1v1 一人一席，2v2 同队两人。 */
function damageSlots(
  context: BattleResultContext,
  faction: Faction,
  isSelf: boolean,
  match: MatchState,
): number[] {
  if (match.mode === '2v2') {
    return sideMembers(context, faction, isSelf, match).map((member) => member.slot);
  }
  if (isSelf) return [context.localSlot ?? faction];
  return [context.opponentSlot ?? faction];
}

/** 把若干席的输出加总，给 2v2 卡面合计用。 */
function sumSlotDamage(match: MatchState, slots: readonly number[]): SlotDamageStats {
  let toCastle = 0;
  let toUnits = 0;
  for (const slot of slots) {
    const stats = match.getSlotDamageStats(slot);
    toCastle += stats.toCastle;
    toUnits += stats.toUnits;
  }
  return { toCastle, toUnits };
}

/** 定点伤害转整数，与局内面板同一套取整。 */
function formatDamageAmount(amount: number): string {
  return String(Math.round(toFloat(amount)));
}

/** 占比条；双方都是 0 时条宽为 0，避免空数据看起来像打满。 */
function barWidth(amount: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.max(0, Math.min(100, (amount / total) * 100))}%`;
}

/** 把上下文席位收成一侧名单；缺席位时按当前模式队伍顺序补齐。 */
function sideMembers(
  context: BattleResultContext,
  faction: Faction,
  isSelf: boolean,
  match?: MatchState,
): ResultMember[] {
  if (!match || match.mode !== '2v2') return [];
  const slots = teamSlots(faction, match.mode);
  if (isSelf) {
    const localSlot = context.localSlot ?? slots[0]!;
    const mate = context.teammateSlot ?? slots.find((slot) => slot !== localSlot) ?? null;
    const members: ResultMember[] = [{ name: context.localName, slot: localSlot }];
    if (mate != null) members.push({ name: context.teammateName || '队友', slot: mate });
    return members;
  }
  const first = context.opponentSlot ?? slots[0]!;
  const extra = context.extraOpponentSlot ?? slots.find((slot) => slot !== first) ?? null;
  const members: ResultMember[] = [{ name: context.opponentName, slot: first }];
  if (extra != null) members.push({ name: context.extraOpponentName || '对手', slot: extra });
  return members;
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
