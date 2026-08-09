/**
 * 是否为开发服（`pnpm dev` → 8081）。
 * 正式服为 `pnpm build` + `pnpm preview`（8080），此时为 false。
 */
export const IS_DEV_SERVER = import.meta.env.DEV;
