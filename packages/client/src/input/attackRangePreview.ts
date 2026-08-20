import * as THREE from 'three';
import {
  isArcherTowerId,
  isRangedAttackKind,
  toFloat,
  UNIT_CONFIGS,
  type CardFormation,
  type FormationDraft,
  type UnitTypeId,
} from '@pb/sim';
import { toSceneX, toSceneZ } from '../view/coords.js';
import { AoeGroundMark } from '../view/aoeGroundMark.js';
import { screenToSim } from './placement.js';

export interface AttackRangePlacementHandle {
  syncPointer: (clientX: number, clientY: number) => void;
  dispose: () => void;
}

export interface AttackRangePlacementOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  groundPlane: THREE.Plane;
  scene: THREE.Scene;
  radius: number;
}

/** 放置预览要画攻击范围圈的远程单位：三种箭塔、连弩车、投弹车。 */
export function showsAttackRangeOnPlace(typeId: UnitTypeId): boolean {
  return isArcherTowerId(typeId) || typeId === 'ranged_ballista' || typeId === 'ranged_chariot';
}

/**
 * 选中/放置白圈半径：远程只画配置 range，近战仍是 range + 自身半径。
 * 不含对方半径，也不用投弹车 aoeRadius（那是爆炸范围）。
 */
export function attackReachPreviewRadius(typeId: UnitTypeId, range = toFloat(UNIT_CONFIGS[typeId].range)): number {
  const config = UNIT_CONFIGS[typeId];
  if (isRangedAttackKind(config.attack.kind)) return range;
  return range + toFloat(config.radius);
}

/**
 * 阵型槽位里若有放置射程预览兵种，返回应画的圈半径。
 * 同时出现多种时取较大射程，避免只露出较短的那圈。
 */
export function formationAttackRangePreviewRadius(
  formation: Pick<CardFormation, 'rows'> | Pick<FormationDraft, 'rows'>,
): number | null {
  let maxRadius: number | null = null;
  for (const typeId of formation.rows.flat()) {
    if (!showsAttackRangeOnPlace(typeId)) continue;
    const radius = attackReachPreviewRadius(typeId);
    if (maxRadius === null || radius > maxRadius) maxRadius = radius;
  }
  return maxRadius;
}

/**
 * 跟随指针的白色攻击范围圈，样式与选中单位圈相同。
 * 只负责坐标与表现，落点合法性仍由调用方校验。
 */
export function enableAttackRangePlacement(
  options: AttackRangePlacementOptions,
): AttackRangePlacementHandle {
  const mark = new AoeGroundMark({ filled: false, lineColor: 0xffffff });
  mark.group.name = 'attack-range-placement';
  mark.group.visible = false;
  options.scene.add(mark.group);

  let disposed = false;
  return {
    syncPointer(clientX, clientY) {
      if (disposed) return;
      const point = screenToSim(
        options.domElement,
        options.camera,
        options.groundPlane,
        clientX,
        clientY,
      );
      if (!point) {
        mark.group.visible = false;
        return;
      }
      mark.update(toSceneX(point.x), toSceneZ(point.y), options.radius);
      mark.group.visible = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.scene.remove(mark.group);
      mark.dispose();
    },
  };
}
