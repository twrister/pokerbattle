import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const REALM = 'PokerBattle Ops';

/** 校验 HTTP Basic；用户名或密码任一不匹配都失败，比较走常量时间。 */
export function checkBasicAuth(
  req: IncomingMessage,
  user: string,
  password: string,
): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const givenUser = decoded.slice(0, sep);
  const givenPass = decoded.slice(sep + 1);
  return safeEqual(givenUser, user) && safeEqual(givenPass, password);
}

/** 要求浏览器弹出登录框。 */
export function writeUnauthorized(res: ServerResponse): void {
  res.writeHead(401, {
    'WWW-Authenticate': `Basic realm="${REALM}"`,
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end('Unauthorized');
}

/** 长度不同时仍做一次 dummy compare，减少计时侧信道。 */
function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(1);
    crypto.timingSafeEqual(dummy, dummy);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
