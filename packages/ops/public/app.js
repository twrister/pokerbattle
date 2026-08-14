const POLL_MS = 2000;

const els = {
  processState: document.getElementById('process-state'),
  processPid: document.getElementById('process-pid'),
  processStarted: document.getElementById('process-started'),
  processUptime: document.getElementById('process-uptime'),
  message: document.getElementById('message'),
  metricConnections: document.getElementById('metric-connections'),
  metricRooms: document.getElementById('metric-rooms'),
  metricPlaying: document.getElementById('metric-playing'),
  metricOnline: document.getElementById('metric-online'),
  metricLobby: document.getElementById('metric-lobby'),
  roomTbody: document.getElementById('room-tbody'),
  refreshHint: document.getElementById('refresh-hint'),
  opsUptime: document.getElementById('ops-uptime'),
  gameReachable: document.getElementById('game-reachable'),
  serviceEntries: document.getElementById('service-entries'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnRestart: document.getElementById('btn-restart'),
  btnDeploy: document.getElementById('btn-deploy'),
  deployState: document.getElementById('deploy-state'),
  deployHint: document.getElementById('deploy-hint'),
  subtitle: document.getElementById('ops-subtitle'),
  entryHint: document.getElementById('entry-hint'),
  trustBanner: document.querySelector('.trust-banner'),
};

let busy = false;
let deployBusy = false;
let busyServiceId = null;
let pollTimer = null;
let latestServices = [];
/** 最近一次 /api/status 的 ops 段，重绘入口时用来解析局域网 IP。 */
let latestOps = null;
/** 最近一次成功复制的链接与时间，用于轮询重绘后保留按钮反馈。 */
let lastCopied = { url: '', at: 0 };

/** 相对当前页面目录解析 API/静态资源，兼容 /poker-battle-ops/ 子路径。 */
function resolveAppUrl(rel) {
  const path = String(rel ?? '').replace(/^\//, '');
  const dir = location.pathname.endsWith('/')
    ? location.pathname
    : location.pathname.replace(/[^/]+$/, '');
  return `${location.origin}${dir}${path}`;
}

/** 拉取聚合状态并刷新 UI。 */
async function refreshStatus() {
  try {
    const response = await fetch(resolveAppUrl('api/status'), {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (response.status === 401) throw new Error('需要登录');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    data.ops = data.ops ?? {};
    applyProductionChrome(data.ops);
    // 旧运维进程没有 lanIps 字段时，改读静态清单，避免入口继续显示 localhost
    if (!Array.isArray(data.ops.lanIps) || data.ops.lanIps.length === 0) {
      data.ops.lanIps = await fetchLanIpsFallback();
    }
    renderStatus(data);
    els.refreshHint.textContent = `上次刷新 ${formatTime(Date.now())}`;
  } catch (error) {
    els.refreshHint.textContent = '刷新失败';
    showMessage(error instanceof Error ? error.message : '状态刷新失败', false);
  }
}

/** 线上隐藏无鉴权提示，并改入口说明。 */
function applyProductionChrome(ops) {
  if (!ops?.production) return;
  if (els.trustBanner) els.trustBanner.hidden = true;
  if (els.subtitle) els.subtitle.textContent = '监测线上游戏服与房间 · systemd 托管';
  if (els.entryHint) els.entryHint.textContent = '游戏正式服 · 本页可 pnpm deploy';
  if (els.deployHint) els.deployHint.textContent = '服务器工作区构建后覆盖运行包，并重启游戏与运维站';
}

/** 读取 public/lan-ips.json；运维站未重启时接口没有局域网 IP。 */
async function fetchLanIpsFallback() {
  try {
    const response = await fetch(resolveAppUrl('lan-ips.json'), {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body?.lanIps) ? body.lanIps : [];
  } catch {
    return [];
  }
}

/** 将 /api/status 结果渲染到仪表盘。 */
function renderStatus(data) {
  const process = data.process ?? {};
  const state = process.state ?? 'stopped';
  const display = resolveDisplayState(process, data.gameReachable);
  els.processState.textContent = display.label;
  els.processState.className = `state-pill state-${display.key}`;
  els.processPid.textContent = process.pid ?? '—';
  els.processStarted.textContent = process.startedAt ? formatTime(process.startedAt) : '—';
  els.processUptime.textContent = formatDuration(process.uptimeMs);

  const summary = data.game?.summary;
  els.metricConnections.textContent = data.gameReachable ? String(data.game?.connectionCount ?? 0) : '—';
  els.metricRooms.textContent = data.gameReachable ? String(summary?.roomCount ?? 0) : '—';
  els.metricPlaying.textContent = data.gameReachable ? String(summary?.playingRooms ?? 0) : '—';
  els.metricOnline.textContent = data.gameReachable ? String(summary?.connectedPlayers ?? 0) : '—';
  els.metricLobby.textContent = data.gameReachable ? String(data.game?.lobbyPlayers ?? 0) : '—';

  els.opsUptime.textContent = formatDuration(data.ops?.uptimeMs);
  els.gameReachable.textContent = data.gameReachable ? '可达' : '不可达';

  if (data.message) {
    showMessage(data.message, data.gameReachable && (state === 'running' || display.key === 'external'));
  } else if (!busy) {
    hideMessage();
  }

  latestOps = data.ops ?? null;
  latestServices = Array.isArray(data.services) ? data.services : [];
  renderServices(latestServices);
  renderRooms(data.game?.rooms ?? []);
  updateButtons(state, process);
  renderDeploy(data.deploy);
}

/** 渲染开发服/正式服快速入口卡片。 */
function renderServices(services) {
  if (!services.length) {
    els.serviceEntries.innerHTML = '<div class="empty">暂无服务入口</div>';
    return;
  }

  const host = resolvePublicHost(latestOps);
  els.serviceEntries.innerHTML = services
    .map((service) => {
      const state = service.process?.state ?? 'stopped';
      const display = resolveDisplayState(service.process, service.reachable);
      const url = service.publicUrl || `http://${host}:${service.port}${service.path || '/'}`;
      const copied = isRecentlyCopied(url);
      const canOpen = Boolean(service.publicUrl) || Boolean(service.reachable);
      const busyThis = busy && busyServiceId === service.id;
      const external = Boolean(service.process?.externalConflict) || display.key === 'external';
      const transitioning =
        state === 'starting' || state === 'stopping' || state === 'building' || busyThis;
      const openOnly = Boolean(service.openOnly);
      const startDisabled = transitioning || state === 'running' || external;
      // 外部进程不由本站托管，禁止停止；无 pid 的 stopped 同样不可停
      const stopDisabled = transitioning || external || !service.process?.pid;
      const isOfficial = service.id === 'clientOfficial';
      const showDist = isOfficial || service.distBuiltAt != null;
      const distLine = showDist
        ? `<div class="dist-meta">${openOnly ? '部署' : 'dist'}：${
            service.distBuiltAt != null ? escapeHtml(formatTime(service.distBuiltAt)) : '尚未构建'
          }</div>`
        : '';
      const title = service.publicUrl
        ? escapeHtml(service.label)
        : `${escapeHtml(service.label)} · :${service.port}`;
      const controlButtons = openOnly
        ? ''
        : `<button type="button" data-action="start" data-id="${escapeHtml(service.id)}" ${startDisabled ? 'disabled' : ''}>启动</button>
          <button type="button" class="danger" data-action="stop" data-id="${escapeHtml(service.id)}" ${stopDisabled ? 'disabled' : ''}>停止</button>
          ${
            isOfficial
              ? `<button type="button" class="secondary" data-action="redeploy" data-id="${escapeHtml(service.id)}" ${transitioning || external ? 'disabled' : ''}>重新部署</button>`
              : ''
          }`;
      return `<article class="service-card" data-id="${escapeHtml(service.id)}">
        <div class="title-row">
          <h3>${title}</h3>
          <div class="state-pill state-${escapeHtml(display.key)}">${escapeHtml(display.label)}</div>
        </div>
        <p class="desc">${escapeHtml(service.description || '')}</p>
        <div class="url-row">
          <div class="url">${escapeHtml(url)}</div>
          <button type="button" class="copy-btn${copied ? ' copied' : ''}" data-action="copy" data-url="${escapeHtml(url)}" title="复制链接">${copied ? '已复制' : '复制'}</button>
        </div>
        ${distLine}
        <div class="reach ${service.reachable ? 'ok' : ''}">${service.reachable ? '端口可达' : '端口未监听'}</div>
        <div class="button-row">
          <a class="open-link ${canOpen ? '' : 'disabled'}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开</a>
          ${controlButtons}
        </div>
      </article>`;
    })
    .join('');
}

/**
 * 入口地址优先用局域网 IPv4：用 localhost 打开运维站时，复制出去的链接才能给其他设备用。
 * 若当前就是用某个非回环 IP 访问的，则沿用该 IP，避免多网卡时挑错。
 */
function resolvePublicHost(ops) {
  const hostname = location.hostname || '';
  const lanIps = Array.isArray(ops?.lanIps) ? ops.lanIps : [];
  if (isUsableIPv4(hostname) && !isLoopbackHost(hostname)) return hostname;
  if (lanIps.length > 0) return lanIps[0];
  return hostname || '127.0.0.1';
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/** 仅接受点分十进制 IPv4，排除 localhost 等主机名。 */
function isUsableIPv4(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * 把托管状态归一成展示文案：外部占用显示「外部运行」，避免误判为已停止。
 */
function resolveDisplayState(process, reachable) {
  const state = process?.state ?? 'stopped';
  if (state === 'building') {
    return { key: 'building', label: '构建中' };
  }
  const external =
    Boolean(process?.externalConflict) ||
    (Boolean(reachable) && !process?.pid && (state === 'stopped' || state === 'error'));
  if (external) {
    return { key: 'external', label: '外部运行' };
  }
  return { key: state, label: state };
}

/** 按阶段渲染房间表；无数据时展示占位行。 */
function renderRooms(rooms) {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    els.roomTbody.innerHTML = '<tr><td colspan="8" class="empty">暂无房间数据</td></tr>';
    return;
  }

  const ordered = [...rooms].sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || a.roomId.localeCompare(b.roomId));
  els.roomTbody.innerHTML = ordered
    .map((room) => {
      const players = (room.seats ?? [])
        .map(
          (seat) =>
            `<div class="seat ${seat.connected ? 'online' : ''}">#${seat.seat} ${escapeHtml(seat.name)} (${escapeHtml(seat.faction)}) ${seat.connected ? '在线' : '离线'}</div>`,
        )
        .join('');
      return `<tr>
        <td>${escapeHtml(room.roomId)}</td>
        <td>${escapeHtml(room.roomName)}</td>
        <td><span class="phase phase-${escapeHtml(room.phase)}">${phaseLabel(room.phase)}</span></td>
        <td>${room.serverTick ?? 0}</td>
        <td>${room.playerCount ?? 0}/${room.maxPlayers ?? 2}</td>
        <td>${room.connectedCount ?? 0}</td>
        <td><div class="seat-list">${players || '—'}</div></td>
        <td>${formatRelative(room.lastActiveAt)}</td>
      </tr>`;
    })
    .join('');
}

function updateButtons(state, process = {}) {
  const external = Boolean(process.externalConflict);
  const disabled = busy || state === 'starting' || state === 'stopping';
  els.btnStart.disabled = disabled || state === 'running' || external;
  // 仅本站托管且有 pid 时可停/重启；外部占用不强制杀进程
  els.btnStop.disabled = disabled || external || !process.pid;
  els.btnRestart.disabled = disabled || external || !process.pid;
}

/** 展示 pnpm deploy 进度；线上重启运维站后靠 /api/status.deploy 恢复结果。 */
function renderDeploy(deploy) {
  if (!els.btnDeploy || !els.deployState) return;
  const info = deploy ?? {};
  const running = Boolean(info.running);
  if (running) deployBusy = true;
  if (deployBusy && !running && info.lastOk != null) deployBusy = false;
  els.btnDeploy.disabled = running || deployBusy || info.available === false;
  // 旧运维进程没有 /api/status.deploy，发布会 404；提示必须可见，不能被 hideDeployMessage 清掉
  if (deploy == null) {
    els.btnDeploy.disabled = false;
    showDeployMessage('当前运维进程过旧，请重启 pnpm ops 后再发布', false);
    return;
  }
  if (running) {
    showDeployMessage('正在执行 pnpm deploy…', true);
    return;
  }
  if (info.available === false) {
    showDeployMessage('工作区未就绪，请先在开发机执行一次 pnpm deploy 以上传源码', false);
    return;
  }
  if (info.lastOk === true) {
    const when = info.lastFinishedAt ? `（${formatTime(info.lastFinishedAt)}）` : '';
    showDeployMessage(`pnpm deploy 已完成${when}`, true);
    return;
  }
  if (info.lastOk === false) {
    showDeployMessage(info.lastError || 'pnpm deploy 失败', false);
    return;
  }
  if (!deployBusy) hideDeployMessage();
}

function showDeployMessage(text, info) {
  els.deployState.hidden = false;
  els.deployState.textContent = text;
  els.deployState.classList.toggle('info', Boolean(info));
}

function hideDeployMessage() {
  els.deployState.hidden = true;
  els.deployState.textContent = '';
  els.deployState.classList.remove('info');
}

/** 触发发布后继续轮询；线上重启可能导致本次 POST 被掐断。 */
async function invokeDeploy() {
  deployBusy = true;
  if (els.btnDeploy) els.btnDeploy.disabled = true;
  showDeployMessage('已开始 pnpm deploy…', true);
  try {
    const response = await fetch(resolveAppUrl('api/deploy'), {
      method: 'POST',
      credentials: 'same-origin',
    });
    const result = await response.json().catch(() => ({}));
    const text = result.message || (response.ok ? '已开始 pnpm deploy' : `启动失败（HTTP ${response.status}）`);
    showDeployMessage(text, response.ok);
    if (!response.ok) deployBusy = false;
  } catch {
    showDeployMessage('发布进行中，运维站可能短暂重启…', true);
  }
  await refreshStatus();
}

/** 调用启停接口，期间禁用按钮避免重复点击。 */
async function invokeControl(path, serviceId = null) {
  busy = true;
  busyServiceId = serviceId;
  updateButtons('starting');
  renderServices(latestServices);
  showMessage('操作执行中…', true);
  try {
    const response = await fetch(resolveAppUrl(path), {
      method: 'POST',
      credentials: 'same-origin',
    });
    const result = await response.json().catch(() => ({}));
    const text = result.message || (response.ok ? '操作成功' : `操作失败（HTTP ${response.status}）`);
    showMessage(text, response.ok);
    await refreshStatus();
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '操作失败', false);
  } finally {
    busy = false;
    busyServiceId = null;
    await refreshStatus();
  }
}

function showMessage(text, info) {
  els.message.hidden = false;
  els.message.textContent = text;
  els.message.classList.toggle('info', Boolean(info));
}

function hideMessage() {
  els.message.hidden = true;
  els.message.textContent = '';
  els.message.classList.remove('info');
}

function phaseLabel(phase) {
  if (phase === 'playing') return '对局中';
  if (phase === 'ended') return '已结束';
  return '等待中';
}

function phaseRank(phase) {
  if (phase === 'playing') return 0;
  if (phase === 'waiting') return 1;
  return 2;
}

function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(ms) {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

function formatRelative(ms) {
  if (!ms) return '—';
  const delta = Date.now() - ms;
  if (delta < 5_000) return '刚刚';
  if (delta < 60_000) return `${Math.floor(delta / 1000)} 秒前`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  return formatTime(ms);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 判断该链接是否仍在「已复制」反馈窗口内。 */
function isRecentlyCopied(url) {
  return lastCopied.url === url && Date.now() - lastCopied.at < 1500;
}

/** 将服务入口链接写入剪贴板；反馈状态写入 lastCopied，避免轮询重绘冲掉。 */
async function copyUrl(url) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      // 非安全上下文等场景下回退到 execCommand
      const input = document.createElement('textarea');
      input.value = url;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    const copiedAt = Date.now();
    lastCopied = { url, at: copiedAt };
    renderServices(latestServices);
    setTimeout(() => {
      if (lastCopied.at !== copiedAt) return;
      lastCopied = { url: '', at: 0 };
      renderServices(latestServices);
    }, 1500);
  } catch {
    showMessage('复制失败，请手动选择地址', false);
  }
}

els.btnStart.addEventListener('click', () => invokeControl('api/server/start'));
els.btnStop.addEventListener('click', () => invokeControl('api/server/stop'));
els.btnRestart.addEventListener('click', () => invokeControl('api/server/restart'));
els.btnDeploy?.addEventListener('click', () => void invokeDeploy());

els.serviceEntries.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.getAttribute('data-action');
  if (!action) return;
  if (action === 'copy') {
    const url = target.getAttribute('data-url');
    if (url) void copyUrl(url);
    return;
  }
  const id = target.getAttribute('data-id');
  if (!id) return;
  void invokeControl(`api/services/${id}/${action}`, id);
});

await refreshStatus();
pollTimer = setInterval(() => {
  if (!busy || deployBusy) void refreshStatus();
}, POLL_MS);

window.addEventListener('beforeunload', () => {
  if (pollTimer) clearInterval(pollTimer);
});
