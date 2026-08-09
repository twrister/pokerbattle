import { describe, expect, it } from 'vitest';
import {
  Faction,
  MatchState,
  fromFloat,
  playFormationCommand,
  type Command,
} from '@pb/sim';

const TICKS = 300;

/**
 * 不起网络：两个 MatchState 喂同一串帧，断言逐 tick hash 一致。
 * 这是防回归的主力（确定性帧同步）。
 */
describe('MatchState 锁步确定性', () => {
  it('同种子同指令跑 300 tick，双方 hash 逐帧相等', () => {
    const script = buildScript();
    const hashesA = runMatch(20260809, script);
    const hashesB = runMatch(20260809, script);
    expect(hashesB).toEqual(hashesA);
  });

  it('空帧推进也保持两端一致', () => {
    const empty = new Map<number, Command[]>();
    const a = runMatch(42, empty);
    const b = runMatch(42, empty);
    expect(b).toEqual(a);
    expect(a).toHaveLength(TICKS);
  });
});

/** 构造含若干出牌的脚本；非法/手牌不足的指令会被 MatchState 静默丢弃，两端仍应对齐。 */
function buildScript(): Map<number, Command[]> {
  const script = new Map<number, Command[]>();
  // tick 5：双方各尝试打一张（具体阵型/牌是否合法取决于发牌，合法则落地）
  script.set(5, [
    playFormationCommand(Faction.Blue, 'single_grunt', ['A-spades'], fromFloat(9), fromFloat(8)),
    playFormationCommand(Faction.Red, 'single_grunt', ['A-hearts'], fromFloat(9), fromFloat(24)),
  ]);
  script.set(40, [
    playFormationCommand(Faction.Blue, 'pair_grunts', ['2-spades', '2-hearts'], fromFloat(9), fromFloat(6)),
  ]);
  script.set(100, [
    playFormationCommand(Faction.Red, 'single_grunt', ['K-clubs'], fromFloat(10), fromFloat(26)),
  ]);
  return script;
}

function runMatch(seed: number, script: Map<number, Command[]>): number[] {
  const match = new MatchState(seed);
  const hashes: number[] = [];
  for (let tick = 1; tick <= TICKS; tick += 1) {
    match.step(script.get(tick) ?? []);
    hashes.push(match.hash());
  }
  return hashes;
}
