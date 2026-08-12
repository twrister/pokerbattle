import fs from 'node:fs';

export interface DistInfo {
  exists: boolean;
  /** dist/index.html 的 mtime（毫秒时间戳）；不存在则为 null。 */
  builtAt: number | null;
}

/**
 * 读取客户端 dist 入口文件信息，用 index.html 修改时间代表最近一次构建。
 */
export async function readDistInfo(distIndexPath: string): Promise<DistInfo> {
  try {
    const stat = await fs.promises.stat(distIndexPath);
    if (!stat.isFile()) {
      return { exists: false, builtAt: null };
    }
    return { exists: true, builtAt: stat.mtimeMs };
  } catch {
    return { exists: false, builtAt: null };
  }
}
