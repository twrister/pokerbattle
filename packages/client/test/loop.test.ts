import { describe, expect, it } from 'vitest';
import { Faction, fromInt, spawnCommand } from '@pb/sim';
import { SimLoop } from '../src/loop.js';

describe('SimLoop 自动指令来源', () => {
  it('在每个逻辑帧消费队列前收集指令，并支持注销', () => {
    const loop = new SimLoop(1);
    const remove = loop.addCommandSource(() =>
      spawnCommand(Faction.Red, 'melee_grunt', fromInt(4), fromInt(4)));

    loop.stepOnce();
    expect(loop.world.units).toHaveLength(1);

    remove();
    loop.stepOnce();
    expect(loop.world.units).toHaveLength(1);
  });
});
