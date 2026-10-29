import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { validatePatchNotes } from './src/data/patchNotes.js';
import { SFX_DEFS } from './src/audio/sfxManifest.js';
import { SFX_UPLOAD_MAX_BYTES, validateSfxUpload } from './src/audio/sfxUploadRules.js';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
/** 音效文件的唯一落盘目录；替换音效直接覆盖这里的同名 .ogg */
const sfxDirPath = path.resolve(clientDir, 'public/sfx');
/** monorepo 内 sim 兵种配置的唯一落盘路径 */
const unitsJsonPath = path.resolve(clientDir, '../sim/src/config/units.json');
/** monorepo 内牌型阵型配置的唯一落盘路径 */
const cardFormationsJsonPath = path.resolve(clientDir, '../sim/src/config/cardFormations.json');
/** monorepo 内特殊兵种档位表的唯一落盘路径 */
const specialTiersJsonPath = path.resolve(clientDir, '../sim/src/config/specialTiers.json');
/** monorepo 内场景配置的唯一落盘路径 */
const arenaJsonPath = path.resolve(clientDir, '../sim/src/config/arena.json');
const arena2v2JsonPath = path.resolve(clientDir, '../sim/src/config/arena2v2.json');
/** 大厅更新公告的唯一落盘路径 */
const patchNotesJsonPath = path.resolve(clientDir, 'src/data/patchNotes.json');
/** monorepo 内对局节奏配置的唯一落盘路径 */
const matchRulesJsonPath = path.resolve(clientDir, '../sim/src/config/matchRules.json');
/** monorepo 内无限防守出兵窗口配置的唯一落盘路径 */
const endlessJsonPath = path.resolve(clientDir, '../sim/src/config/endless.json');

/** 开发服务器：GET 读盘最新 units.json，POST 覆盖写回。 */
function unitConfigWritePlugin(): Plugin {
  return {
    name: 'pb-unit-config-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/unit-configs') {
          next();
          return;
        }
        if (req.method === 'GET') {
          try {
            const text = fs.readFileSync(unitsJsonPath, 'utf8');
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              sendJson(res, 500, { error: 'units.json is not valid JSON' });
              return;
            }
            sendJson(res, 200, parsed);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          }
          return;
        }
        if (req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              sendJson(res, 400, { error: 'body must be a JSON object' });
              return;
            }
            const text = `${JSON.stringify(parsed, null, 2)}\n`;
            fs.writeFileSync(unitsJsonPath, text, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

/** 开发服务器：接收卡组页保存请求，覆盖 specialTiers.json。 */
function specialTierWritePlugin(): Plugin {
  return {
    name: 'pb-special-tier-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/special-tiers' || req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              sendJson(res, 400, { error: 'body must be a JSON object' });
              return;
            }
            fs.writeFileSync(specialTiersJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

/** 开发服务器：接收卡组页保存请求，覆盖 cardFormations.json。 */
function cardFormationWritePlugin(): Plugin {
  return {
    name: 'pb-card-formation-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/card-formations' || req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              sendJson(res, 400, { error: 'body must be a JSON object' });
              return;
            }
            fs.writeFileSync(cardFormationsJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

/** 收集 POST body 文本 */
function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

/** 开发服务器：接收场景配置页保存请求，覆盖 arena.json。 */
function arenaConfigWritePlugin(): Plugin {
  return {
    name: 'pb-arena-config-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/arena-config' || req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            const wrapped = parsed as { mode?: unknown; draft?: unknown };
            const mode = wrapped.mode === '2v2' ? '2v2' : wrapped.mode === '1v1' ? '1v1' : null;
            const draft = mode && wrapped.draft ? wrapped.draft : parsed;
            const validationError = validateArenaConfigBody(draft);
            if (validationError) {
              sendJson(res, 400, { error: validationError });
              return;
            }
            const target = mode === '2v2' ? arena2v2JsonPath : arenaJsonPath;
            fs.writeFileSync(target, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** 开发服务器：GET 读盘最新 patchNotes.json，POST 覆盖写回。 */
function patchNotesWritePlugin(): Plugin {
  return {
    name: 'pb-patch-notes-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/patch-notes') {
          next();
          return;
        }
        if (req.method === 'GET') {
          try {
            const text = fs.readFileSync(patchNotesJsonPath, 'utf8');
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              sendJson(res, 500, { error: 'patchNotes.json is not valid JSON' });
              return;
            }
            sendJson(res, 200, parsed);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          }
          return;
        }
        if (req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            const validationError = validatePatchNotes(parsed);
            if (validationError) {
              sendJson(res, 400, { error: validationError });
              return;
            }
            fs.writeFileSync(patchNotesJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

/** 开发服务器：GET 读盘最新 matchRules.json，POST 覆盖写回。 */
function matchRulesWritePlugin(): Plugin {
  return {
    name: 'pb-match-rules-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/match-rules') {
          next();
          return;
        }
        if (req.method === 'GET') {
          try {
            const text = fs.readFileSync(matchRulesJsonPath, 'utf8');
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              sendJson(res, 500, { error: 'matchRules.json is not valid JSON' });
              return;
            }
            sendJson(res, 200, parsed);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          }
          return;
        }
        if (req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            const validationError = validateMatchRulesBody(parsed);
            if (validationError) {
              sendJson(res, 400, { error: validationError });
              return;
            }
            fs.writeFileSync(matchRulesJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

/** 开发服务器：GET 读盘最新 endless.json，POST 覆盖写回。 */
function endlessConfigWritePlugin(): Plugin {
  return {
    name: 'pb-endless-config-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pb/endless-config') {
          next();
          return;
        }
        if (req.method === 'GET') {
          try {
            const text = fs.readFileSync(endlessJsonPath, 'utf8');
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              sendJson(res, 500, { error: 'endless.json is not valid JSON' });
              return;
            }
            sendJson(res, 200, parsed);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          }
          return;
        }
        if (req.method !== 'POST') {
          next();
          return;
        }
        readRequestBody(req)
          .then((raw) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON' });
              return;
            }
            const validationError = validateEndlessConfigBody(parsed);
            if (validationError) {
              sendJson(res, 400, { error: validationError });
              return;
            }
            fs.writeFileSync(endlessJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
            sendJson(res, 200, { ok: true });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 500, { error: message });
          });
      });
    },
  };
}

/** 写盘前做结构校验，避免把残缺场景配置写进 arena.json。 */
function validateArenaConfigBody(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'body must be a JSON object';
  const draft = value as {
    width?: unknown;
    height?: unknown;
    riverWidth?: unknown;
    bridges?: unknown;
    bridge3Enabled?: unknown;
    bases?: unknown;
    camera?: { mode?: unknown };
    colors?: unknown;
  };
  if (!Number.isInteger(draft.width) || (draft.width as number) <= 0) return 'width must be a positive integer';
  if (!Number.isInteger(draft.height) || (draft.height as number) <= 0) return 'height must be a positive integer';
  if (!Number.isInteger(draft.riverWidth) || (draft.riverWidth as number) <= 0) {
    return 'riverWidth must be a positive integer';
  }
  if (!Array.isArray(draft.bridges) || draft.bridges.length === 0) return 'bridges must be a non-empty array';
  if (draft.bridge3Enabled !== undefined && typeof draft.bridge3Enabled !== 'boolean') {
    return 'bridge3Enabled must be a boolean';
  }
  if (draft.bases !== undefined && !Array.isArray(draft.bases)) return 'bases must be an array';
  if (draft.camera?.mode !== 'ortho' && draft.camera?.mode !== 'perspective') {
    return 'camera.mode must be ortho or perspective';
  }
  if (!draft.colors || typeof draft.colors !== 'object') return 'colors must be an object';
  return undefined;
}

const MATCH_RULES_NUMBER_KEYS = [
  'initialHandSize',
  'normalPhaseSeconds',
  'doubleSpeedPhaseSeconds',
  'finalPhaseSeconds',
  'settlementPhaseSeconds',
  'finalUnitTimeScale',
  'normalDrawIntervalSeconds',
  'doubleSpeedDrawIntervalSeconds',
  'finalDrawIntervalSeconds',
  'normalHandLimit',
  'doubleSpeedHandLimit',
  'finalHandLimit',
] as const;

/** 写盘前确认对局节奏字段齐全且为有限数字。 */
function validateMatchRulesBody(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'body must be a JSON object';
  const rec = value as Record<string, unknown>;
  for (const key of MATCH_RULES_NUMBER_KEYS) {
    if (typeof rec[key] !== 'number' || !Number.isFinite(rec[key])) {
      return `${key} must be a finite number`;
    }
  }
  // 万能牌开关允许缺省（旧文件），存在则必须是布尔值
  if (rec.wildCardsEnabled !== undefined && typeof rec.wildCardsEnabled !== 'boolean') {
    return 'wildCardsEnabled must be a boolean';
  }
  return undefined;
}

/**
 * 写盘前确认出兵窗口与每波覆盖项合法。
 * 这里手写一份区间而不是复用 sim 的校验：vite 配置加载器不认 endlessConfig 里的 JSON 导入。
 */
const ENDLESS_WAVE_SECONDS_MIN = 30;
const ENDLESS_WAVE_SECONDS_MAX = 600;
const ENDLESS_WAVE_INTERVAL_MIN = 6;
const ENDLESS_WAVE_INTERVAL_MAX = 60;
const ENDLESS_WAVE_BUDGET_MIN = 1;
const ENDLESS_WAVE_BUDGET_MAX = 999;
const ENDLESS_UNIT_WEIGHT_MIN = 0.5;
const ENDLESS_UNIT_WEIGHT_MAX = 20;
const ENDLESS_WAVE_ROWS_MAX = 60;
const ENDLESS_WAVE_UNITS_MAX = 12;

function validateEndlessConfigBody(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'body must be a JSON object';
  const rec = value as Record<string, unknown>;
  const seconds = rec.waveSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return 'waveSeconds must be a finite number';
  }
  if (seconds < ENDLESS_WAVE_SECONDS_MIN || seconds > ENDLESS_WAVE_SECONDS_MAX) {
    return `waveSeconds must be between ${ENDLESS_WAVE_SECONDS_MIN} and ${ENDLESS_WAVE_SECONDS_MAX}`;
  }
  if (rec.waves === undefined) return undefined;
  if (!Array.isArray(rec.waves)) return 'waves must be an array';
  return validateEndlessWaves(rec.waves);
}

/** 逐条校验每波覆盖；错误信息带波号，方便从 dev 面板直接定位。 */
function validateEndlessWaves(waves: readonly unknown[]): string | undefined {
  for (const raw of waves) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'each wave must be an object';
    const wave = raw as Record<string, unknown>;
    if (!Number.isInteger(wave.wave) || (wave.wave as number) < 1 || (wave.wave as number) > ENDLESS_WAVE_ROWS_MAX) {
      return `wave must be an integer between 1 and ${ENDLESS_WAVE_ROWS_MAX}`;
    }
    const label = `wave ${String(wave.wave)}`;
    const ranges: Array<[string, number, number]> = [
      ['waveSeconds', ENDLESS_WAVE_SECONDS_MIN, ENDLESS_WAVE_SECONDS_MAX],
      ['budget', ENDLESS_WAVE_BUDGET_MIN, ENDLESS_WAVE_BUDGET_MAX],
      ['intervalSeconds', ENDLESS_WAVE_INTERVAL_MIN, ENDLESS_WAVE_INTERVAL_MAX],
    ];
    for (const [key, min, max] of ranges) {
      const field = wave[key];
      if (field === undefined) continue;
      if (typeof field !== 'number' || !Number.isFinite(field)) return `${label} ${key} must be a finite number`;
      if (field < min || field > max) return `${label} ${key} must be between ${min} and ${max}`;
    }
    const units = wave.units;
    if (units === undefined) continue;
    if (!Array.isArray(units)) return `${label} units must be an array`;
    if (units.length > ENDLESS_WAVE_UNITS_MAX) return `${label} units exceeds ${ENDLESS_WAVE_UNITS_MAX}`;
    for (const unitRaw of units) {
      if (!unitRaw || typeof unitRaw !== 'object' || Array.isArray(unitRaw)) {
        return `${label} each unit must be an object`;
      }
      const unit = unitRaw as Record<string, unknown>;
      if (typeof unit.typeId !== 'string' || unit.typeId.length === 0) {
        return `${label} unit typeId must be a non-empty string`;
      }
      if (typeof unit.weight !== 'number' || !Number.isFinite(unit.weight)) {
        return `${label} unit ${unit.typeId} weight must be a finite number`;
      }
      if (unit.weight < ENDLESS_UNIT_WEIGHT_MIN || unit.weight > ENDLESS_UNIT_WEIGHT_MAX) {
        return `${label} unit ${unit.typeId} weight must be between ${ENDLESS_UNIT_WEIGHT_MIN} and ${ENDLESS_UNIT_WEIGHT_MAX}`;
      }
    }
  }
  return undefined;
}

/**
 * 开发服务器：POST /__pb/sfx?id=<SfxId> 覆盖写回 public/sfx 下的音效文件。
 * body 直接用原始二进制（不套 JSON），音频体积大，省一层 base64 膨胀。
 */
function sfxWritePlugin(): Plugin {
  return {
    name: 'pb-sfx-write',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost');
        if (requestUrl.pathname !== '/__pb/sfx') {
          next();
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'only POST is supported' });
          return;
        }
        readRawBody(req, SFX_UPLOAD_MAX_BYTES + 1)
          .then((bytes) => {
            const check = validateSfxUpload(requestUrl.searchParams.get('id'), bytes);
            if (!check.ok) {
              sendJson(res, 400, { error: check.error });
              return;
            }
            // 文件名只由白名单 id 派生，路径不可能越出 sfx 目录
            const target = path.join(sfxDirPath, `${SFX_DEFS[check.id].file}.ogg`);
            fs.writeFileSync(target, bytes);
            sendJson(res, 200, { ok: true, id: check.id, bytes: bytes.length });
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, message === 'too large' ? 413 : 500, { error: message });
          });
      });
    },
  };
}

/** 收集原始二进制 body；超过上限时立刻中断，避免把大文件读进内存。 */
function readRawBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 开发服与正式预览共用：把同源 /ws 转到权威服，前端无需写死双端口。 */
const wsProxy = {
  '/ws': { target: 'ws://localhost:9090', ws: true },
} as const;

/** 开发服与正式预览共用：把同源意见接口转到权威服。 */
const httpApiProxy = {
  '/feedback': { target: 'http://localhost:9090' },
} as const;

/** 部署到子路径时由 VITE_PUBLIC_BASE 注入（如 /poker-battle），本地开发保持根路径。 */
function resolvePublicBase(): string {
  const raw = process.env.VITE_PUBLIC_BASE?.trim();
  if (!raw) return '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/** 部署脚本传入 VITE_APP_VERSION；本地开发回落根 package.json。 */
function resolveAppVersion(): string {
  const fromEnv = process.env.VITE_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(clientDir, '../../package.json'), 'utf8')) as {
      version?: unknown;
    };
    if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim();
  } catch {
    /* 回落默认种子 */
  }
  return '0.1.0';
}

export default defineConfig({
  base: resolvePublicBase(),
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(resolveAppVersion()),
  },
  plugins: [
    unitConfigWritePlugin(),
    cardFormationWritePlugin(),
    specialTierWritePlugin(),
    arenaConfigWritePlugin(),
    patchNotesWritePlugin(),
    matchRulesWritePlugin(),
    endlessConfigWritePlugin(),
    sfxWritePlugin(),
  ],
  // 开发服：host: true 监听所有网卡，局域网可访问；开放配置写回等调试能力
  server: {
    host: true,
    port: 9081,
    open: true,
    proxy: { ...wsProxy, ...httpApiProxy },
  },
  // 与 sim 一样直接吃 TS 源码，改协议可热更新
  optimizeDeps: { exclude: ['@pb/sim', '@pb/net'] },
  // 正式服：预览 build 产物；监听全部网卡并代理 /ws，供局域网经 IP 访问
  preview: {
    host: '0.0.0.0',
    port: 9080,
    strictPort: true,
    // 允许机器名访问；纯 IP 默认已放行
    allowedHosts: true,
    proxy: { ...wsProxy, ...httpApiProxy },
  },
  build: { target: 'es2022' },
});
