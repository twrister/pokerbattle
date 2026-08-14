import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../src/config/arena.js';
import { MAX_UNIT_RADIUS } from '../src/config/units.js';
import { fromFloat, mul } from '../src/math/fixed.js';
import { SpatialHash } from '../src/spatial/hash.js';

interface Sample {
  x: number;
  y: number;
  r: number;
}

/** 规范化无序配对，便于集合比对。 */
function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** 旧路径：每单位 query 邻域后只保留 j > i 且圆重叠的配对。 */
function overlappingPairsByQuery(hash: SpatialHash, samples: readonly Sample[]): Set<string> {
  const neighbors: number[] = [];
  const pairs = new Set<string>();
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!;
    hash.query(a.x, a.y, a.r + MAX_UNIT_RADIUS, neighbors);
    for (let k = 0; k < neighbors.length; k++) {
      const j = neighbors[k]!;
      if (j <= i) continue;
      if (circlesOverlap(a, samples[j]!)) pairs.add(pairKey(i, j));
    }
  }
  return pairs;
}

/** 新路径：格子唯一配对后再做精确圆重叠。 */
function overlappingPairsByCells(hash: SpatialHash, samples: readonly Sample[]): Set<string> {
  const pairs = new Set<string>();
  hash.forEachCandidatePair((i, j) => {
    if (circlesOverlap(samples[i]!, samples[j]!)) pairs.add(pairKey(i, j));
  });
  return pairs;
}

function circlesOverlap(a: Sample, b: Sample): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minDist = a.r + b.r;
  return mul(dx, dx) + mul(dy, dy) < mul(minDist, minDist);
}

function insertAll(hash: SpatialHash, samples: readonly Sample[]): void {
  hash.clear();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    hash.insert(i, s.x, s.y);
  }
}

describe('SpatialHash 候选配对', () => {
  it('重叠配对集合等于旧 query + j>i + 距离判定', () => {
    const hash = new SpatialHash(ARENA_WIDTH, ARENA_HEIGHT, MAX_UNIT_RADIUS * 2);
    const r = fromFloat(0.5);
    const cell = MAX_UNIT_RADIUS * 2;
    const samples: Sample[] = [
      // 同格重叠
      { x: fromFloat(4), y: fromFloat(8), r },
      { x: fromFloat(4.2), y: fromFloat(8), r },
      // 右侧邻格、刚好重叠
      { x: fromFloat(4) + cell, y: fromFloat(8), r },
      // 下方邻格、不重叠
      { x: fromFloat(4), y: fromFloat(8) + cell, r },
      // 右下对角、重叠
      { x: fromFloat(4) + cell - fromFloat(0.3), y: fromFloat(8) + cell - fromFloat(0.3), r },
      // 左下邻格（由对方格子的半邻域覆盖）
      { x: fromFloat(4) - cell + fromFloat(0.4), y: fromFloat(8) + cell - fromFloat(0.4), r },
      // 远处，不应进重叠集合
      { x: fromFloat(16), y: fromFloat(28), r },
      { x: fromFloat(16.1), y: fromFloat(28), r },
    ];

    insertAll(hash, samples);
    expect(overlappingPairsByCells(hash, samples)).toEqual(overlappingPairsByQuery(hash, samples));
  });

  it('堆叠与散开混排时也不漏对、不重复', () => {
    const hash = new SpatialHash(ARENA_WIDTH, ARENA_HEIGHT, MAX_UNIT_RADIUS * 2);
    const r = fromFloat(0.5);
    const samples: Sample[] = [];
    for (let i = 0; i < 8; i++) {
      samples.push({ x: fromFloat(9 + i * 0.05), y: fromFloat(16), r });
    }
    for (let i = 0; i < 6; i++) {
      samples.push({ x: fromFloat(3 + i * 2.5), y: fromFloat(6 + (i % 2) * 3), r });
    }

    insertAll(hash, samples);

    const byCells = overlappingPairsByCells(hash, samples);
    const byQuery = overlappingPairsByQuery(hash, samples);
    expect(byCells).toEqual(byQuery);

    const seen: string[] = [];
    hash.forEachCandidatePair((i, j) => {
      seen.push(pairKey(i, j));
    });
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('clear 后 query 不再返回上一轮插入的值', () => {
    const hash = new SpatialHash(ARENA_WIDTH, ARENA_HEIGHT, MAX_UNIT_RADIUS * 2);
    hash.insert(0, fromFloat(4), fromFloat(8));
    hash.insert(1, fromFloat(4.2), fromFloat(8));
    hash.clear();
    const out: number[] = [];
    hash.query(fromFloat(4), fromFloat(8), MAX_UNIT_RADIUS * 2, out);
    expect(out).toEqual([]);
    const pairs: Array<[number, number]> = [];
    hash.forEachCandidatePair((a, b) => pairs.push([a, b]));
    expect(pairs).toEqual([]);
  });
});
