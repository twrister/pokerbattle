// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerProfile } from '../src/account/types.js';
import { createFeedbackForm } from '../src/ui/feedbackForm.js';

vi.mock('../src/env.js', () => ({
  IS_DEV_SERVER: false,
  APP_VERSION: '0.1.5',
  formatLobbyVersion: (version: string) => `v${version.trim().replace(/^v/i, '') || '0.0.0'}`,
}));

function buildProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    schemaVersion: 2,
    deviceAccountId: 'device-ui',
    displayName: '测试玩家',
    createdAt: 1,
    updatedAt: 1,
    battleScore: 0,
    exp: 0,
    currentStageId: null,
    stats: { wins: 0, losses: 0, draws: 0, stageAttempts: 0, stageClears: 0 },
    recentBattles: [],
    recentStageChallenges: [],
    ...overrides,
  };
}

function mountDom(): void {
  document.body.innerHTML = `
    <button id="btn-feedback-open" type="button" aria-expanded="false" aria-controls="feedback-dialog">提意见</button>
    <div id="feedback-dialog" class="is-hidden" aria-hidden="true">
      <button data-feedback-close type="button">关闭</button>
      <form id="feedback-form">
        <textarea id="feedback-input" maxlength="500"></textarea>
        <p id="feedback-status"></p>
        <button id="btn-feedback-cancel" type="button" data-feedback-close>取消</button>
        <button id="btn-feedback-submit" type="submit">提交</button>
      </form>
    </div>
  `;
}

describe('意见反馈表单', () => {
  beforeEach(() => {
    mountDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('点提意见打开弹层，再点取消收起', () => {
    createFeedbackForm({ getProfile: () => buildProfile() });
    const dialog = document.querySelector('#feedback-dialog')!;
    const toggle = document.querySelector<HTMLButtonElement>('#btn-feedback-open')!;

    toggle.click();
    expect(dialog.classList.contains('is-hidden')).toBe(false);
    expect(dialog.getAttribute('aria-hidden')).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    document.querySelector<HTMLButtonElement>('#btn-feedback-cancel')!.click();
    expect(dialog.classList.contains('is-hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('空内容拒绝提交且不发请求', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    createFeedbackForm({ getProfile: () => buildProfile() });

    document.querySelector<HTMLButtonElement>('#btn-feedback-open')!.click();
    document.querySelector<HTMLButtonElement>('#btn-feedback-submit')!.click();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('#feedback-status')?.textContent).toBe('请填写意见内容');
    expect(document.querySelector('#feedback-status')?.classList.contains('is-error')).toBe(true);
  });

  it('提交成功后清空正文、收起并提示感谢', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    createFeedbackForm({ getProfile: () => buildProfile() });

    document.querySelector<HTMLButtonElement>('#btn-feedback-open')!.click();
    const input = document.querySelector<HTMLTextAreaElement>('#feedback-input')!;
    input.value = '  希望加观战音效  ';
    document.querySelector<HTMLButtonElement>('#btn-feedback-submit')!.click();

    await vi.waitFor(() => {
      expect(document.querySelector('#feedback-status')?.textContent).toBe('已收到，感谢反馈');
    });
    expect(input.value).toBe('');
    expect(document.querySelector('#feedback-dialog')?.classList.contains('is-hidden')).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/feedback');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      content: '希望加观战音效',
      playerId: 'device-ui',
      displayName: '测试玩家',
      appVersion: '0.1.5',
    });
  });

  it('提交失败时保留输入并展示错误', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, message: '提交过于频繁，请稍后再试' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    createFeedbackForm({ getProfile: () => buildProfile() });

    document.querySelector<HTMLButtonElement>('#btn-feedback-open')!.click();
    const input = document.querySelector<HTMLTextAreaElement>('#feedback-input')!;
    input.value = '再提一条';
    document.querySelector<HTMLButtonElement>('#btn-feedback-submit')!.click();

    await vi.waitFor(() => {
      expect(document.querySelector('#feedback-status')?.textContent).toBe('提交过于频繁，请稍后再试');
    });
    expect(document.querySelector('#feedback-status')?.classList.contains('is-error')).toBe(true);
    expect(input.value).toBe('再提一条');
    expect(document.querySelector('#feedback-dialog')?.classList.contains('is-hidden')).toBe(false);
  });
});
