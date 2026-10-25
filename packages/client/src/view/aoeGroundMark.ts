import * as THREE from 'three';
import { GROUND_FX, GroundRingMark } from './groundFxStyle.js';

const SEGMENTS = 48;

/** 所有兵种统一 0.05 世界单位的环宽：按半径比例画会让投弹车（range 11）比弓手（range 5）粗一倍多 */
const ATTACK_RANGE_WIDTH = 0.05;

/** 攻击范围圈：白色细线、无描边、无填充。三个入口（选中 / 出牌预瞄 / 建筑摆放）共用一份配置。 */
const ATTACK_RANGE_STYLE = {
  filled: false,
  ring: true,
  lineColor: GROUND_FX.range,
  ringWidth: ATTACK_RANGE_WIDTH,
  ringOpacity: 0.85,
  ringOutline: false,
} as const;

export interface AoeGroundMarkOptions {
  /** 默认 true；选中攻击范围只要描边、不要内部填充 */
  filled?: boolean;
  fillColor?: number;
  /** 填充透明度，默认 0.32 */
  fillOpacity?: number;
  lineColor?: number;
  /** 是否画描边环，默认 false：危险区只保留一片纯色圆面 */
  ring?: boolean;
  /** 环宽占外径比例，默认 0.09；越小越像细线 */
  ringThickness?: number;
  /** 环宽的绝对世界宽度；设置后忽略 ringThickness，不同半径粗细一致 */
  ringWidth?: number;
  ringOpacity?: number;
  /** 是否在环内侧垫深棕描边，默认 true */
  ringOutline?: boolean;
}

/**
 * 地面圆形范围标记：半透明填充 + 描边环。
 * 出牌预瞄、爆炸落地预警、选中单位的攻击范围共用，不持有任何模拟状态。
 * 描边用有宽度的环面而非 LineLoop，浅沙地面上远景也能看清边界。
 *
 * 两种形态：
 * - 危险区（默认）：只有一片半透明红色圆面，不带硬边界，避免和单位脚下的阵营圈抢视觉；
 * - 攻击范围：白色细环、无填充无描边，克制到只剩一条线。
 */
export class AoeGroundMark {
  readonly group = new THREE.Group();

  private readonly fill: THREE.Mesh | null;
  private readonly ring: GroundRingMark | null;

  constructor(options: AoeGroundMarkOptions = {}) {
    const filled = options.filled !== false;

    this.fill = filled
      ? new THREE.Mesh(
          new THREE.CircleGeometry(1, SEGMENTS),
          new THREE.MeshBasicMaterial({
            color: options.fillColor ?? GROUND_FX.warnFill,
            transparent: true,
            // 浅沙地面上 0.16 的填充几乎看不出是危险区，抬到 0.32
            opacity: options.fillOpacity ?? 0.32,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        )
      : null;
    if (this.fill) {
      this.fill.rotation.x = -Math.PI / 2;
      // 填充略低于描边，避免与描边共面时深度打架
      this.fill.position.y = 0.05;
      this.fill.raycast = () => {};
    }

    this.ring = options.ring === true
      ? new GroundRingMark({
          color: options.lineColor ?? GROUND_FX.warnFill,
          thickness: options.ringThickness ?? 0.09,
          width: options.ringWidth,
          opacity: options.ringOpacity ?? 0.95,
          segments: SEGMENTS,
          outline: options.ringOutline,
        })
      : null;
    if (this.ring) this.ring.group.position.y = 0.06;

    this.group.name = 'aoe-ground-mark';
    if (this.fill) this.group.add(this.fill);
    if (this.ring) this.group.add(this.ring.group);
  }

  /** 把标记放到场景坐标，并按爆炸半径缩放单位圆 */
  update(sceneX: number, sceneZ: number, radius: number): void {
    this.group.position.set(sceneX, 0, sceneZ);
    const size = Math.max(0.01, radius);
    this.fill?.scale.setScalar(size);
    this.ring?.setRadius(size);
  }

  /** 预瞄圈用完后释放几何与材质；对象池复用时不要调用 */
  dispose(): void {
    if (this.fill) {
      this.fill.geometry.dispose();
      (this.fill.material as THREE.Material).dispose();
    }
    this.ring?.dispose();
  }
}

/**
 * 攻击范围圈（白色细圈）的工厂。
 * 选中单位的圈、出牌预瞄圈、建筑摆放预瞄圈统一走这里，
 * 免得三处各写一份参数、以后调粗细又漏掉一处。
 */
export function createAttackRangeMark(): AoeGroundMark {
  return new AoeGroundMark(ATTACK_RANGE_STYLE);
}
