import type { PlayerProfile } from '../account/types.js';
import { APP_VERSION } from '../env.js';
import { submitFeedback } from '../net/feedback.js';

export interface FeedbackFormOptions {
  getProfile: () => PlayerProfile;
  /** 打开前收起其他大厅弹层，避免叠在一起。 */
  onBeforeOpen?: () => void;
}

export interface FeedbackFormHandle {
  collapse(): void;
  dispose(): void;
}

/** 大厅顶栏「提意见」弹层：玩家只填正文，身份与版本由档案自动附带。 */
export function createFeedbackForm(options: FeedbackFormOptions): FeedbackFormHandle {
  const dialog = required<HTMLElement>('#feedback-dialog');
  const toggle = required<HTMLButtonElement>('#btn-feedback-open');
  const form = required<HTMLFormElement>('#feedback-form', dialog);
  const input = required<HTMLTextAreaElement>('#feedback-input', form);
  const cancel = required<HTMLButtonElement>('#btn-feedback-cancel', form);
  const submit = required<HTMLButtonElement>('#btn-feedback-submit', form);
  const statusEl = required<HTMLElement>('#feedback-status', dialog);
  const closeButtons = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>('[data-feedback-close]'),
  );

  let submitting = false;

  const expand = (): void => {
    options.onBeforeOpen?.();
    dialog.classList.remove('is-hidden');
    dialog.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
    setStatus('', false);
    input.focus();
  };

  const collapse = (): void => {
    if (submitting) return;
    dialog.classList.add('is-hidden');
    dialog.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
  };

  const toggleForm = (): void => {
    if (dialog.classList.contains('is-hidden')) {
      expand();
      return;
    }
    collapse();
  };

  const onSubmit = (event: Event): void => {
    event.preventDefault();
    if (submitting) return;
    const content = input.value.trim();
    if (!content) {
      setStatus('请填写意见内容', true);
      return;
    }
    const profile = options.getProfile();
    submitting = true;
    submit.disabled = true;
    cancel.disabled = true;
    setStatus('正在提交…', false);
    void submitFeedback({
      content,
      playerId: profile.deviceAccountId,
      displayName: profile.displayName,
      appVersion: APP_VERSION,
    }).then((result) => {
      submitting = false;
      submit.disabled = false;
      cancel.disabled = false;
      if (!result.ok) {
        setStatus(result.error, true);
        return;
      }
      input.value = '';
      collapse();
      setStatus('已收到，感谢反馈', false);
    });
  };

  function setStatus(text: string, isError: boolean): void {
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', isError);
  }

  toggle.addEventListener('click', toggleForm);
  form.addEventListener('submit', onSubmit);
  for (const button of closeButtons) {
    button.addEventListener('click', collapse);
  }

  return {
    collapse,
    dispose() {
      toggle.removeEventListener('click', toggleForm);
      form.removeEventListener('submit', onSubmit);
      for (const button of closeButtons) {
        button.removeEventListener('click', collapse);
      }
    },
  };
}

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`意见反馈缺少元素：${selector}`);
  return element;
}
