import * as THREE from 'three';
import {
  Faction,
  UNIT_CONFIGS,
  halfCourtYRange,
  isBuildingInsideHalfCourt,
  type UnitTypeId,
  buildingCellRange,
  fromFloat,
  isBuildingConfig,
  placeBuildingCommand,
  snapBuildingCenter,
  type World,
} from '@pb/sim';
import { ARENA_H, ARENA_W, toSceneX, toSceneZ } from '../view/coords.js';
import { screenToSim } from './placement.js';

export interface BuildingPlacementOptions {
  domElement: HTMLElement;
  camera: THREE.Camera;
  groundPlane: THREE.Plane;
  scene: THREE.Scene;
  world: World;
  getFaction: () => Faction;
  getTypeId: () => UnitTypeId;
  onPlace: (command: ReturnType<typeof placeBuildingCommand>) => void;
  /** 为 true 时只高亮/允许蓝方半场落点（单机出阵）；优先于 halfCourtFaction */
  blueHalfOnly?: boolean;
  /** 限定己方半场；联机红方传 Faction.Red */
  halfCourtFaction?: Faction;
  /**
   * 是否监听画布点击放置。
   * 单机从手牌拖拽时由外部松手落成，应设为 false，只保留绿格与吸附预览。
   */
  listenInput?: boolean;
  /** 放置成功后是否自动退出；默认 false（沙盒可连续建造） */
  exitAfterPlace?: boolean;
  /** 退出建造模式时回调（Esc / 成功且 exitAfterPlace） */
  onExit?: () => void;
}

const VALID_COLOR = 0x3dd68c;
const INVALID_COLOR = 0xf05353;
/** 全场可放置目标格：单层 1×1，略淡以免盖住光标预览 */
const SLOT_OPACITY = 0.26;
/** 格子略缩小，露出格线，避免视觉粘成一整块 */
const SLOT_SCALE = 0.92;
const PREVIEW_FILL_OPACITY = 0.38;

export interface BuildingPlacementHandle {
  /** 世界占格变化后刷新绿色目标格 */
  refreshSlots: () => void;
  /** 用屏幕坐标同步光标吸附预览（拖拽悬停时用） */
  syncPointer: (clientX: number, clientY: number) => void;
  /**
   * 按屏幕坐标尝试放置：合法则 onPlace 并返回 true。
   * 供手牌拖拽松手时调用（不依赖画布 pointerdown）。
   */
  tryPlaceAt: (clientX: number, clientY: number) => boolean;
  dispose: () => void;
}

/**
 * 枚举当前建筑所有合法吸附中心（已过半场/重叠校验）。
 * 步进 1 且只保留已吸附坐标，避免偶数/奇数 footprint 重复。
 */
export function collectPlaceableBuildingCenters(
  world: World,
  typeId: UnitTypeId,
  blueHalfOnly: boolean,
  halfCourtFaction?: Faction,
): Array<{ x: number; y: number }> {
  const config = UNIT_CONFIGS[typeId];
  if (!isBuildingConfig(config)) return [];
  const size = Math.max(1, Math.floor(config.footprint));
  const half = size / 2;
  const faction = halfCourtFaction ?? (blueHalfOnly ? Faction.Blue : undefined);
  const yRange = faction !== undefined ? halfCourtYRange(faction) : { minY: 0, maxY: ARENA_H };
  const centers: Array<{ x: number; y: number }> = [];

  for (let y = yRange.minY + half; y <= yRange.maxY - half + 1e-6; y += 1) {
    for (let x = half; x <= ARENA_W - half + 1e-6; x += 1) {
      const cx = snapBuildingCenter(x, size);
      const cy = snapBuildingCenter(y, size);
      // 未对齐的采样点跳过，保证每个合法中心只出现一次
      if (Math.abs(cx - x) > 1e-6 || Math.abs(cy - y) > 1e-6) continue;
      if (faction !== undefined && !isBuildingInsideHalfCourt(cx, cy, size, faction)) continue;
      if (!world.canPlaceBuilding(typeId, fromFloat(cx), fromFloat(cy))) continue;
      centers.push({ x: cx, y: cy });
    }
  }
  return centers;
}

/**
 * 把所有合法占地并成「去重后的 1×1 格子」中心点。
 * 若按 footprint 整块画半透明矩形，相邻吸附位会重叠，看起来像叠了很多层。
 */
export function collectPlaceableBuildingCells(
  world: World,
  typeId: UnitTypeId,
  blueHalfOnly: boolean,
  halfCourtFaction?: Faction,
): Array<{ x: number; y: number }> {
  const config = UNIT_CONFIGS[typeId];
  if (!isBuildingConfig(config)) return [];
  const footprint = config.footprint;
  const seen = new Set<string>();
  const cells: Array<{ x: number; y: number }> = [];

  for (const center of collectPlaceableBuildingCenters(world, typeId, blueHalfOnly, halfCourtFaction)) {
    const rect = buildingCellRange(center.x, center.y, footprint);
    for (let gy = rect.minY; gy < rect.maxY; gy++) {
      for (let gx = rect.minX; gx < rect.maxX; gx++) {
        const key = `${gx},${gy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // 格心坐标，便于 1×1 平面对齐格线
        cells.push({ x: gx + 0.5, y: gy + 0.5 });
      }
    }
  }
  return cells;
}

/**
 * 建筑放置模式：场景铺满可放置绿色目标格，指针吸附预览（合法绿 / 非法红），
 * 点击合法格下发 PlaceBuilding。与放兵点击监听互斥，由调用方切换。
 */
export function enableBuildingPlacement(options: BuildingPlacementOptions): BuildingPlacementHandle {
  const {
    domElement,
    camera,
    groundPlane,
    scene,
    world,
    getFaction,
    getTypeId,
    onPlace,
    blueHalfOnly = false,
    halfCourtFaction,
    listenInput = true,
    exitAfterPlace = false,
    onExit,
  } = options;
  const courtFaction = halfCourtFaction ?? (blueHalfOnly ? Faction.Blue : undefined);

  const root = new THREE.Group();
  root.name = 'building-placement';
  scene.add(root);

  const slotsGroup = new THREE.Group();
  root.add(slotsGroup);

  const preview = new THREE.Group();
  preview.visible = false;
  root.add(preview);

  const fillMat = new THREE.MeshBasicMaterial({
    color: VALID_COLOR,
    transparent: true,
    opacity: PREVIEW_FILL_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const lineMat = new THREE.LineBasicMaterial({
    color: VALID_COLOR,
    transparent: true,
    opacity: 0.95,
  });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.05;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), lineMat);
  edges.rotation.x = -Math.PI / 2;
  edges.position.y = 0.06;
  preview.add(fill, edges);

  const slotMat = new THREE.MeshBasicMaterial({
    color: VALID_COLOR,
    transparent: true,
    opacity: SLOT_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  let slotMesh: THREE.InstancedMesh | null = null;
  let disposed = false;

  let lastValid = false;
  let lastCenterX = 0;
  let lastCenterY = 0;
  let lastFootprint = 0;

  /** 按「去重后的 1×1 格」铺绿色目标区，避免 footprint 矩形互相叠色 */
  const refreshSlots = (): void => {
    if (disposed) return;
    const typeId = getTypeId();
    const config = UNIT_CONFIGS[typeId];
    if (!isBuildingConfig(config)) {
      clearSlots();
      return;
    }
    const cells = collectPlaceableBuildingCells(world, typeId, blueHalfOnly, courtFaction);

    if (slotMesh) {
      slotsGroup.remove(slotMesh);
      slotMesh.geometry.dispose();
      slotMesh = null;
    }
    if (cells.length === 0) return;

    const geo = new THREE.PlaneGeometry(1, 1);
    slotMesh = new THREE.InstancedMesh(geo, slotMat, cells.length);
    // 实例散布全场，默认包围盒在原点会导致边缘格被裁掉
    slotMesh.frustumCulled = false;
    // 旋转打进 instance 矩阵，避免父级 rotation 把平移轴拧歪
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const scale = new THREE.Vector3(SLOT_SCALE, SLOT_SCALE, 1);
    const pos = new THREE.Vector3();
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      pos.set(toSceneX(c.x), 0.04, toSceneZ(c.y));
      matrix.compose(pos, quat, scale);
      slotMesh.setMatrixAt(i, matrix);
    }
    slotMesh.instanceMatrix.needsUpdate = true;
    slotsGroup.add(slotMesh);
  };

  const clearSlots = (): void => {
    if (!slotMesh) return;
    slotsGroup.remove(slotMesh);
    slotMesh.geometry.dispose();
    slotMesh = null;
  };

  /** 按当前兵种占地刷新光标预览尺寸与颜色 */
  const syncPreview = (clientX: number, clientY: number): void => {
    const typeId = getTypeId();
    const config = UNIT_CONFIGS[typeId];
    if (!isBuildingConfig(config)) {
      preview.visible = false;
      return;
    }
    const point = screenToSim(domElement, camera, groundPlane, clientX, clientY);
    if (!point) {
      preview.visible = false;
      return;
    }

    const footprint = config.footprint;
    const cx = snapBuildingCenter(point.x, footprint);
    const cy = snapBuildingCenter(point.y, footprint);
    const inHalf =
      courtFaction === undefined || isBuildingInsideHalfCourt(cx, cy, footprint, courtFaction);
    const valid = inHalf && world.canPlaceBuilding(typeId, fromFloat(cx), fromFloat(cy));
    lastValid = valid;
    lastCenterX = cx;
    lastCenterY = cy;

    const color = valid ? VALID_COLOR : INVALID_COLOR;
    fillMat.color.setHex(color);
    lineMat.color.setHex(color);

    if (lastFootprint !== footprint) {
      lastFootprint = footprint;
      fill.scale.set(footprint, footprint, 1);
      edges.geometry.dispose();
      edges.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(footprint, footprint));
    }

    preview.position.set(toSceneX(cx), 0, toSceneZ(cy));
    preview.visible = true;
  };

  const exit = (): void => {
    onExit?.();
  };

  /** 在已同步的吸附中心下发放置；非法则返回 false。 */
  const placeAtLast = (): boolean => {
    if (!preview.visible || !lastValid) return false;
    onPlace(
      placeBuildingCommand(getFaction(), getTypeId(), fromFloat(lastCenterX), fromFloat(lastCenterY)),
    );
    refreshSlots();
    if (exitAfterPlace) exit();
    return true;
  };

  const tryPlaceAt = (clientX: number, clientY: number): boolean => {
    syncPreview(clientX, clientY);
    return placeAtLast();
  };

  const onPointerMove = (event: PointerEvent): void => {
    syncPreview(event.clientX, event.clientY);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    syncPreview(event.clientX, event.clientY);
    if (!placeAtLast()) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      exit();
    }
  };

  refreshSlots();
  if (listenInput) {
    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
  }

  return {
    refreshSlots,
    syncPointer: syncPreview,
    tryPlaceAt,
    dispose: () => {
      disposed = true;
      if (listenInput) {
        domElement.removeEventListener('pointermove', onPointerMove);
        domElement.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('keydown', onKeyDown);
      }
      clearSlots();
      scene.remove(root);
      fill.geometry.dispose();
      fillMat.dispose();
      edges.geometry.dispose();
      lineMat.dispose();
      slotMat.dispose();
    },
  };
}
