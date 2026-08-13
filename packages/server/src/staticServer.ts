import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * 生产环境提供前端静态资源。路径必须落在 dist 内，避免目录穿越；
 * 无扩展名的 SPA 路由回落到 index.html，带扩展名的缺失资源返回 404。
 */
export function serveStatic(res: ServerResponse, distDir: string, pathname: string): void {
  const relative = pathname === '/' ? '/index.html' : pathname;
  const distRoot = path.resolve(distDir);
  const resolved = path.resolve(distRoot, `.${relative}`);
  if (resolved !== distRoot && !resolved.startsWith(distRoot + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (!err) {
      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(data);
      return;
    }
    if (path.extname(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    fs.readFile(path.join(distRoot, 'index.html'), (indexErr, indexData) => {
      if (indexErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexData);
    });
  });
}
