import { describe, expect, it } from 'vitest';
import { SFX_DEFS, type SfxId } from '../src/audio/sfxManifest.js';
import { SFX_UPLOAD_MAX_BYTES, isSfxId, validateSfxUpload } from '../src/audio/sfxUploadRules.js';

/** 构造一段带 Ogg 魔数的假字节，够校验用。 */
function oggBytes(size = 16): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x4f, 0x67, 0x67, 0x53], 0);
  return bytes;
}

describe('音效上传校验', () => {
  it('合法 id + OggS 头通过', () => {
    expect(validateSfxUpload('ui_click', oggBytes())).toEqual({ ok: true, id: 'ui_click' });
  });

  it('拒绝白名单外的 id，防路径穿越', () => {
    expect(validateSfxUpload('../../server/index', oggBytes()).ok).toBe(false);
    expect(validateSfxUpload('constructor', oggBytes()).ok).toBe(false);
    expect(validateSfxUpload(null, oggBytes()).ok).toBe(false);
  });

  it('拒绝空文件与非 Ogg 文件', () => {
    expect(validateSfxUpload('ui_click', new Uint8Array()).ok).toBe(false);
    expect(validateSfxUpload('ui_click', new Uint8Array([0x52, 0x49, 0x46, 0x46])).ok).toBe(false);
  });

  it('超过体积上限时拒绝', () => {
    const tooBig = oggBytes(SFX_UPLOAD_MAX_BYTES + 1);
    const result = validateSfxUpload('ui_click', tooBig);
    expect(result.ok).toBe(false);
  });

  it('每个 SFX_DEFS 的 key 都被认作合法 id', () => {
    for (const id of Object.keys(SFX_DEFS) as SfxId[]) expect(isSfxId(id)).toBe(true);
    expect(isSfxId('not_a_sfx')).toBe(false);
  });
});
