const POLL_MS = 2000;

const els = {
  processState: document.getElementById('process-state'),
  processPid: document.getElementById('process-pid'),
  processStarted: document.getElementById('process-started'),
  processUptime: document.getElementById('process-uptime'),
  message: document.getElementById('message'),
  metricOnlinePlayers: document.getElementById('metric-online-players'),
  metricRooms: document.getElementById('metric-rooms'),
  metricPlaying: document.getElementById('metric-playing'),
  metricMatchPlayers: document.getElementById('metric-match-players'),
  roomTbody: document.getElementById('room-tbody'),
  playerTbody: document.getElementById('player-tbody'),
  playerHint: document.getElementById('player-hint'),
  refreshHint: document.getElementById('refresh-hint'),
  opsUptime: document.getElementById('ops-uptime'),
  gameReachable: document.getElementById('game-reachable'),
  serviceEntries: document.getElementById('service-entries'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnRestart: document.getElementById('btn-restart'),
  btnDeploy: document.getElementById('btn-deploy'),
  btnClearPlayers: document.getElementById('btn-clear-players'),
  btnRestartOps: document.getElementById('btn-restart-ops'),
  btnToggleClear: document.getElementById('btn-toggle-clear'),
  playerClearCol: document.getElementById('player-clear-col'),
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
/** 最近一次玩家表行数与游戏服可达性，用来禁用「清空全部」。 */
let latestPlayerCount = 0;
let latestGameReachable = false;
let latestPlayers = [];
/** 危险清空默认隐藏，点「显示清空」后才露出。 */
let showClearActions = false;
/** 清空结果需短暂保留，避免 2s 轮询把失败原因冲掉。 */
let holdMessageUntil = 0;

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
  const playerRows = data.gameReachable ? (data.players ?? data.game?.players ?? []) : [];
  const onlineCount = playerRows.filter((player) => player.location && player.location !== 'offline').length;
  const matchPlayers = (data.game?.rooms ?? [])
    .filter((room) => room.phase === 'playing')
    .reduce((n, room) => n + (room.connectedCount ?? 0), 0);
  els.metricOnlinePlayers.textContent = data.gameReachable ? String(onlineCount) : '—';
  els.metricRooms.textContent = data.gameReachable ? String(summary?.roomCount ?? 0) : '—';
  els.metricPlaying.textContent = data.gameReachable ? String(summary?.playingRooms ?? 0) : '—';
  els.metricMatchPlayers.textContent = data.gameReachable ? String(matchPlayers) : '—';

  els.opsUptime.textContent = formatDuration(data.ops?.uptimeMs);
  els.gameReachable.textContent = data.gameReachable ? '可达' : '不可达';

  if (data.message) {
    showMessage(data.message, data.gameReachable && (state === 'running' || display.key === 'external'));
  } else if (!busy && Date.now() > holdMessageUntil) {
    hideMessage();
  }

  latestOps = data.ops ?? null;
  latestServices = Array.isArray(data.services) ? data.services : [];
  latestGameReachable = Boolean(data.gameReachable);
  latestPlayers = playerRows;
  latestPlayerCount = playerRows.length;
  renderServices(latestServices);
  renderRooms(data.game?.rooms ?? []);
  renderPlayers(playerRows);
  updateButtons(state, process);
  updateClearPlayersButton();
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

/** 渲染全部玩家；场次/胜率来自服务端历史，位置来自大厅、单机、房间或离线。 */
function renderPlayers(players) {
  const rows = Array.isArray(players) ? players : [];
  const onlineCount = rows.filter((player) => player.location && player.location !== 'offline').length;
  if (els.playerHint) {
    els.playerHint.textContent = rows.length
      ? `共 ${rows.length} 人 · 在线 ${onlineCount} 人`
      : '暂无玩家数据';
  }
  const colCount = showClearActions ? 9 : 8;
  if (!els.playerTbody) return;
  if (rows.length === 0) {
    els.playerTbody.innerHTML = `<tr><td colspan="${colCount}" class="empty">暂无玩家数据</td></tr>`;
    return;
  }
  els.playerTbody.innerHTML = rows
    .map((player) => {
      const matches = Number(player.matches) || 0;
      const winRate =
        matches > 0 && typeof player.winRate === 'number'
          ? `${(player.winRate * 100).toFixed(1)}%`
          : '—';
      const playerId = String(player.playerId || '');
      const disabled = busy || !playerId ? 'disabled' : '';
      const actionCell = showClearActions
        ? `<td>
          <button type="button" class="danger" data-action="clear-player" data-id="${escapeHtml(playerId)}" data-name="${escapeHtml(player.displayName || '')}" ${disabled}>清空</button>
        </td>`
        : '';
      return `<tr>
        <td>${escapeHtml(player.displayName)}</td>
        <td>${escapeHtml(formatPlayerLocation(player))}</td>
        <td class="muted">${escapeHtml(playerId || '—')}</td>
        <td>${matches}</td>
        <td>${Number(player.wins) || 0}</td>
        <td>${Number(player.losses) || 0}</td>
        <td>${winRate}</td>
        <td>${escapeHtml(formatLastOnline(player))}</td>
        ${actionCell}
      </tr>`;
    })
    .join('');
}

/** 同步「显示清空」开关与危险按钮显隐。 */
function applyClearActionsVisibility() {
  if (els.btnToggleClear) {
    els.btnToggleClear.textContent = showClearActions ? '隐藏清空' : '显示清空';
  }
  if (els.btnClearPlayers) els.btnClearPlayers.hidden = !showClearActions;
  if (els.playerClearCol) els.playerClearCol.hidden = !showClearActions;
}

/** 游戏服不可达或表空时禁用一键清空，避免空操作。 */
function updateClearPlayersButton() {
  applyClearActionsVisibility();
  if (!els.btnClearPlayers) return;
  els.btnClearPlayers.disabled = busy || !latestGameReachable || latestPlayerCount === 0;
}

/** 大厅、单机、「房号 房间名」或离线，方便运维对照房间表。 */
function formatPlayerLocation(player) {
  if (player.location === 'offline') return '离线';
  if (player.location === 'solo') return '单机模式';
  if (player.location === 'room') {
    const roomId = String(player.roomId ?? '').trim();
    const roomName = String(player.roomName ?? '').trim();
    if (roomId && roomName) return `${roomId} ${roomName}`;
    return roomId || roomName || '房间';
  }
  return '大厅';
}

/** 当前在线直接标「在线」，离线用相对时间。 */
function formatLastOnline(player) {
  if (player.location && player.location !== 'offline') return '在线';
  return formatRelative(player.lastOnlineAt);
}

function updateButtons(state, process = {}) {
  const external = Boolean(process.externalConflict);
  const disabled = busy || state === 'starting' || state === 'stopping';
  els.btnStart.disabled = disabled || state === 'running' || external;
  // 仅本站托管且有 pid 时可停/重启；外部占用不强制杀进程
  els.btnStop.disabled = disabled || external || !process.pid;
  els.btnRestart.disabled = disabled || external || !process.pid;
  updateClearPlayersButton();
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

/** 重启运维进程；本机不关游戏服，页面轮询到新进程后再恢复。 */
async function invokeRestartOps() {
  const ok = window.confirm(
    '确定重启运维站？页面会短暂断开并自动重连。本机已启动的游戏服不会被关掉，重启后可能显示为外部占用。',
  );
  if (!ok) return;
  if (els.btnRestartOps) els.btnRestartOps.disabled = true;
  holdMessageUntil = Date.now() + 30_000;
  showMessage('正在重启运维站…', true);
  try {
    const response = await fetch(resolveAppUrl('api/ops/restart'), {
      method: 'POST',
      credentials: 'same-origin',
    });
    const result = await response.json().catch(() => ({}));
    showMessage(
      result.message || (response.ok ? '运维站即将重启' : `重启失败（HTTP ${response.status}）`),
      response.ok,
    );
    if (!response.ok) {
      if (els.btnRestartOps) els.btnRestartOps.disabled = false;
      return;
    }
  } catch {
    showMessage('运维站正在重启…', true);
  }
  await waitForOpsResume();
  if (els.btnRestartOps) els.btnRestartOps.disabled = false;
}

/** 等新运维进程重新监听后再拉状态。 */
async function waitForOpsResume() {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const response = await fetch(resolveAppUrl('api/status'), {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) continue;
      holdMessageUntil = Date.now() + 8000;
      showMessage('运维站已重启', true);
      await refreshStatus();
      return;
    } catch {
      /* 端口尚未起来 */
    }
  }
  holdMessageUntil = Date.now() + 8000;
  showMessage('运维站重启超时，请手动刷新或重新执行 pnpm ops', false);
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

/** 清空服务端战绩；不传 playerId 则清全部。 */
async function invokeClearPlayers(playerId = null) {
  busy = true;
  updateClearPlayersButton();
  showMessage('正在清空玩家数据…', true);
  try {
    const path = playerId
      ? `api/players/${encodeURIComponent(playerId)}/clear`
      : 'api/players/clear';
    const response = await fetch(resolveAppUrl(path), {
      method: 'POST',
      credentials: 'same-origin',
    });
    const result = await response.json().catch(() => ({}));
    let text = result.message || (response.ok ? '已清空玩家数据' : `清空失败（HTTP ${response.status}）`);
    if (!response.ok && response.status === 404) {
      text = '清空接口不存在，请重启运维站（pnpm ops）后再试';
    }
    holdMessageUntil = Date.now() + 8000;
    showMessage(text, response.ok);
    await refreshStatus();
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '清空失败', false);
  } finally {
    busy = false;
    updateClearPlayersButton();
    await refreshStatus();
  }
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
els.btnRestartOps?.addEventListener('click', () => void invokeRestartOps());
els.btnToggleClear?.addEventListener('click', () => {
  showClearActions = !showClearActions;
  applyClearActionsVisibility();
  renderPlayers(latestPlayers);
  updateClearPlayersButton();
});
els.btnClearPlayers?.addEventListener('click', () => {
  if (busy || !latestGameReachable || latestPlayerCount === 0) return;
  const ok = window.confirm(
    `确定清空全部 ${latestPlayerCount} 名玩家的服务端战绩？此操作不可恢复，仅清除联机场次/胜负，不影响客户端本地档案。`,
  );
  if (ok) void invokeClearPlayers();
});
els.playerTbody?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.getAttribute('data-action') !== 'clear-player') return;
  if (busy) return;
  const playerId = target.getAttribute('data-id');
  if (!playerId) return;
  const name = target.getAttribute('data-name') || playerId;
  const ok = window.confirm(`确定清空「${name}」的服务端战绩？此操作不可恢复。`);
  if (ok) void invokeClearPlayers(playerId);
});

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
