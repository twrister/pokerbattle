import { describe, expect, it } from 'vitest';
import {
  CASTLE_PROTECT_HP,
  CommandKind,
  Faction,
  MatchState,
  claimCastlePackCommand,
  fromFloat,
  playFormationCommand,
} from '@pb/sim';
import { validateSeatCommand } from '../src/validate.js';

describe('validateSeatCommand', () => {
  it('本席位可领取待领取的保护卡包', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    const castle = match.world.units.find(
      (unit) => unit.faction === Faction.Blue && unit.typeId === 'building_base',
    );
    if (!castle) throw new Error('主堡未生成');
    castle.hp = fromFloat(CASTLE_PROTECT_HP - 1);
    match.step();

    expect(validateSeatCommand(match, Faction.Blue, claimCastlePackCommand(Faction.Blue))).toBe(true);
    expect(validateSeatCommand(match, Faction.Red, claimCastlePackCommand(Faction.Blue))).toBe(false);
    expect(validateSeatCommand(match, Faction.Red, claimCastlePackCommand(Faction.Red))).toBe(false);
  });

  it('仍拒绝裸 Spawn，并要求出牌通过 MatchState 校验', () => {
    const match = new MatchState(1);
    match.seedStartingCastles();
    expect(
      validateSeatCommand(match, Faction.Blue, {
        kind: CommandKind.Spawn,
        faction: Faction.Blue,
        typeId: 'melee_grunt',
        x: fromFloat(9),
        y: fromFloat(6),
      }),
    ).toBe(false);
    expect(
      validateSeatCommand(
        match,
        Faction.Blue,
        playFormationCommand(Faction.Blue, 'single_grunt', ['missing'], fromFloat(9), fromFloat(6)),
      ),
    ).toBe(false);
  });
});
