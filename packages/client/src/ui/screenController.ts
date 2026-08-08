export type AppScreen = 'menu' | 'deck-config' | 'sandbox' | 'solo';
export type EnterScreen = () => () => void;

export interface ScreenController {
  readonly current: AppScreen | null;
  show(screen: AppScreen): void;
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
    show(screen) {
      if (screen === current) return;
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
