import chapter1 from './stages/chapter1.json';
import type { StageDef } from './stageDef.js';

/** 全部战役关卡，按章节、章内序号升序；新增章节只需在这里并入。 */
export const CAMPAIGN_STAGES: readonly StageDef[] = [...(chapter1 as unknown as StageDef[])].sort(
  (left, right) => left.chapter - right.chapter || left.index - right.index,
);

/** 按 id 查关卡；不存在返回 undefined。 */
export function getStageById(stageId: string): StageDef | undefined {
  return CAMPAIGN_STAGES.find((stage) => stage.id === stageId);
}

/** 同章的下一关；已是最后一关返回 undefined。 */
export function getNextStage(stageId: string): StageDef | undefined {
  const index = CAMPAIGN_STAGES.findIndex((stage) => stage.id === stageId);
  return index >= 0 ? CAMPAIGN_STAGES[index + 1] : undefined;
}
