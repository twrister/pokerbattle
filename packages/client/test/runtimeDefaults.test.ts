// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  builtInRuntimeDefaults,
  loadRuntimeDefaults,
  saveRuntimeDefaults,
} from '../src/debug/runtimeDefaults.js';

describe('运行控制默认参数', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('无本地记录时返回内置默认', () => {
    expect(loadRuntimeDefaults()).toEqual(builtInRuntimeDefaults());
  });

  it('保存后仍返回场景镜头默认，不对局节奏做本地覆盖', () => {
    saveRuntimeDefaults({
      cameraAngle: 60,
      viewBottomExtra: 10,
    });
    expect(loadRuntimeDefaults()).toEqual(builtInRuntimeDefaults());
  });

  it('旧版发牌间隔字段会被忽略', () => {
    localStorage.setItem(
      'pb.runtimeControls.defaults',
      JSON.stringify({
        cameraAngle: 45,
        viewBottomExtra: 8,
        normalDrawIntervalSeconds: 5,
        overtimeDrawIntervalSeconds: 1,
      }),
    );
    expect(loadRuntimeDefaults()).toEqual(builtInRuntimeDefaults());
  });
});
