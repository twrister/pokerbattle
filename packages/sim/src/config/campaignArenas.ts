import type { ArenaCameraDraft, ArenaColorsDraft, ArenaConfigDraft } from './arenaConfig.js';

/** 战役命名地图 id：海岛、丛林、要塞。 */
export type CampaignArenaId = 'island' | 'jungle' | 'fortress';

/** 战役地图预设：在 1v1 默认图基础上只写需要改的字段。 */
export interface CampaignArenaPreset
  extends Partial<Omit<ArenaConfigDraft, 'camera' | 'colors'>> {
  /** 中文名，选关页与开场播报展示。 */
  name: string;
  camera?: Partial<ArenaCameraDraft>;
  colors?: Partial<ArenaColorsDraft>;
}

/**
 * 三张战役地图。全场 18×32，河道 y∈[15,17)，蓝方主堡占 x∈[7,11)、y∈[0,4)，
 * 红方主堡对称在 y∈[28,32)；障碍都避开这两块与桥头。
 */
export const CAMPAIGN_ARENA_PRESETS: Readonly<Record<CampaignArenaId, CampaignArenaPreset>> = {
  // 海岛：只有贴边两座窄桥，河两岸中间各一片水潭，正面推进必须绕边
  island: {
    name: '海岛',
    bridges: [
      { minX: 1, maxX: 3 },
      { minX: 15, maxX: 17 },
    ],
    bridge3Enabled: false,
    obstacles: [
      { kind: 'water', minX: 6, maxX: 12, minY: 12, maxY: 15 },
      { kind: 'water', minX: 6, maxX: 12, minY: 17, maxY: 20 },
    ],
    colors: {
      background: '#bfe3e0',
      ground: '#efd9a6',
      grid: '#e3c98f',
      river: '#3fb3c9',
      bridge: '#b97a4e',
      border: '#c98a5e',
    },
  },
  // 丛林：常规两桥，两边半场各散落四块岩石，把直线冲锋切成几条窄道
  jungle: {
    name: '丛林',
    bridges: [
      { minX: 3, maxX: 5 },
      { minX: 13, maxX: 15 },
    ],
    bridge3Enabled: false,
    obstacles: [
      { kind: 'rock', minX: 6, maxX: 8, minY: 10, maxY: 12 },
      { kind: 'rock', minX: 10, maxX: 12, minY: 10, maxY: 12 },
      { kind: 'rock', minX: 2, maxX: 4, minY: 6, maxY: 7 },
      { kind: 'rock', minX: 14, maxX: 16, minY: 6, maxY: 7 },
      { kind: 'rock', minX: 6, maxX: 8, minY: 20, maxY: 22 },
      { kind: 'rock', minX: 10, maxX: 12, minY: 20, maxY: 22 },
      { kind: 'rock', minX: 2, maxX: 4, minY: 25, maxY: 26 },
      { kind: 'rock', minX: 14, maxX: 16, minY: 25, maxY: 26 },
    ],
    colors: {
      background: '#b5cf8f',
      ground: '#b7d996',
      grid: '#a5cc83',
      river: '#4fb0a8',
      bridge: '#9b6a42',
      border: '#7a8c52',
    },
  },
  // 要塞：敌方半场一道城墙，只在正中留一个城门缺口
  fortress: {
    name: '要塞',
    bridges: [
      { minX: 3, maxX: 5 },
      { minX: 13, maxX: 15 },
    ],
    bridge3Enabled: false,
    obstacles: [
      { kind: 'wall', minX: 0, maxX: 8, minY: 22, maxY: 23 },
      { kind: 'wall', minX: 10, maxX: 18, minY: 22, maxY: 23 },
    ],
    colors: {
      background: '#cfc6b6',
      ground: '#dfd3bb',
      grid: '#d1c3a6',
      river: '#6f9fb8',
      bridge: '#8a6a50',
      border: '#8f8579',
    },
  },
};

/** 是否为已知的战役地图 id。 */
export function isCampaignArenaId(value: unknown): value is CampaignArenaId {
  return typeof value === 'string' && value in CAMPAIGN_ARENA_PRESETS;
}
