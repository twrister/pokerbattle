import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BALANCE_OPTIONS,
  renderMatchupCsv,
  renderStrengthMarkdown,
  runBalanceAnalysis,
  type BalanceMode,
} from '../../src/index.js';

interface CliOptions {
  mode: BalanceMode;
  seeds: number;
  rounds: number;
  teamSize: number;
  outDir: string;
  seed: number;
}

const DEFAULT_OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'out');

/** 解析 CLI；非法 flag 直接抛错，避免静默忽略导致跑错模式。 */
function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    mode: DEFAULT_BALANCE_OPTIONS.mode,
    seeds: DEFAULT_BALANCE_OPTIONS.seeds,
    rounds: DEFAULT_BALANCE_OPTIONS.rounds,
    teamSize: DEFAULT_BALANCE_OPTIONS.teamSize,
    outDir: DEFAULT_OUT,
    seed: DEFAULT_BALANCE_OPTIONS.seed,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === '--mode' && next) {
      if (next !== 'solo' && next !== 'melee' && next !== 'all') {
        throw new Error(`未知 --mode：${next}（solo | melee | all）`);
      }
      options.mode = next;
      i += 1;
    } else if (arg === '--seeds' && next) {
      options.seeds = readInt(next, '--seeds');
      i += 1;
    } else if (arg === '--rounds' && next) {
      options.rounds = readInt(next, '--rounds');
      i += 1;
    } else if ((arg === '--team-size' || arg === '-k') && next) {
      options.teamSize = readInt(next, '--team-size');
      i += 1;
    } else if (arg === '--out' && next) {
      options.outDir = resolve(next);
      i += 1;
    } else if (arg === '--seed' && next) {
      options.seed = readInt(next, '--seed');
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

/** 正整数校验；种子数/轮数写 0 会让对拆表空洞却看起来像跑过。 */
function readInt(text: string, flag: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} 必须是正整数`);
  return value;
}

function printHelp(): void {
  console.log(`用法: pnpm balance -- [选项]
  --mode solo|melee|all   对比模式，默认 all（独立+混战，报表两列齐全）
  --seeds N               每对独立对拆的种子数，默认 6（再乘双向换边）
  --rounds N              混战轮数，默认 400
  --team-size / -k N      混战每队条目数，默认 3
  --seed N                总随机种子，默认 1
  --out DIR               报表输出目录，默认 tools/balance/out
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runBalanceAnalysis(
    {
      mode: options.mode,
      seeds: options.seeds,
      rounds: options.rounds,
      teamSize: options.teamSize,
      seed: options.seed,
    },
    {
      onProgress: (progress) => {
        const label = progress.phase === 'solo' ? '独立对拆' : '混战';
        if (progress.done % 25 === 0 || progress.done === progress.total) {
          console.log(`  ${label} ${progress.done}/${progress.total}`);
        }
      },
    },
  );

  mkdirSync(options.outDir, { recursive: true });
  const mdPath = resolve(options.outDir, 'strength.md');
  const csvPath = resolve(options.outDir, 'matchup.csv');
  writeFileSync(
    mdPath,
    renderStrengthMarkdown({
      entries: report.entries,
      soloRatings: report.soloRatings,
      meleeRatings: report.meleeRatings,
      pairs: report.pairs,
      soloViolations: report.soloViolations,
      meleeViolations: report.meleeViolations,
      seeds: report.seeds,
      meleeRounds: report.meleeRounds,
    }),
    'utf8',
  );
  writeFileSync(csvPath, renderMatchupCsv(report.entries, report.pairs), 'utf8');
  console.log(`已写入 ${mdPath}`);
  console.log(`已写入 ${csvPath}`);

  const violations = [...report.soloViolations, ...report.meleeViolations];
  if (violations.length > 0) {
    console.error(`单调性违例 ${violations.length} 条，详见 strength.md 顶部。`);
    process.exitCode = 1;
  } else {
    console.log('单调性校验通过。');
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
