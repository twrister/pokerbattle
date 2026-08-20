import * as THREE from 'three';
import type { GroundHazardSnapshot } from '@pb/sim';
import { toSceneX, toSceneZ } from './coords.js';

const SEGMENTS = 48;
const FILL_COLOR = 0xff3b1f;
const LINE_COLOR = 0xff9a3c;

/**
 * 地面燃烧圈：橙红半透明填充 + 描边，按 progress 轻微脉动。
 * 由 BattleView 对象池复用，不持有任何模拟状态。
 */
export class GroundHazardView {
  readonly group = new THREE.Group();

  private readonly fill: THREE.Mesh;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly line: THREE.LineLoop;
  private readonly lineMat: THREE.LineBasicMaterial;

  constructor() {
    this.fillMat = new THREE.MeshBasicMaterial({
      color: FILL_COLOR,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(1, SEGMENTS), this.fillMat);
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.position.y = 0.04;

    this.lineMat = new THREE.LineBasicMaterial({
      color: LINE_COLOR,
      transparent: true,
      opacity: 0.95,
    });
    this.line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: SEGMENTS }, (_, index) => {
          const angle = (index / SEGMENTS) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        }),
      ),
      this.lineMat,
    );
    this.line.position.y = 0.05;

    this.group.name = 'ground-hazard';
    this.group.add(this.fill);
    this.group.add(this.line);
  }

  /** 放到燃烧落点并按半径缩放；progress 驱动透明度与轻微呼吸。 */
  update(hazard: GroundHazardSnapshot): void {
    this.group.position.set(toSceneX(hazard.x), 0, toSceneZ(hazard.y));
    const pulse = 0.5 + 0.5 * Math.sin(hazard.progress * Math.PI * 8);
    const size = Math.max(0.01, hazard.radius) * (1 + pulse * 0.04);
    this.fill.scale.setScalar(size);
    this.line.scale.set(size, 1, size);
    this.fillMat.opacity = 0.16 + pulse * 0.12;
    this.lineMat.opacity = 0.7 + pulse * 0.25;
  }
}
