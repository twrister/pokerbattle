import { dumpArenaConfigDraft, type MatchMode } from '@pb/sim';

/**
 * 只指纹影响仿真的场地布局。镜头/颜色变了不该让旧录像标成失真。
 */
export function createArenaSignature(mode: MatchMode): string {
  const draft = dumpArenaConfigDraft(mode);
  return JSON.stringify({
    width: draft.width,
    height: draft.height,
    riverWidth: draft.riverWidth,
    bridges: draft.bridges,
    bridge3Enabled: draft.bridge3Enabled,
    bases: draft.bases,
  });
}
