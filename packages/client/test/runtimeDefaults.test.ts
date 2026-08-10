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

  it('保存后再次加载沿用写入值', () => {
    saveRuntimeDefaults({
      cameraAngle: 60,
      viewBottomExtra: 10,
      normalDrawIntervalSeconds: 5,
      doubleSpeedDrawIntervalSeconds: 2.5,
      overtimeDrawIntervalSeconds: 1,
    });
    expect(loadRuntimeDefaults()).toEqual({
      cameraAngle: 60,
      viewBottomExtra: 10,
      normalDrawIntervalSeconds: 5,
      doubleSpeedDrawIntervalSeconds: 2.5,
      overtimeDrawIntervalSeconds: 1,
    });
  });

  it('非法值会被夹紧或回落', () => {
    saveRuntimeDefaults({
      cameraAngle: 999,
      viewBottomExtra: -3,
      normalDrawIntervalSeconds: 0,
      doubleSpeedDrawIntervalSeconds: 999,
      overtimeDrawIntervalSeconds: Number.NaN,
    });
    expect(loadRuntimeDefaults()).toEqual({
      cameraAngle: 90,
      viewBottomExtra: 0,
      normalDrawIntervalSeconds: 0.25,
      doubleSpeedDrawIntervalSeconds: 60,
      overtimeDrawIntervalSeconds: builtInRuntimeDefaults().overtimeDrawIntervalSeconds,
    });
  });

  it('旧版单一发牌间隔字段会被忽略并回落三阶段默认', () => {
    localStorage.setItem(
      'pb.runtimeControls.defaults',
      JSON.stringify({
        cameraAngle: 45,
        viewBottomExtra: 8,
        drawIntervalSeconds: 5,
      }),
    );
    expect(loadRuntimeDefaults()).toEqual({
      cameraAngle: 45,
      viewBottomExtra: 8,
      normalDrawIntervalSeconds: 6,
      doubleSpeedDrawIntervalSeconds: 3,
      overtimeDrawIntervalSeconds: 2,
    });
  });
});
