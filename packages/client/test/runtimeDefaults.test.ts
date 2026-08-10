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
      drawIntervalSeconds: 5,
    });
    expect(loadRuntimeDefaults()).toEqual({
      cameraAngle: 60,
      viewBottomExtra: 10,
      drawIntervalSeconds: 5,
    });
  });

  it('非法值会被夹紧或回落', () => {
    saveRuntimeDefaults({
      cameraAngle: 999,
      viewBottomExtra: -3,
      drawIntervalSeconds: 0,
    });
    expect(loadRuntimeDefaults()).toEqual({
      cameraAngle: 90,
      viewBottomExtra: 0,
      drawIntervalSeconds: 0.25,
    });
  });
});
