import { fetchGameStatus } from './gameStatus.js';
import type { ProcessManager } from './processManager.js';
import type { OpsDashboardStatus, OpsServiceEntry, OpsServiceId } from './types.js';

export interface ServiceDescriptor {
  id: OpsServiceId;
  label: string;
  port: number;
  path: string;
  description: string;
  manager: ProcessManager;
}

export interface BuildDashboardStatusOptions {
  opsHost: string;
  opsPort: number;
  opsStartedAt: number;
  gameBaseUrl: string;
  processManager: ProcessManager;
  services: ServiceDescriptor[];
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
  if (processInfo.externalConflict) {
    message = processInfo.lastError ?? '游戏服端口被外部进程占用';
  } else if (processInfo.state === 'error') {
    message = processInfo.lastError ?? '游戏服务器处于错误状态';
  } else if (processInfo.state === 'stopped' && !gameResult.reachable) {
    message = '游戏服务器未启动';
  } else if (
    (processInfo.state === 'running' || processInfo.state === 'starting') &&
    !gameResult.reachable
  ) {
    message = gameResult.error ?? '游戏服务器进程在跑，但状态接口暂不可达';
  } else if (gameResult.reachable && processInfo.state === 'stopped') {
    // 外部已有游戏服在响应，但非本站托管
    message = '检测到游戏服可达，但并非由本运维站托管';
  }

  return {
    ops: {
      host: options.opsHost,
      port: options.opsPort,
      startedAt: options.opsStartedAt,
      uptimeMs: Date.now() - options.opsStartedAt,
    },
    process: processInfo,
    game: gameResult.status,
    gameReachable: gameResult.reachable,
    message,
    services,
  };
}

/** 将托管管理器与端口探测结果合成前端服务卡片数据。 */
async function toServiceEntry(service: ServiceDescriptor): Promise<OpsServiceEntry> {
  await service.manager.refreshFromPort();
  const process = service.manager.getInfo();
  const reachable = await service.manager.isReachable();
  return {
    id: service.id,
    label: service.label,
    port: service.port,
    path: service.path,
    description: service.description,
    reachable,
    process,
  };
}
