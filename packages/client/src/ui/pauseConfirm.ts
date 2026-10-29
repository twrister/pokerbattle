import type { VersusExitConfirmHandle } from './versusExitConfirm.js';

/** 暂停弹窗标题：用「暂停」而不是「退出」，让玩家先意识到对局被冻住了。 */
const TITLE = '暂停';
const DETAIL = '退出后本局进度不会保留，确定要离开吗？';
const ENDLESS_DETAIL = '中途退出将判定为挑战失败，本波成绩不保留。确定要离开吗？';
const CONFIRM_LABEL = '退出对局';

export interface PauseConfirmOptions {
  /** 复用的退出确认弹窗；单机与联机共用一个节点，文案由这里决定。 */
  dialog: VersusExitConfirmHandle;
  /** 对局是否已有结论：结算已弹出时返回只是正常离场，不必再拦一次。 */
  isResolved: () => boolean;
  /** 读取当前暂停状态；用函数取值，弹窗期间状态仍由对局自己持有。 */
  isPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  /** 当前是否是无限防守挑战，决定文案与「退出即失败」的记账。 */
  isEndless: () => boolean;
  /** 无限防守主动退出时的失败记账。 */
  onEndlessAbandon: () => void;
  /** 确认离开后真正切屏。 */
  onExit: () => void;
}

export interface PauseConfirmHandle {
  /** 返回按钮入口：已结算直接离开，否则暂停并弹确认框。 */
  requestExit: () => void;
}

/**
 * 单机返回的「暂停 + 二次确认」逻辑。
 *
 * 单机模拟只在本机推进，所以可以先冻结再问；取消时恢复到弹窗前的状态
 * （调试面板可能本来就暂停着，不能一律恢复成「继续」）。
 * 无限防守里主动退出等同挑战失败，必须先结账再离开。
 */
export function createPauseConfirm(options: PauseConfirmOptions): PauseConfirmHandle {
  const requestExit = (): void => {
    if (options.isResolved()) {
      options.onExit();
      return;
    }
    // 弹窗开着时再点返回不要重记暂停快照，否则取消后会一直停在暂停态
    if (options.dialog.isOpen()) return;
    const wasPaused = options.isPaused();
    options.setPaused(true);
    const endless = options.isEndless();
    options.dialog.show(
      () => {
        if (endless) options.onEndlessAbandon();
        options.onExit();
      },
      {
        title: TITLE,
        detail: endless ? ENDLESS_DETAIL : DETAIL,
        confirmLabel: CONFIRM_LABEL,
        onCancel: () => options.setPaused(wasPaused),
      },
    );
  };

  return { requestExit };
}
