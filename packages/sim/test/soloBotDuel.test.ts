import { describe, expect, it } from 'vitest';
import { Faction } from '../src/entity/unit.js';
import { MatchState } from '../src/match/matchState.js';
import { SoloBotController, type SoloDifficulty } from '../src/match/soloBot.js';

/** 双方各由一个人机控制跑完整局，返回胜方（平局为 null）。 */
function playDuel(seed: number, blue: SoloDifficulty, red: SoloDifficulty): Faction | null {
  const match = new MatchState(seed);
  match.seedStartingCastles();
  const bots = [
    new SoloBotController(blue, seed, Faction.Blue),
    new SoloBotController(red, seed + 1, Faction.Red),
  ];
  while (!match.result) {
    const commands = bots.map((bot) => bot.decide(match)).filter((command) => command !== null);
    match.step(commands);
  }
  return match.result.winner;
}

describe('SoloBot 困难档对简单档', () => {
  it('交换先后手各打若干局，困难档胜场多于简单档', () => {
    const seeds = [101, 202, 303, 404];
    let hardWins = 0;
    let easyWins = 0;
    for (const seed of seeds) {
      const asBlue = playDuel(seed, 'hard', 'easy');
      if (asBlue === Faction.Blue) hardWins += 1;
      else if (asBlue === Faction.Red) easyWins += 1;
      const asRed = playDuel(seed, 'easy', 'hard');
      if (asRed === Faction.Red) hardWins += 1;
      else if (asRed === Faction.Blue) easyWins += 1;
    }
    expect(hardWins, `困难 ${hardWins} : 简单 ${easyWins}`).toBeGreaterThan(easyWins);
  }, 120_000);
});
