import * as THREE from 'three';

const SEGMENTS = 48;
/** 与出牌预瞄圈同色，飞行预警和拖拽预览共用，避免两套范围圈看起来不像一类东西。 */
const FILL_COLOR = 0xffb347;
const LINE_COLOR = 0xffcf6b;

export interface AoeGroundMarkOptions {
  /** 默认 true；选中攻击范围只要描边、不要内部填充。 */
  filled?: boolean;
  fillColor?: number;
  lineColor?: number;
}

/**
 * 地面圆形范围标记：半透明填充 + 描边。
 * 出牌预瞄和范围弹落地预警共用，不持有任何模拟状态。
 */
export class AoeGroundMark {
  readonly group = new THREE.Group();

  private readonly fill: THREE.Mesh | null;
  private readonly line: THREE.LineLoop;

  constructor(options: AoeGroundMarkOptions = {}) {
    const filled = options.filled !== false;

    this.fill = filled
      ? new THREE.Mesh(
          new THREE.CircleGeometry(1, SEGMENTS),
          new THREE.MeshBasicMaterial({
            color: options.fillColor ?? FILL_COLOR,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        )
      : null;
    if (this.fill) {
      this.fill.rotation.x = -Math.PI / 2;
      this.fill.position.y = 0.05;
    }

    const lineMat = new THREE.LineBasicMaterial({
      color: options.lineColor ?? LINE_COLOR,
      transparent: true,
      opacity: 0.9,
    });
    this.line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: SEGMENTS }, (_, index) => {
          const angle = (index / SEGMENTS) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        }),
      ),
      lineMat,
    );
    this.line.position.y = 0.06;

    this.group.name = 'aoe-ground-mark';
    if (this.fill) this.group.add(this.fill);
    this.group.add(this.line);
  }

  /** 把标记放到场景坐标，并按爆炸半径缩放单位圆。 */
  update(sceneX: number, sceneZ: number, radius: number): void {
    this.group.position.set(sceneX, 0, sceneZ);
    const size = Math.max(0.01, radius);
    this.fill?.scale.setScalar(size);
    this.line.scale.set(size, 1, size);
  }

  /** 预瞄圈用完后释放几何与材质；对象池复用时不要调用。 */
  dispose(): void {
    if (this.fill) {
      this.fill.geometry.dispose();
      (this.fill.material as THREE.Material).dispose();
    }
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
