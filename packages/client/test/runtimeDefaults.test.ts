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

  it('保存后镜头仍读场景配置，对局节奏沿用本地默认', () => {
    const matchRules = {
      ...defaultMatchRulesView(),
      normalPhaseSeconds: 30,
      doubleSpeedPhaseSeconds: 40,
      finalPhaseSeconds: 50,
      settlementPhaseSeconds: 20,
    };
    saveRuntimeDefaults({
      cameraAngle: 60,
      viewBottomExtra: 10,
      matchRules,
    });
    expect(loadRuntimeDefaults()).toEqual({
      ...builtInRuntimeDefaults(),
      matchRules,
    });
  });

  it('只保存镜头时保留已写入的对局节奏', () => {
    const matchRules = {
      ...defaultMatchRulesView(),
      normalPhaseSeconds: 30,
    };
    saveRuntimeDefaults({
      cameraAngle: 60,
      viewBottomExtra: 10,
      matchRules,
    });
    saveRuntimeDefaults({
      cameraAngle: 45,
      viewBottomExtra: 8,
    });
    expect(loadRuntimeDefaults().matchRules).toEqual(matchRules);
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
