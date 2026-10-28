import rawStages from './stages/stages.json';
import type { StageDef } from './stageDef.js';

/**
 * 全部战役关卡，按 index 升序连续编号，不分章节。
 * 前三关 id 沿用旧的 c1_x，避免玩家本地已通关的进度失效。
 */
export const CAMPAIGN_STAGES: readonly StageDef[] = [...(rawStages as unknown as StageDef[])].sort(
  (left, right) => left.index - right.index,
);

/** 按 id 查关卡；不存在返回 undefined。 */
export function getStageById(stageId: string): StageDef | undefined {
  return CAMPAIGN_STAGES.find((stage) => stage.id === stageId);
}

/** 下一关；已是最后一关返回 undefined。 */
export function getNextStage(stageId: string): StageDef | undefined {
  const index = CAMPAIGN_STAGES.findIndex((stage) => stage.id === stageId);
  return index >= 0 ? CAMPAIGN_STAGES[index + 1] : undefined;
}
