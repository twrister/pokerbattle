/** 首次开局改名只主动提示一次，与档案 schema 解耦。 */
export const FIRST_PLAY_RENAME_PROMPTED_KEY = 'pb.rename.firstPlayPrompted.v1';

/** 读本地旗标；读失败视为未提示，避免误伤首次引导。 */
export function hasPromptedFirstPlayRename(storage: Storage = localStorage): boolean {
  try {
    return storage.getItem(FIRST_PLAY_RENAME_PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 记下已主动提示；写失败由调用方内存旗标兜底，本会话不再弹。 */
export function markFirstPlayRenamePrompted(storage: Storage = localStorage): void {
  try {
    storage.setItem(FIRST_PLAY_RENAME_PROMPTED_KEY, '1');
  } catch {
    // 配额满时仍靠内存旗标拦住重复弹窗
  }
}
