import { readDistInfo } from './distInfo.js';
import { fetchGameStatus } from './gameStatus.js';
import type { ServiceController } from './serviceController.js';
import type { OpsDashboardStatus, OpsDeployInfo, OpsServiceEntry, OpsServiceId } from './types.js';

export interface ServiceDescriptor {
  id: OpsServiceId;
  label: string;
  port: number;
  path: string;
  description: string;
  manager: ServiceController;
  /** 正式服：指向 packages/client/dist/index.html，用于展示构建时间。 */
  distIndexPath?: string;
  publicUrl?: string | null;
  openOnly?: boolean;
  /** 覆盖 dist 时间，例如线上 deploy.meta.json 的 deployedAt。 */
  builtAt?: number | null;
}

export interface BuildDashboardStatusOptions {
  opsHost: string;
  opsPort: number;
  opsStartedAt: number;
  gameBaseUrl: string;
  processManager: ServiceController;
  production?: boolean;
  services: ServiceDescriptor[];
  /** 本机局域网 IPv4；缺省为空，由调用方探测后注入。 */
  lanIps?: string[];
  deploy?: OpsDeployInfo;
}

/**
 * 聚合运维进程信息与游戏服状态，归一化“未启动/不可达”文案。
 */
export async function buildDashboardStatus(
  options: BuildDashboardStatusOptions,
): Promise<OpsDashboardStatus> {
  await options.processManager.refreshFromPort();
  const processInfo = options.processManager.getInfo();
  const gameResult = await fetchGameStatus(options.gameBaseUrl);
  const services = await Promise.all(options.services.map((service) => toServiceEntry(service)));

  let message: string | null = null;
  if (processInfo.externalConflict || (gameResult.reachable && processInfo.state === 'stopped')) {
    // 端口/状态接口可达但非本站托管：提示外部占用，不伪装成本站 running
    message = processInfo.lastError ?? '检测到游戏服可达，但并非由本运维站托管';
  } else if (processInfo.state === 'error') {
    message = processInfo.lastError ?? '游戏服务器处于错误状态';
  } else if (processInfo.state === 'stopped' && !gameResult.reachable) {
    message = '游戏服务器未启动';
  } else if (
    (processInfo.state === 'running' || processInfo.state === 'starting') &&
    !gameResult.reachable
  ) {
    message = gameResult.error ?? '游戏服务器进程在跑，但状态接口暂不可达';
  }

  return {
    ops: {
      host: options.opsHost,
      port: options.opsPort,
      startedAt: options.opsStartedAt,
      uptimeMs: Date.now() - options.opsStartedAt,
      lanIps: options.lanIps ?? [],
      production: Boolean(options.production),
    },
    process: processInfo,
    game: gameResult.status,
    gameReachable: gameResult.reachable,
    message,
    services,
    deploy: options.deploy ?? {
      running: false,
      available: true,
      command: 'pnpm deploy',
      lastError: null,
      lastFinishedAt: null,
      lastOk: null,
    },
  };
}

/** 将托管管理器与端口探测结果合成前端服务卡片数据。 */
async function toServiceEntry(service: ServiceDescriptor): Promise<OpsServiceEntry> {
  await service.manager.refreshFromPort();
  const process = service.manager.getInfo();
  const reachable = await service.manager.isReachable();
  const distBuiltAt =
    service.builtAt !== undefined
      ? service.builtAt
      : service.distIndexPath
        ? (await readDistInfo(service.distIndexPath)).builtAt
        : null;
  return {
    id: service.id,
    label: service.label,
    port: service.port,
    path: service.path,
    description: service.description,
    reachable,
    process,
    distBuiltAt,
    publicUrl: service.publicUrl ?? null,
    openOnly: Boolean(service.openOnly),
  };
}
