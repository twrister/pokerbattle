import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 浏览器兜底读取的静态清单；旧运维进程也能从磁盘直接端出去。 */
export const LAN_IPS_JSON = 'lan-ips.json';

/**
 * 列出本机非回环 IPv4，供运维站入口展示可分享地址。
 * 回环地址（127.0.0.1）对局域网其他设备不可达，因此排除。
 */
export function listLanIPv4(): string[] {
  const result: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (isLanIPv4(entry) && !result.includes(entry.address)) {
        result.push(entry.address);
      }
    }
  }
  return preferLanIps(result);
}

/**
 * 写入 public/lan-ips.json，让未重启的运维进程也能把 IP 交给前端。
 */
export function writeLanIpsJson(publicDir: string, lanIps = listLanIPv4()): string[] {
  const filePath = path.join(publicDir, LAN_IPS_JSON);
  fs.writeFileSync(filePath, `${JSON.stringify({ lanIps }, null, 2)}\n`, 'utf8');
  return lanIps;
}

/** 优先 192.168，其次 10/172.16–31，降低虚拟网卡抢首位的概率。 */
export function preferLanIps(ips: string[]): string[] {
  return [...ips].sort((a, b) => lanRank(a) - lanRank(b) || a.localeCompare(b));
}

function lanRank(ip: string): number {
  if (ip.startsWith('192.168.')) return 0;
  if (ip.startsWith('10.')) return 1;
  const match = /^172\.(\d+)\./.exec(ip);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return 2;
  }
  return 3;
}

/** Node 旧版 family 为 'IPv4'；部分运行时会给出数字 4，统一转成字符串再比。 */
function isLanIPv4(entry: os.NetworkInterfaceInfo): boolean {
  const family = String(entry.family);
  const isV4 = family === 'IPv4' || family === '4';
  return isV4 && !entry.internal;
}
