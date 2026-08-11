import type { PlayerProfile, PlayerProfileStore } from './types.js';

/** 本地档案唯一键；版本变更通过 schemaVersion 字段迁移，不改键名。 */
export const PLAYER_PROFILE_STORAGE_KEY = 'pb.player.profile.v1';
/** 损坏原文备份键，便于排查。 */
export const PLAYER_PROFILE_CORRUPT_BACKUP_KEY = 'pb.player.profile.corrupt';

/** 基于 localStorage 的设备档案仓库。 */
export function createLocalPlayerProfileStore(
  storage: Storage = localStorage,
): PlayerProfileStore {
  return {
    load() {
      const raw = storage.getItem(PLAYER_PROFILE_STORAGE_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        this.backupCorrupt?.(raw);
        return null;
      }
    },
    save(profile: PlayerProfile) {
      storage.setItem(PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
    },
    backupCorrupt(raw: string) {
      try {
        storage.setItem(PLAYER_PROFILE_CORRUPT_BACKUP_KEY, raw);
      } catch {
        // 备份失败不影响重建默认档案
      }
    },
  };
}
