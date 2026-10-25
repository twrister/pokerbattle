import { SFX_DEFS, type SfxId } from './sfxManifest.js';

/**
 * 单个音效文件体积上限。
 * 短音效正常只有几十 KB，2MB 已经远超合理范围，挡住误传整首音乐。
 */
export const SFX_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** Ogg 容器魔数；引擎路径写死 .ogg，所以只收这个格式。 */
const OGG_MAGIC = 'OggS';

/** 上传结果：通过时返回音效 id，失败时返回给用户看的原因。 */
export type SfxUploadCheck =
  | { ok: true; id: SfxId }
  | { ok: false; error: string };

/**
 * 校验开发服音效上传请求。
 *
 * id 必须命中 SFX_DEFS 白名单：写盘路径由 id 拼出，
 * 只认枚举值才能杜绝 `../../` 这类路径穿越。
 */
export function validateSfxUpload(id: unknown, bytes: Uint8Array): SfxUploadCheck {
  if (typeof id !== 'string' || !isSfxId(id)) return { ok: false, error: '未知音效 id' };
  if (bytes.length === 0) return { ok: false, error: '文件为空' };
  if (bytes.length > SFX_UPLOAD_MAX_BYTES) {
    return { ok: false, error: `文件超过 ${Math.round(SFX_UPLOAD_MAX_BYTES / 1024)} KB` };
  }
  if (!matchesOggMagic(bytes)) return { ok: false, error: '只支持 .ogg（Ogg Vorbis）文件' };
  return { ok: true, id };
}

/** 白名单判定；用 hasOwn 避免 'constructor' 之类的原型键混进来。 */
export function isSfxId(value: string): value is SfxId {
  return Object.hasOwn(SFX_DEFS, value);
}

/** 前 4 字节是否为 OggS。 */
function matchesOggMagic(bytes: Uint8Array): boolean {
  if (bytes.length < OGG_MAGIC.length) return false;
  for (let i = 0; i < OGG_MAGIC.length; i++) {
    if (bytes[i] !== OGG_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}
