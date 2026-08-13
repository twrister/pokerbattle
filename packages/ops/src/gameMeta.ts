import fs from 'node:fs';

export interface GameDeployMeta {
  name: string;
  port: number;
  route: string;
  deployedAt: string | null;
}

/**
 * 读取游戏服 deploy.meta.json；缺文件或 port 非法时返回 null，由调用方降级提示。
 */
export function readGameMeta(filePath: string): GameDeployMeta | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const port = Number(raw.port);
    if (!Number.isInteger(port) || port <= 0) return null;
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      port,
      route: typeof raw.route === 'string' ? raw.route : '',
      deployedAt: typeof raw.deployedAt === 'string' ? raw.deployedAt : null,
    };
  } catch {
    return null;
  }
}
