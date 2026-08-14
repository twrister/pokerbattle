/** 本次登录改名只主动提示一次，关页后再进仍会引导。 */
export const FIRST_PLAY_RENAME_PROMPTED_KEY = 'pb.rename.firstPlayPrompted.v1';

/** 读会话旗标；读失败视为未提示，避免误伤当次引导。 */
export function hasPromptedFirstPlayRename(storage: Storage = sessionStorage): boolean {
  try {
    return storage.getItem(FIRST_PLAY_RENAME_PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 记下本会话已主动提示；写失败由调用方内存旗标兜底。 */
export function markFirstPlayRenamePrompted(storage: Storage = sessionStorage): void {
  try {
    storage.setItem(FIRST_PLAY_RENAME_PROMPTED_KEY, '1');
  } catch {
    // 配额满时仍靠内存旗标拦住重复弹窗
  }
}
