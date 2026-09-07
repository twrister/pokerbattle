import {
  Faction,
  opposingFaction,
  teamSlots,
  toFloat,
  type MatchResult,
  type MatchState,
  type SlotDamageStats,
} from '@pb/sim';

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

/** 一侧卡片上的基地/兵种数值与占比条。 */
interface DamageBlock {
  castleValue: HTMLElement;
  unitsValue: HTMLElement;
  castleBar: HTMLElement;
  unitsBar: HTMLElement;
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
  const selfHp = requiredElement<HTMLElement>('#battle-result-self-hp');
  const oppHp = requiredElement<HTMLElement>('#battle-result-opp-hp');
  const selfBar = requiredElement<HTMLElement>('#battle-result-self-bar');
  const oppBar = requiredElement<HTMLElement>('#battle-result-opp-bar');
  const selfDamageCard = requiredElement<HTMLElement>('#battle-result-self-damage-card');
  const oppDamageCard = requiredElement<HTMLElement>('#battle-result-opp-damage-card');
  const selfDamageName = requiredElement<HTMLElement>('#battle-result-self-damage-name');
  const oppDamageName = requiredElement<HTMLElement>('#battle-result-opp-damage-name');
  const selfDamage: DamageBlock = {
    castleValue: requiredElement('#battle-result-self-castle-value'),
    unitsValue: requiredElement('#battle-result-self-units-value'),
    castleBar: requiredElement('#battle-result-self-castle-bar'),
    unitsBar: requiredElement('#battle-result-self-units-bar'),
  };
  const oppDamage: DamageBlock = {
    castleValue: requiredElement('#battle-result-opp-castle-value'),
    unitsValue: requiredElement('#battle-result-opp-units-value'),
    castleBar: requiredElement('#battle-result-opp-castle-bar'),
    unitsBar: requiredElement('#battle-result-opp-units-bar'),
  };
  const selfMembers = requiredElement<HTMLElement>('#battle-result-self-members');
  const oppMembers = requiredElement<HTMLElement>('#battle-result-opp-members');
  const selfDamageMembers = requiredElement<HTMLElement>('#battle-result-self-damage-members');
  const oppDamageMembers = requiredElement<HTMLElement>('#battle-result-opp-damage-members');
  const compareRoot = requiredElement<HTMLElement>('#battle-result-compare');
  const compareSelf = requiredElement<HTMLElement>('#battle-result-compare-self');
  const compareOpp = requiredElement<HTMLElement>('#battle-result-compare-opp');
  const compareBar = requiredElement<HTMLElement>('#battle-result-compare-bar');
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
      const is2v2 = match?.mode === '2v2';
      title.textContent = outcome;
      root.dataset.outcome = outcome;
      root.classList.toggle('is-2v2', Boolean(is2v2));
      detail.textContent = resultDetail(result);
      const selfLabel = is2v2 ? '合计' : context.localName;
      const oppLabel = is2v2 ? '合计' : context.opponentName;
      fillSide(selfCard, selfName, selfHp, selfBar, selfLabel, playerFaction, result, match);
      fillSide(oppCard, oppName, oppHp, oppBar, oppLabel, opposingFaction(playerFaction), result, match);
      fillDamageSide(selfDamageCard, selfDamageName, selfLabel, playerFaction, result);
      fillDamageSide(oppDamageCard, oppDamageName, oppLabel, opposingFaction(playerFaction), result);
      const selfStats = match
        ? sumSlotDamage(match, damageSlots(context, playerFaction, true, match))
        : null;
      const oppStats = match
        ? sumSlotDamage(match, damageSlots(context, opposingFaction(playerFaction), false, match))
        : null;
      fillDamageBlock(selfDamage, selfStats, oppStats);
      fillDamageBlock(oppDamage, oppStats, selfStats);
      const selfTeam = sideMembers(context, playerFaction, true, match);
      const oppTeam = sideMembers(context, opposingFaction(playerFaction), false, match);
      fillHpMembers(selfMembers, selfTeam, match);
      fillHpMembers(oppMembers, oppTeam, match);
      fillDamageMembers(selfDamageMembers, selfTeam, match);
      fillDamageMembers(oppDamageMembers, oppTeam, match);
      fillCompare(compareRoot, compareSelf, compareOpp, compareBar, playerFaction, Boolean(is2v2), match);
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

/** 按本地视角填一侧名字、队伍残血和胜负高亮。 */
function fillSide(
  card: HTMLElement,
  nameEl: HTMLElement,
  hpEl: HTMLElement,
  barEl: HTMLElement,
  name: string,
  faction: Faction,
  result: MatchResult,
  match?: MatchState,
): void {
  nameEl.textContent = name;
  const draw = result.winner === null;
  const won = result.winner === faction;
  card.classList.toggle('is-winner', won);
  card.classList.toggle('is-loser', !draw && !won);
  if (!match) {
    hpEl.textContent = '—';
    barEl.style.width = '0%';
    return;
  }
  const hp = toFloat(match.getCastleHp(faction));
  const maxHp = toFloat(match.getCastleMaxHp(faction));
  hpEl.textContent = `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`;
  barEl.style.width = `${maxHp > 0 ? Math.max(0, (hp / maxHp) * 100) : 0}%`;
}

/** 伤害板块只写名字和胜负高亮，残血走上面那一块。 */
function fillDamageSide(
  card: HTMLElement,
  nameEl: HTMLElement,
  name: string,
  faction: Faction,
  result: MatchResult,
): void {
  nameEl.textContent = name;
  const draw = result.winner === null;
  const won = result.winner === faction;
  card.classList.toggle('is-winner', won);
  card.classList.toggle('is-loser', !draw && !won);
}

/** 2v2 残血板块只列每座主堡血量；1v1 只有一座，不重复占行。 */
function fillHpMembers(list: HTMLElement, members: readonly ResultMember[], match?: MatchState): void {
  const show = Boolean(match && members.length > 1);
  list.classList.toggle('is-hidden', !show);
  list.replaceChildren();
  if (!show || !match) return;
  for (const member of members) {
    const hp = Math.ceil(toFloat(match.getSlotCastleHp(member.slot)));
    const maxHp = Math.ceil(toFloat(match.getSlotCastleMaxHp(member.slot)));
    const row = document.createElement('li');
    if (hp <= 0) row.classList.add('is-down');
    const head = document.createElement('div');
    head.className = 'battle-result-member-head';
    const nameEl = document.createElement('span');
    nameEl.className = 'battle-result-member-name';
    nameEl.textContent = member.name;
    const hpEl = document.createElement('span');
    hpEl.className = 'battle-result-member-hp';
    hpEl.textContent = `${hp} / ${maxHp}`;
    head.append(nameEl, hpEl);
    row.append(head);
    list.append(row);
  }
}

/** 2v2 伤害板块按人拆输出条；1v1 已有卡面合计，不再占行。 */
function fillDamageMembers(list: HTMLElement, members: readonly ResultMember[], match?: MatchState): void {
  const show = Boolean(match && members.length > 1);
  list.classList.toggle('is-hidden', !show);
  list.replaceChildren();
  if (!show || !match) return;
  const teamStats = sumSlotDamage(match, members.map((member) => member.slot));
  for (const member of members) {
    const row = document.createElement('li');
    const nameEl = document.createElement('span');
    nameEl.className = 'battle-result-member-name';
    nameEl.textContent = member.name;
    row.append(nameEl, createMemberDamage(match.getSlotDamageStats(member.slot), teamStats));
    list.append(row);
  }
}

/** 成员行两行输出条：数值 + 队内占比，和局内伤害面板同一套算法。 */
function createMemberDamage(stats: SlotDamageStats, teamStats: SlotDamageStats): HTMLElement {
  const block = document.createElement('div');
  block.className = 'battle-result-member-damage';
  block.append(
    createDamageRow('基地', 'castle', stats.toCastle, teamStats.toCastle),
    createDamageRow('兵种', 'units', stats.toUnits, teamStats.toUnits),
  );
  return block;
}

/** 拼一行「标签 + 数字 + 占比条」，供成员列表复用。 */
function createDamageRow(label: string, kind: 'castle' | 'units', amount: number, total: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'battle-result-member-damage-row';
  const head = document.createElement('div');
  head.className = 'battle-result-damage-row-head';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.className = `battle-result-damage-value battle-result-member-${kind}`;
  valueEl.textContent = formatDamageAmount(amount);
  head.append(labelEl, valueEl);
  const track = document.createElement('div');
  track.className = 'battle-hp-track';
  const bar = document.createElement('div');
  bar.className = `battle-hp-bar battle-result-member-${kind}-bar`;
  bar.style.width = barWidth(amount, total);
  track.append(bar);
  row.append(head, track);
  return row;
}

/** 卡面写本侧数字，条宽按双方合计占比；无 match 时占位。 */
function fillDamageBlock(block: DamageBlock, stats: SlotDamageStats | null, other: SlotDamageStats | null): void {
  if (!stats || !other) {
    block.castleValue.textContent = '—';
    block.unitsValue.textContent = '—';
    block.castleBar.style.width = '0%';
    block.unitsBar.style.width = '0%';
    return;
  }
  block.castleValue.textContent = formatDamageAmount(stats.toCastle);
  block.unitsValue.textContent = formatDamageAmount(stats.toUnits);
  block.castleBar.style.width = barWidth(stats.toCastle, stats.toCastle + other.toCastle);
  block.unitsBar.style.width = barWidth(stats.toUnits, stats.toUnits + other.toUnits);
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

/** 2v2 在两队卡片下再画一条总血量对比条，一眼看出哪边更多。 */
function fillCompare(
  root: HTMLElement,
  selfEl: HTMLElement,
  oppEl: HTMLElement,
  barEl: HTMLElement,
  playerFaction: Faction,
  visible: boolean,
  match?: MatchState,
): void {
  root.classList.toggle('is-hidden', !visible || !match);
  if (!visible || !match) return;
  const selfHp = toFloat(match.getCastleHp(playerFaction));
  const oppHp = toFloat(match.getCastleHp(opposingFaction(playerFaction)));
  selfEl.textContent = `己方 ${Math.ceil(selfHp)}`;
  oppEl.textContent = `对方 ${Math.ceil(oppHp)}`;
  const total = selfHp + oppHp;
  barEl.style.width = `${total > 0 ? (selfHp / total) * 100 : 50}%`;
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
