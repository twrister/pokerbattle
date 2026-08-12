import { describe, expect, it, vi } from 'vitest';
import { createScreenController } from '../src/ui/screenController.js';

describe('页面状态管理', () => {
  it('默认不启动页面，并按顺序进入大厅、单机与沙盒', () => {
    const leaveMenu = vi.fn();
    const leaveSolo = vi.fn();
    const leaveSandbox = vi.fn();
    const leaveDeckConfig = vi.fn();
    const leaveHandOdds = vi.fn();
    const leaveCodex = vi.fn();
    const leaveUnitStats = vi.fn();
    const leaveVersus = vi.fn();
    const enterMenu = vi.fn(() => leaveMenu);
    const enterSolo = vi.fn(() => leaveSolo);
    const enterSandbox = vi.fn(() => leaveSandbox);
    const enterDeckConfig = vi.fn(() => leaveDeckConfig);
    const enterHandOdds = vi.fn(() => leaveHandOdds);
    const enterCodex = vi.fn(() => leaveCodex);
    const enterUnitStats = vi.fn(() => leaveUnitStats);
    const enterVersus = vi.fn(() => leaveVersus);
    const screens = createScreenController({
      menu: enterMenu,
      solo: enterSolo,
      sandbox: enterSandbox,
      'deck-config': enterDeckConfig,
      'hand-odds': enterHandOdds,
      codex: enterCodex,
      'unit-stats': enterUnitStats,
      versus: enterVersus,
    });

    expect(screens.current).toBeNull();

    screens.show('menu');
    expect(screens.current).toBe('menu');
    expect(enterMenu).toHaveBeenCalledOnce();

    screens.show('solo');
    expect(leaveMenu).toHaveBeenCalledOnce();
    expect(enterSolo).toHaveBeenCalledOnce();

    screens.show('sandbox');
    expect(leaveSolo).toHaveBeenCalledOnce();
    expect(enterSandbox).toHaveBeenCalledOnce();

    screens.show('deck-config');
    expect(leaveSandbox).toHaveBeenCalledOnce();
    expect(enterDeckConfig).toHaveBeenCalledOnce();

    screens.show('menu');
    expect(leaveDeckConfig).toHaveBeenCalledOnce();
    expect(enterMenu).toHaveBeenCalledTimes(2);

    screens.show('codex');
    expect(leaveMenu).toHaveBeenCalledTimes(2);
    expect(enterCodex).toHaveBeenCalledOnce();
    screens.show('menu');
    expect(leaveCodex).toHaveBeenCalledOnce();
  });

  it('重复进入当前页面不会重复启动，销毁时会释放当前页面', () => {
    const leaveMenu = vi.fn();
    const enterMenu = vi.fn(() => leaveMenu);
    const screens = createScreenController({
      menu: enterMenu,
      solo: () => vi.fn(),
      sandbox: () => vi.fn(),
      'deck-config': () => vi.fn(),
      'hand-odds': () => vi.fn(),
      codex: () => vi.fn(),
      'unit-stats': () => vi.fn(),
      versus: () => vi.fn(),
    });

    screens.show('menu');
    screens.show('menu');
    expect(enterMenu).toHaveBeenCalledOnce();

    screens.dispose();
    expect(leaveMenu).toHaveBeenCalledOnce();
    expect(screens.current).toBeNull();
  });
});
