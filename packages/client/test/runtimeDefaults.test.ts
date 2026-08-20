// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultMatchRulesView } from '../src/debug/matchRulesView.js';
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

  it('对局节奏始终读 sim 草稿，不再沿用 localStorage', () => {
    localStorage.setItem(
      'pb.runtimeControls.defaults',
      JSON.stringify({
        cameraAngle: 60,
        viewBottomExtra: 10,
        matchRules: {
          ...defaultMatchRulesView(),
          normalPhaseSeconds: 30,
        },
      }),
    );
    expect(loadRuntimeDefaults().matchRules).toEqual(defaultMatchRulesView());
    expect(loadRuntimeDefaults().cameraAngle).toBe(builtInRuntimeDefaults().cameraAngle);
  });

  it('保存镜头不会改写对局节奏', () => {
    saveRuntimeDefaults({
      cameraAngle: 60,
      viewBottomExtra: 10,
    });
    expect(loadRuntimeDefaults().matchRules).toEqual(defaultMatchRulesView());
  });

  it('旧版扁平发牌间隔字段会被忽略', () => {
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
