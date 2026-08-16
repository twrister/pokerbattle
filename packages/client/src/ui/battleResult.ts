import {
  Faction,
  opposingFaction,
  teamSlots,
  toFloat,
  type MatchResult,
  type MatchState,
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
  const selfMembers = requiredElement<HTMLElement>('#battle-result-self-members');
  const oppMembers = requiredElement<HTMLElement>('#battle-result-opp-members');
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
      fillSide(
        selfCard,
        selfName,
        selfHp,
        selfBar,
        is2v2 ? '合计' : context.localName,
        playerFaction,
        result,
        match,
      );
      fillSide(
        oppCard,
        oppName,
        oppHp,
        oppBar,
        is2v2 ? '合计' : context.opponentName,
        opposingFaction(playerFaction),
        result,
        match,
      );
      fillMembers(selfMembers, sideMembers(context, playerFaction, true, match), match);
      fillMembers(oppMembers, sideMembers(context, opposingFaction(playerFaction), false, match), match);
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
  return result.winner === null ? '时间结束，双方基地血量相同。' : '时间结束，基地血量更高的一方获胜。';
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

/** 2v2 下列出该侧每座主堡残血；1v1 只有一座，不重复占行。 */
function fillMembers(list: HTMLElement, members: readonly ResultMember[], match?: MatchState): void {
  const show = Boolean(match && members.length > 1);
  list.classList.toggle('is-hidden', !show);
  list.replaceChildren();
  if (!show || !match) return;
  for (const member of members) {
    const hp = Math.ceil(toFloat(match.getSlotCastleHp(member.slot)));
    const maxHp = Math.ceil(toFloat(match.getSlotCastleMaxHp(member.slot)));
    const row = document.createElement('li');
    if (hp <= 0) row.classList.add('is-down');
    const nameEl = document.createElement('span');
    nameEl.className = 'battle-result-member-name';
    nameEl.textContent = member.name;
    const hpEl = document.createElement('span');
    hpEl.className = 'battle-result-member-hp';
    hpEl.textContent = `${hp} / ${maxHp}`;
    row.append(nameEl, hpEl);
    list.append(row);
  }
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
