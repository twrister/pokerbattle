import { describe, expect, it, vi } from 'vitest';
import { createScreenController } from '../src/ui/screenController.js';

describe('页面状态管理', () => {
  it('默认不启动页面，并按顺序进入大厅、单机与沙盒', () => {
    const leaveMenu = vi.fn();
    const leaveSolo = vi.fn();
    const leaveSandbox = vi.fn();
    const enterMenu = vi.fn(() => leaveMenu);
    const enterSolo = vi.fn(() => leaveSolo);
    const enterSandbox = vi.fn(() => leaveSandbox);
    const screens = createScreenController({
      menu: enterMenu,
      solo: enterSolo,
      sandbox: enterSandbox,
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

    screens.show('menu');
    expect(leaveSandbox).toHaveBeenCalledOnce();
    expect(enterMenu).toHaveBeenCalledTimes(2);
  });

  it('重复进入当前页面不会重复启动，销毁时会释放当前页面', () => {
    const leaveMenu = vi.fn();
    const enterMenu = vi.fn(() => leaveMenu);
    const screens = createScreenController({
      menu: enterMenu,
      solo: () => vi.fn(),
      sandbox: () => vi.fn(),
    });

    screens.show('menu');
    screens.show('menu');
    expect(enterMenu).toHaveBeenCalledOnce();

    screens.dispose();
    expect(leaveMenu).toHaveBeenCalledOnce();
    expect(screens.current).toBeNull();
  });
});
