// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { enableUnitSelection } from '../src/input/unitSelection.js';

function fakeCanvas(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => {} });
  return el;
}

function topDownCamera(): THREE.Camera {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 20, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

function firePointer(target: HTMLElement, type: 'pointerdown' | 'pointerup', x: number, y: number, timeStamp: number): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  target.dispatchEvent(event);
  return event;
}

describe('单位点选', () => {
  it('短点击命中单位时选中，并拦住后续放兵监听', () => {
    const canvas = fakeCanvas();
    const pickUnit = vi.fn(() => 7);
    const onSelect = vi.fn();
    const later = vi.fn();
    canvas.addEventListener('pointerup', later);
    const dispose = enableUnitSelection({
      domElement: canvas,
      camera: topDownCamera(),
      groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      pickUnit,
      onSelect,
    });

    firePointer(canvas, 'pointerdown', 50, 50, 0);
    firePointer(canvas, 'pointerup', 51, 50, 80);

    expect(pickUnit).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(7);
    expect(later).not.toHaveBeenCalled();
    dispose();
  });

  it('点空地取消选中，且不拦截放兵', () => {
    const canvas = fakeCanvas();
    const later = vi.fn();
    canvas.addEventListener('pointerup', later);
    const onSelect = vi.fn();
    const dispose = enableUnitSelection({
      domElement: canvas,
      camera: topDownCamera(),
      groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      pickUnit: () => null,
      onSelect,
    });

    firePointer(canvas, 'pointerdown', 50, 50, 0);
    firePointer(canvas, 'pointerup', 50, 50, 40);

    expect(onSelect).toHaveBeenCalledWith(null);
    expect(later).toHaveBeenCalled();
    dispose();
  });

  it('拖拽转镜头不算选中', () => {
    const canvas = fakeCanvas();
    const onSelect = vi.fn();
    const dispose = enableUnitSelection({
      domElement: canvas,
      camera: topDownCamera(),
      groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      pickUnit: () => 1,
      onSelect,
    });

    firePointer(canvas, 'pointerdown', 10, 10, 0);
    firePointer(canvas, 'pointerup', 40, 10, 80);

    expect(onSelect).not.toHaveBeenCalled();
    dispose();
  });
});
