import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'ssh2';
import { readPackageVersion, resolveAndSyncReleaseVersion } from './releaseVersion.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = JSON.parse(fs.readFileSync(path.join(root, '.deploy/project.json'), 'utf8'));
const NAME = project.name;
const ROUTE = `/${NAME}`;
const REMOTE_ROOT = `/opt/projects/${NAME}`;
const REMOTE_APP = `${REMOTE_ROOT}/app`;
const REGISTRY_PATH = '/opt/deploy/registry.json';
const NGINX_SNIPPET = `/etc/nginx/conf.d/projects/${NAME}.conf`;
const SERVICE_PATH = `/etc/systemd/system/${NAME}.service`;
const OPS_NAME = 'poker-battle-ops';
const OPS_ROUTE = `/${OPS_NAME}`;
const OPS_REMOTE_ROOT = `/opt/projects/${OPS_NAME}`;
const OPS_REMOTE_APP = `${OPS_REMOTE_ROOT}/app`;
const OPS_NGINX_SNIPPET = `/etc/nginx/conf.d/projects/${OPS_NAME}.conf`;
const OPS_SERVICE_PATH = `/etc/systemd/system/${OPS_NAME}.service`;
const OPS_ENV_REMOTE = `${OPS_REMOTE_ROOT}/ops.env`;
const OPS_HTPASSWD = `/etc/nginx/.htpasswd-${OPS_NAME}`;
const TARBALL_LOCAL = path.join(root, '.deploy/release.tar.gz');
const TARBALL_REMOTE = `/tmp/${NAME}-release.tar.gz`;
const WORKSPACE_REMOTE = `${REMOTE_ROOT}/workspace`;
const WORKSPACE_TARBALL = path.join(root, '.deploy/workspace.tar.gz');

const creds = loadEnvFile(path.join(os.homedir(), '.cursor', 'deploy-server.env'));
const HOST = must(creds.DEPLOY_HOST, 'DEPLOY_HOST');
const SSH_PORT = Number(creds.DEPLOY_SSH_PORT || 22);
const USER = creds.DEPLOY_USER || 'root';
const PASSWORD = creds.DEPLOY_PASSWORD;
const PRIVATE_KEY = creds.DEPLOY_PRIVATE_KEY
  ? fs.readFileSync(creds.DEPLOY_PRIVATE_KEY)
  : undefined;
const OPS_BASIC_USER = creds.OPS_BASIC_USER;
const OPS_BASIC_PASSWORD = creds.OPS_BASIC_PASSWORD;

if (!PASSWORD && !PRIVATE_KEY) {
  console.error('~/.cursor/deploy-server.env 缺少 DEPLOY_PASSWORD 或 DEPLOY_PRIVATE_KEY');
  process.exit(1);
}
if (!OPS_BASIC_USER || !OPS_BASIC_PASSWORD) {
  console.error(
    '~/.cursor/deploy-server.env 缺少 OPS_BASIC_USER / OPS_BASIC_PASSWORD，无法部署线上运维站',
  );
  process.exit(1);
}

await main();

async function main() {
  console.log(`[deploy] project=${NAME} host=${HOST} route=${ROUTE}/`);
  console.log(`[deploy] ops=${OPS_NAME} route=${OPS_ROUTE}/`);

  const conn = await connectSsh();
  try {
    await bootstrapServer(conn);
    const previous = await readRemoteReleaseMeta(conn);
    // 本机 pnpm deploy 默认仍自动 +1；运维站会显式传 DEPLOY_BUMP_VERSION=0/1
    const bumpVersion = process.env.DEPLOY_BUMP_VERSION !== '0';
    const { version, contentHash } = resolveAndSyncReleaseVersion(root, previous, { bumpVersion });
    console.log(`[deploy] version=${version} bump=${bumpVersion} hash=${contentHash.slice(0, 12)}`);

    process.env.VITE_PUBLIC_BASE = ROUTE;
    process.env.VITE_APP_VERSION = version;
    runLocal('pnpm', ['run', 'build:prod']);
    packRelease();

    const game = await allocatePort(conn, NAME, ROUTE);
    const ops = await allocatePort(conn, OPS_NAME, OPS_ROUTE, [game.port]);
    await uploadRelease(conn);
    await writeSystemd(conn, game.port, { version, contentHash });
    await writeNginx(conn, game.port);
    await writeRegistry(conn, {
      name: NAME,
      port: game.port,
      route: ROUTE,
      type: project.type,
      remoteDir: REMOTE_ROOT,
    });
    await writeOpsEnv(conn);
    await writeOpsSystemd(conn, ops.port, game.port);
    await writeOpsNginx(conn, ops.port);
    await writeRegistry(conn, {
      name: OPS_NAME,
      port: ops.port,
      route: OPS_ROUTE,
      type: 'node',
      remoteDir: OPS_REMOTE_ROOT,
    });
    await restartAndVerify(conn, game.port);
    await restartAndVerifyOps(conn, ops.port);
    console.log(`
## 部署完成

- **游戏访问**：http://${HOST}${ROUTE}/
- **运维站**：http://${HOST}${OPS_ROUTE}/ （浏览器 Basic 登录）
- **游戏内部端口**：${game.port}（0.0.0.0，nginx 反代）
- **运维内部端口**：${ops.port}（127.0.0.1，仅本机 nginx）
- **systemd**：systemctl status ${NAME} / ${OPS_NAME}

更新部署：本机再次运行 pnpm deploy（复用 registry 中的 port/route）。
`);
  } finally {
    conn.end();
    fs.rmSync(TARBALL_LOCAL, { force: true });
    fs.rmSync(WORKSPACE_TARBALL, { force: true });
    fs.rmSync(path.join(root, '.deploy/ops.env'), { force: true });
  }
}

/** 读取 KEY=VALUE 凭据文件，不把内容打印到终端。 */
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`缺少 ${filePath}，请复制 deploy-server.env.example 后填写`);
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, idx).trim()] = value;
  }
  return env;
}

function must(value, key) {
  if (!value) {
    console.error(`缺少 ${key}`);
    process.exit(1);
  }
  return value;
}

function runLocal(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** 把 dist 与 dist-server 打成单包，减少逐文件 SFTP。 */
function packRelease() {
  packWorkspace();
  fs.mkdirSync(path.join(root, '.deploy'), { recursive: true });
  fs.rmSync(TARBALL_LOCAL, { force: true });
  const stagedWorkspace = path.join(root, 'workspace.tar.gz');
  fs.copyFileSync(WORKSPACE_TARBALL, stagedWorkspace);
  const result = spawnSync(
    'tar',
    ['-czf', TARBALL_LOCAL, 'dist', 'dist-server', 'dist-ops', 'workspace.tar.gz'],
    { cwd: root, stdio: 'inherit', shell: true },
  );
  fs.rmSync(stagedWorkspace, { force: true });
  if (result.status !== 0 || !fs.existsSync(TARBALL_LOCAL)) {
    console.error('打包 release.tar.gz 失败');
    process.exit(1);
  }
}

/** 同步可构建源码到服务器，供线上运维站执行 pnpm deploy。 */
function packWorkspace() {
  const stage = path.join(root, '.deploy/workspace-stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const skip = new Set(['node_modules', 'dist', 'dist-server', 'dist-ops', '.git', 'coverage']);
  const copyFiltered = (src, dest) => {
    fs.cpSync(src, dest, {
      recursive: true,
      filter: (from) => !skip.has(path.basename(from)),
    });
  };
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']) {
    const src = path.join(root, name);
    if (!fs.existsSync(src)) {
      console.error(`打包工作区缺少 ${name}`);
      process.exit(1);
    }
    fs.copyFileSync(src, path.join(stage, name));
  }
  copyFiltered(path.join(root, 'packages'), path.join(stage, 'packages'));
  copyFiltered(path.join(root, 'scripts'), path.join(stage, 'scripts'));
  fs.mkdirSync(path.join(stage, '.deploy'), { recursive: true });
  fs.copyFileSync(path.join(root, '.deploy/project.json'), path.join(stage, '.deploy/project.json'));

  fs.rmSync(WORKSPACE_TARBALL, { force: true });
  const result = spawnSync('tar', ['-czf', WORKSPACE_TARBALL, '-C', stage, '.'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  fs.rmSync(stage, { recursive: true, force: true });
  if (result.status !== 0 || !fs.existsSync(WORKSPACE_TARBALL)) {
    console.error('打包 workspace.tar.gz 失败');
    process.exit(1);
  }
}

function connectSsh() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({
      host: HOST,
      port: SSH_PORT,
      username: USER,
      password: PASSWORD,
      privateKey: PRIVATE_KEY,
      passphrase: creds.DEPLOY_PASSPHRASE,
      readyTimeout: 30_000,
    });
  });
}

/** 读取线上上次发布的 version / contentHash；文件不存在或坏 JSON 时按首次部署处理。 */
async function readRemoteReleaseMeta(conn) {
  try {
    const stdout = await exec(
      conn,
      `if [ -f ${REMOTE_ROOT}/deploy.meta.json ]; then cat ${REMOTE_ROOT}/deploy.meta.json; fi`,
    );
    const text = String(stdout || '').trim();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function exec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      stream.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`${command}\nexit=${code}\n${stderr || stdout}`));
          return;
        }
        resolve(stdout);
      });
    });
  });
}

/** 首次部署：目录、80 端口 server include、Node 运行时。location 片段必须进 server 块，不能挂在 http 层。 */
async function bootstrapServer(conn) {
  await exec(
    conn,
    `
set -e
mkdir -p /opt/deploy /opt/projects /etc/nginx/conf.d/projects
if [ ! -f ${REGISTRY_PATH} ]; then echo '{}' > ${REGISTRY_PATH}; fi
if ! command -v nginx >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y nginx;
  elif command -v dnf >/dev/null 2>&1; then dnf install -y nginx;
  elif command -v yum >/dev/null 2>&1; then yum install -y nginx;
  else echo 'nginx not found and no package manager'; exit 1; fi
fi
rm -f /etc/nginx/sites-enabled/default
if [ ! -f /etc/nginx/conf.d/00-websocket-map.conf ]; then
  cat > /etc/nginx/conf.d/00-websocket-map.conf << 'MAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
MAP
fi
if [ ! -f /etc/nginx/conf.d/00-projects-server.conf ]; then
  cat > /etc/nginx/conf.d/00-projects-server.conf << 'SRV'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    include /etc/nginx/conf.d/projects/*.conf;
    location / {
        default_type text/html;
        return 200 '<h2>OK</h2><p>Projects are under /&lt;name&gt;/</p>';
    }
}
SRV
fi
VER=v22.23.2
MAJOR=$(/usr/local/bin/node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
# pnpm 11 需要 Node >= 22.13；已装 Node 20 时也要升级
if [ ! -x /usr/local/bin/node ] || [ "$MAJOR" -lt 22 ]; then
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) NODEARCH=x64 ;;
    aarch64) NODEARCH=arm64 ;;
    *) echo "unsupported arch $ARCH"; exit 1 ;;
  esac
  curl -fsSL "https://nodejs.org/dist/\${VER}/node-\${VER}-linux-\${NODEARCH}.tar.xz" -o /tmp/node.tar.xz
  rm -rf /tmp/node-extract
  mkdir -p /tmp/node-extract
  tar -xJf /tmp/node.tar.xz -C /tmp/node-extract --strip-components=1
  rm -rf /usr/local/lib/nodejs
  mv /tmp/node-extract /usr/local/lib/nodejs
  ln -sfn /usr/local/lib/nodejs/bin/node /usr/local/bin/node
  ln -sfn /usr/local/lib/nodejs/bin/npm /usr/local/bin/npm
fi
# Node 20 自带 corepack 签名密钥过期，enable 出的 pnpm 垫片不可用；改 npm 装真实二进制
if [ -x /usr/local/lib/nodejs/bin/npx ]; then
  ln -sfn /usr/local/lib/nodejs/bin/npx /usr/local/bin/npx
fi
if [ -x /usr/local/lib/nodejs/bin/corepack ]; then
  ln -sfn /usr/local/lib/nodejs/bin/corepack /usr/local/bin/corepack
  /usr/local/bin/corepack disable >/dev/null 2>&1 || true
fi
if ! pnpm -v >/dev/null 2>&1; then
  /usr/local/bin/npm install -g pnpm@11.20.0
fi
if [ -x /usr/local/lib/nodejs/bin/pnpm ]; then
  ln -sfn /usr/local/lib/nodejs/bin/pnpm /usr/local/bin/pnpm
fi
/usr/local/bin/node -v
pnpm -v
if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get install -y curl;
  elif command -v dnf >/dev/null 2>&1; then dnf install -y curl;
  elif command -v yum >/dev/null 2>&1; then yum install -y curl; fi
fi
systemctl enable nginx >/dev/null 2>&1 || true
systemctl start nginx >/dev/null 2>&1 || true
`.trim(),
  );
}

/** 复用已注册端口，或从 3000 起找空闲端口。 */
async function allocatePort(conn, name, route, extraUsed = []) {
  const raw = await exec(conn, `cat ${REGISTRY_PATH} || echo '{}'`);
  let registry = {};
  try {
    registry = JSON.parse(raw || '{}');
  } catch {
    registry = {};
  }
  const existing = registry[name];
  if (existing?.route && existing.route !== route) {
    throw new Error(`路由冲突：registry 中 ${name} 的 route=${existing.route}，期望 ${route}`);
  }
  for (const [key, entry] of Object.entries(registry)) {
    if (key !== name && entry?.route === route) {
      throw new Error(`路由 ${route} 已被 ${key} 占用`);
    }
  }
  if (existing?.port) {
    console.log(`[deploy] reuse port ${existing.port} for ${name}`);
    return { port: existing.port, registry };
  }
  const listening = await exec(conn, `ss -lnt | awk 'NR>1 {print $4}'`);
  const used = new Set(
    Object.values(registry)
      .map((entry) => entry?.port)
      .filter((port) => typeof port === 'number'),
  );
  for (const extra of extraUsed) used.add(extra);
  for (const token of listening.split(/\s+/)) {
    const m = token.match(/:(\d+)$/);
    if (m) used.add(Number(m[1]));
  }
  let port = 3000;
  while (used.has(port) || port === 22 || port === 80 || port === 443) port += 1;
  console.log(`[deploy] allocate port ${port} for ${name}`);
  return { port, registry };
}

function uploadRelease(conn) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.fastPut(TARBALL_LOCAL, TARBALL_REMOTE, (putErr) => {
        sftp.end();
        if (putErr) {
          reject(putErr);
          return;
        }
        exec(
          conn,
          `set -e
mkdir -p ${REMOTE_APP} ${OPS_REMOTE_APP} ${WORKSPACE_REMOTE} /tmp/${NAME}-unpack
rm -rf /tmp/${NAME}-unpack
mkdir -p /tmp/${NAME}-unpack
tar -xzf ${TARBALL_REMOTE} -C /tmp/${NAME}-unpack
rm -rf ${REMOTE_APP}/dist ${REMOTE_APP}/dist-server
cp -a /tmp/${NAME}-unpack/dist /tmp/${NAME}-unpack/dist-server ${REMOTE_APP}/
find ${OPS_REMOTE_APP} -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a /tmp/${NAME}-unpack/dist-ops/. ${OPS_REMOTE_APP}/
if [ -d ${WORKSPACE_REMOTE}/node_modules ]; then mv ${WORKSPACE_REMOTE}/node_modules /tmp/${NAME}-nm; fi
rm -rf ${WORKSPACE_REMOTE}
mkdir -p ${WORKSPACE_REMOTE}
tar -xzf /tmp/${NAME}-unpack/workspace.tar.gz -C ${WORKSPACE_REMOTE}
if [ -d /tmp/${NAME}-nm ]; then mv /tmp/${NAME}-nm ${WORKSPACE_REMOTE}/node_modules; fi
rm -rf /tmp/${NAME}-unpack ${TARBALL_REMOTE}
test -f ${REMOTE_APP}/dist/index.html
test -f ${REMOTE_APP}/dist-server/server.cjs
test -f ${OPS_REMOTE_APP}/server.cjs
test -f ${OPS_REMOTE_APP}/public/index.html
test -f ${WORKSPACE_REMOTE}/package.json
test -f ${WORKSPACE_REMOTE}/scripts/apply-on-server.mjs`,
        )
          .then(resolve)
          .catch(reject);
      });
    });
  });
}

async function writeSystemd(conn, port, release = {}) {
  const extraEnv = Object.entries(project.env || {})
    .map(([key, value]) => `Environment=${key}=${value}`)
    .join('\n');
  const unit = `[Unit]
Description=${NAME}
After=network.target

[Service]
Type=simple
WorkingDirectory=${REMOTE_APP}
Environment=PORT=${port}
Environment=HOST=0.0.0.0
Environment=BIND=0.0.0.0
Environment=LISTEN_HOST=0.0.0.0
${extraEnv}
ExecStart=${project.startCommand}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
`;
  const meta = JSON.stringify(
    {
      name: NAME,
      port,
      route: ROUTE,
      startCommand: project.startCommand,
      version: release.version ?? readPackageVersion(root),
      contentHash: release.contentHash ?? '',
      deployedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  await exec(
    conn,
    `cat > ${SERVICE_PATH} << 'EOF'
${unit}
EOF
cat > ${REMOTE_ROOT}/deploy.meta.json << 'EOF'
${meta}
EOF
systemctl daemon-reload
systemctl enable ${NAME}
`,
  );
}

async function writeNginx(conn, port) {
  const conf = `location = ${ROUTE} { return 301 ${ROUTE}/; }
location ${ROUTE}/ {
    proxy_pass http://127.0.0.1:${port}/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix ${ROUTE};
    proxy_read_timeout 600s;
}
`;
  await exec(
    conn,
    `set -e
# 清掉其它 conf 里占用同一 location 的遗留片段
for f in /etc/nginx/conf.d/projects/*.conf; do
  [ -f "$f" ] || continue
  [ "$f" = "${NGINX_SNIPPET}" ] && continue
  if grep -q "location ${ROUTE}/" "$f"; then
    echo "conflict location in $f" >&2
    exit 1
  fi
done
cat > ${NGINX_SNIPPET} << 'EOF'
${conf}
EOF
nginx -t
systemctl reload nginx
`,
  );
}

/** 把本项目 port/route 写回服务器注册表，避免下次分配冲突。 */
async function writeRegistry(conn, entry) {
  const payload = JSON.stringify({
    port: entry.port,
    route: entry.route,
    type: entry.type,
    remoteDir: entry.remoteDir,
    updatedAt: new Date().toISOString(),
  });
  await exec(
    conn,
    `/usr/local/bin/node -e ${JSON.stringify(
      `const fs=require('fs');const p=${JSON.stringify(REGISTRY_PATH)};let d={};try{d=JSON.parse(fs.readFileSync(p,'utf8')||'{}')}catch(e){d={}}d[${JSON.stringify(entry.name)}]=${payload};fs.writeFileSync(p,JSON.stringify(d,null,2)+'\\n');`,
    )}`,
  );
}

async function restartAndVerify(conn, port) {
  await exec(conn, `systemctl restart ${NAME}`);
  await sleep(2000);

  let listen = '';
  for (let i = 0; i < 8; i += 1) {
    listen = await exec(
      conn,
      `ss -ltnp | grep -E ":${port}([^0-9]|$)" || true`,
    );
    const okListen = /0\.0\.0\.0:|\[::\]:|\*:/.test(listen);
    if (okListen) break;
    if (/127\.0\.0\.1:|\[::1\]:/.test(listen)) {
      throw new Error(`仅监听 127.0.0.1，拒绝报告成功:\n${listen}`);
    }
    await sleep(1000);
  }
  if (!/0\.0\.0\.0:|\[::\]:|\*:/.test(listen)) {
    const logs = await exec(conn, `journalctl -u ${NAME} -n 80 --no-pager || true`);
    throw new Error(`端口 ${port} 未监听 0.0.0.0\n${listen}\n${logs}`);
  }
  console.log(`[deploy] listen:\n${listen.trim()}`);

  const health = await exec(
    conn,
    `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${port}${project.healthPath} || true`,
  );
  if (health.trim() !== '200') {
    const logs = await exec(conn, `journalctl -u ${NAME} -n 80 --no-pager || true`);
    throw new Error(`health 失败: ${health}\n${logs}`);
  }

  const proxy = await exec(
    conn,
    `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1${ROUTE}/`,
  );
  const redirects = await exec(
    conn,
    `curl -sL -o /dev/null -w "redirects=%{num_redirects} final=%{http_code}\\n" --max-redirs 10 http://127.0.0.1${ROUTE}/`,
  );
  const headers = await exec(
    conn,
    `curl -sI --max-redirs 5 http://127.0.0.1${ROUTE}/ | grep -iE '^HTTP|^location' || true`,
  );
  const direct = await exec(
    conn,
    `curl -s -o /dev/null -w "direct=%{http_code}\\n" http://127.0.0.1:${port}/`,
  );
  console.log(`[deploy] health=200 proxy=${proxy.trim()} ${direct.trim()} ${redirects.trim()}`);
  console.log(headers.trim());

  const redirectCount = Number((redirects.match(/redirects=(\d+)/) || [])[1] || 0);
  if (proxy.trim() !== '200' || redirectCount > 1) {
    throw new Error(`nginx 反代校验失败: proxy=${proxy.trim()} ${redirects.trim()}\n${headers}`);
  }

  try {
    const publicCode = await exec(
      conn,
      `curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://${HOST}${ROUTE}/ || true`,
    );
    console.log(`[deploy] public=${publicCode.trim()}`);
  } catch {
    console.log('[deploy] 公网探测跳过');
  }
}

/** 把 Basic 凭据写成服务器 600 文件，并生成 nginx htpasswd。 */
async function writeOpsEnv(conn) {
  const localEnv = path.join(root, '.deploy/ops.env');
  fs.writeFileSync(
    localEnv,
    `OPS_BASIC_USER=${OPS_BASIC_USER}\nOPS_BASIC_PASSWORD=${OPS_BASIC_PASSWORD}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  await sftpPut(conn, localEnv, OPS_ENV_REMOTE);
  const hashLocal = path.join(root, '.deploy/write-htpasswd.cjs');
  fs.writeFileSync(
    hashLocal,
    `const fs = require('fs');
const { spawnSync } = require('child_process');
function load(p) {
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\\r?\\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    let v = t.slice(i + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[t.slice(0, i)] = v;
  }
  return env;
}
const env = load(process.argv[2]);
const r = spawnSync('openssl', ['passwd', '-apr1', '-stdin'], {
  input: env.OPS_BASIC_PASSWORD,
  encoding: 'utf8',
});
if (r.status !== 0) {
  console.error(String(r.stderr || 'openssl passwd failed'));
  process.exit(1);
}
if (!env.OPS_BASIC_USER || !env.OPS_BASIC_PASSWORD) {
  console.error('ops.env missing credentials');
  process.exit(1);
}
fs.writeFileSync(process.argv[3], env.OPS_BASIC_USER + ':' + r.stdout.trim() + '\\n', { mode: 0o600 });
`,
  );
  const hashRemote = '/tmp/pb-write-htpasswd.cjs';
  await sftpPut(conn, hashLocal, hashRemote);
  fs.rmSync(hashLocal, { force: true });
  await exec(
    conn,
    `set -e
chmod 600 ${OPS_ENV_REMOTE}
/usr/local/bin/node ${hashRemote} ${OPS_ENV_REMOTE} ${OPS_HTPASSWD}
rm -f ${hashRemote}
chmod 644 ${OPS_HTPASSWD}
`,
  );
}

async function writeOpsSystemd(conn, opsPort, gamePort) {
  const unit = `[Unit]
Description=${OPS_NAME}
After=network.target

[Service]
Type=simple
WorkingDirectory=${OPS_REMOTE_APP}
EnvironmentFile=${OPS_ENV_REMOTE}
Environment=OPS_MODE=production
Environment=OPS_HOST=127.0.0.1
Environment=OPS_PORT=${opsPort}
Environment=PORT=${opsPort}
Environment=GAME_META=${REMOTE_ROOT}/deploy.meta.json
Environment=GAME_SYSTEMD_UNIT=${NAME}
Environment=PUBLIC_GAME_URL=http://${HOST}${ROUTE}/
Environment=OPS_WORKSPACE=${WORKSPACE_REMOTE}
Environment=OPS_DEPLOY_STATUS=${OPS_REMOTE_ROOT}/last-deploy.json
Environment=GAME_APP=${REMOTE_APP}
Environment=OPS_APP=${OPS_REMOTE_APP}
Environment=PATH=/usr/local/bin:/usr/local/lib/nodejs/bin:/usr/bin:/bin
Environment=HOME=/root
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/node ${OPS_REMOTE_APP}/server.cjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
`;
  const meta = JSON.stringify(
    {
      name: OPS_NAME,
      port: opsPort,
      route: OPS_ROUTE,
      startCommand: `/usr/local/bin/node ${OPS_REMOTE_APP}/server.cjs`,
      deployedAt: new Date().toISOString(),
      gamePort,
    },
    null,
    2,
  );
  await exec(
    conn,
    `cat > ${OPS_SERVICE_PATH} << 'EOF'
${unit}
EOF
cat > ${OPS_REMOTE_ROOT}/deploy.meta.json << 'EOF'
${meta}
EOF
systemctl daemon-reload
systemctl enable ${OPS_NAME}
`,
  );
}

async function writeOpsNginx(conn, opsPort) {
  const conf = `location = ${OPS_ROUTE} { return 301 ${OPS_ROUTE}/; }
location ${OPS_ROUTE}/ {
    auth_basic "PokerBattle Ops";
    auth_basic_user_file ${OPS_HTPASSWD};
    proxy_pass http://127.0.0.1:${opsPort}/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix ${OPS_ROUTE};
    proxy_set_header Authorization $http_authorization;
    proxy_read_timeout 600s;
}
`;
  await exec(
    conn,
    `set -e
for f in /etc/nginx/conf.d/projects/*.conf; do
  [ -f "$f" ] || continue
  [ "$f" = "${OPS_NGINX_SNIPPET}" ] && continue
  if grep -q "location ${OPS_ROUTE}/" "$f"; then
    echo "conflict location in $f" >&2
    exit 1
  fi
done
cat > ${OPS_NGINX_SNIPPET} << 'EOF'
${conf}
EOF
nginx -t
systemctl reload nginx
`,
  );
}

async function restartAndVerifyOps(conn, port) {
  await exec(conn, `systemctl restart ${OPS_NAME}`);
  await sleep(2000);

  let listen = '';
  for (let i = 0; i < 8; i += 1) {
    listen = await exec(conn, `ss -ltnp | grep -E ":${port}([^0-9]|$)" || true`);
    if (/127\.0\.0\.1:|\[::1\]:/.test(listen)) break;
    await sleep(1000);
  }
  if (!/127\.0\.0\.1:|\[::1\]:/.test(listen)) {
    const logs = await exec(conn, `journalctl -u ${OPS_NAME} -n 80 --no-pager || true`);
    throw new Error(`运维站端口 ${port} 未监听 127.0.0.1\n${listen}\n${logs}`);
  }
  console.log(`[deploy] ops listen:\n${listen.trim()}`);

  const unauth = await exec(
    conn,
    `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1${OPS_ROUTE}/ || true`,
  );
  if (unauth.trim() !== '401') {
    throw new Error(`运维站未登录应返回 401，实际 ${unauth.trim()}`);
  }

  const headerFile = '/tmp/pb-ops-auth.hdr';
  const headerValue = `Authorization: Basic ${Buffer.from(`${OPS_BASIC_USER}:${OPS_BASIC_PASSWORD}`).toString('base64')}`;
  const localHdr = path.join(root, '.deploy/ops.hdr');
  fs.writeFileSync(localHdr, `${headerValue}\n`, { encoding: 'utf8', mode: 0o600 });
  await sftpPut(conn, localHdr, headerFile);
  fs.rmSync(localHdr, { force: true });

  const authed = await exec(
    conn,
    `set -e
BODY=$(curl -s -w "HTTPCODE:%{http_code}" -H "$(tr -d '\\r' < ${headerFile})" http://127.0.0.1${OPS_ROUTE}/)
rm -f ${headerFile}
printf '%s' "$BODY"
`,
  );
  const authedCode = (authed.match(/HTTPCODE:(\d+)/) || [])[1] || '';
  if (authedCode !== '200') {
    const logs = await exec(
      conn,
      `journalctl -u ${OPS_NAME} -n 40 --no-pager || true; echo '--- nginx ---'; tail -n 30 /var/log/nginx/error.log || true`,
    );
    throw new Error(`运维站登录后应为 200，实际 ${authedCode}\n${authed}\n${logs}`);
  }

  const gameStillPublic = await exec(
    conn,
    `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1${ROUTE}/ || true`,
  );
  if (gameStillPublic.trim() !== '200') {
    throw new Error(`游戏入口在运维站部署后应变为 200，实际 ${gameStillPublic.trim()}`);
  }
  console.log('[deploy] ops unauth=401 auth=200 game=200');
}

function sftpPut(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      sftp.fastPut(localPath, remotePath, (putErr) => {
        sftp.end();
        if (putErr) reject(putErr);
        else resolve();
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
