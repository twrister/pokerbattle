export type AppScreen =
  | 'menu'
  | 'online'
  | 'room'
  | 'deck-config'
  | 'hand-odds'
  | 'codex'
  | 'leaderboard'
  | 'replay-list'
  | 'replay'
  | 'unit-stats'
  | 'scene-config'
  | 'sandbox'
  | 'solo'
  | 'versus'
  | 'spectate';
export type EnterScreen = () => () => void;

export interface ShowScreenOptions {
  /** 已在目标页时仍先 leave 再 enter；同房间再开局必须拆掉上一局 versus session。 */
  remount?: boolean;
}

export interface ScreenController {
  readonly current: AppScreen | null;
  show(screen: AppScreen, options?: ShowScreenOptions): void;
  dispose(): void;
}

/**
 * 串行管理页面进入与退出，确保切屏前总会释放上一页资源，
 * 同时忽略重复进入当前页面，避免创建双份渲染循环。
 */
export function createScreenController(entries: Record<AppScreen, EnterScreen>): ScreenController {
  let current: AppScreen | null = null;
  let leaveCurrent: (() => void) | null = null;

  return {
    get current() {
      return current;
    },
    show(screen, options) {
      if (screen === current && !options?.remount) return;
      leaveCurrent?.();
      current = screen;
      leaveCurrent = entries[screen]();
    },
    dispose() {
      leaveCurrent?.();
      leaveCurrent = null;
      current = null;
    },
  };
}
