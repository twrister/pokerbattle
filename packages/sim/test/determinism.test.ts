import { describe, expect, it } from 'vitest';
import { MATCH_SCRIPT, runScriptedMatch } from './scriptedMatch.js';
import { World } from '../src/world.js';

const TICKS = 900;

describe('确定性', () => {
  it('同种子同指令跑两遍，每一 tick 的世界指纹都相同', () => {
    const first = runScriptedMatch(1234, TICKS);
    const second = runScriptedMatch(1234, TICKS);
    expect(second).toEqual(first);
  });

  it('分段执行与一次性执行结果一致（验证 step 无隐藏的跨帧状态）', () => {
    const reference = runScriptedMatch(77, 300);

    const world = new World(77);
    const chunked: number[] = [];
    for (let tick = 1; tick <= 300; tick++) {
      world.step(MATCH_SCRIPT.get(tick) ?? []);
      chunked.push(world.hash());
      // 中途反复取快照 / 算 hash 不应该影响模拟
      world.hash();
    }
    expect(chunked).toEqual(reference);
  });

  it('clear 之后重跑等价于全新的 World', () => {
    const world = new World(9);
    for (let tick = 1; tick <= 120; tick++) world.step(MATCH_SCRIPT.get(tick) ?? []);
    world.clear();

    const replay: number[] = [];
    for (let tick = 1; tick <= 120; tick++) {
      world.step(MATCH_SCRIPT.get(tick) ?? []);
      replay.push(world.hash());
    }
    expect(replay).toEqual(runScriptedMatch(9, 120));
  });

  it('不同种子的脚本仍然确定（种子当前不影响结果，但接口要稳定）', () => {
    expect(runScriptedMatch(5, 200)).toEqual(runScriptedMatch(5, 200));
  });
});
