/**
 * 是否为开发服（`pnpm dev` → 9081）。
 * 正式服为 `pnpm build` + `pnpm preview`（9080），此时为 false。
 */
export const IS_DEV_SERVER = import.meta.env.DEV;

/** 大厅展示用版本号；部署时由 VITE_APP_VERSION 注入，本地回落 package.json。 */
export const APP_VERSION = String(import.meta.env.VITE_APP_VERSION ?? '0.1.0');

/** 去掉重复 v 前缀，统一成 vX.Y.Z。 */
export function formatLobbyVersion(version: string): string {
  const trimmed = version.trim().replace(/^v/i, '');
  return `v${trimmed || '0.0.0'}`;
}
