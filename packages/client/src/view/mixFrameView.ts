import * as THREE from 'three';
import {
  countAlive,
  emptySnapshot,
  isBattleSettled,
  remainingHp,
  setupMixWorld,
  takeSnapshot,
  type MixReplaySetup,
  type MixWorldSession,
  type Snapshot,
} from '@pb/sim';
import { BattleView } from './viewSync.js';
import { onSpriteTextureLoaded } from './unitSprites.js';
import { syncArenaCoords, toSceneX, toSceneZ } from './coords.js';

/** 对拆锚点中点；蓝 (9,6) 与红 (9,12) 的几何中心。 */
const LOOK_SIM_X = 9;
const LOOK_SIM_Y = 9;
const GROUND_HALF_W = 9;
const GROUND_HALF_H = 8;
const ORTHO_HALF_HEIGHT = 8;

export interface MixFrameHandle {
  /** 重建 World 快进到目标 tick 后画一帧，返回该帧统计。 */
  showFrame(setup: MixReplaySetup, tick: number): MixFrameStats;
  resize(): void;
  dispose(): void;
}

export interface MixFrameStats {
  tick: number;
  aliveA: number;
  aliveB: number;
  hpFracA: number;
  hpFracB: number;
  settled: boolean;
}

/**
 * 搭配对比的定格帧渲染器。
 * 不进主战场：用同一 seed 重建 World，快进到指定 tick 后交给 BattleView 画一帧。
 */
export function createMixFrameView(container: HTMLElement): MixFrameHandle {
  syncArenaCoords();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const lookX = toSceneX(LOOK_SIM_X);
  const lookZ = toSceneZ(LOOK_SIM_Y);
  const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 100);
  camera.position.set(lookX, 18, lookZ + 12);
  camera.lookAt(lookX, 0, lookZ);
  scene.add(new THREE.HemisphereLight(0xc7dcff, 0x1d2430, 1.8));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_HALF_W * 2, GROUND_HALF_H * 2),
    new THREE.MeshStandardMaterial({ color: 0x243143, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(lookX, 0, lookZ);
  scene.add(ground);

  const grid = createReplayGrid(lookX, lookZ, GROUND_HALF_W, GROUND_HALF_H);
  scene.add(grid);

  const battleView = new BattleView(scene);
  let session: MixWorldSession | null = null;
  let prev: Snapshot = emptySnapshot();
  let curr: Snapshot = emptySnapshot();

  const paint = (): void => {
    battleView.render(prev, curr, 1, camera);
    renderer.render(scene, camera);
  };

  const readStats = (): MixFrameStats => {
    if (!session) {
      return { tick: 0, aliveA: 0, aliveB: 0, hpFracA: 0, hpFracB: 0, settled: false };
    }
    return {
      tick: session.world.tick,
      aliveA: countAlive(session.world, session.aFaction),
      aliveB: countAlive(session.world, session.bFaction),
      hpFracA: session.maxHpA > 0 ? remainingHp(session.world, session.aFaction) / session.maxHpA : 0,
      hpFracB: session.maxHpB > 0 ? remainingHp(session.world, session.bFaction) / session.maxHpB : 0,
      settled: isBattleSettled(session.world, session.aFaction, session.bFaction),
    };
  };

  const resize = (): void => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const aspect = width / height;
    camera.left = -ORTHO_HALF_HEIGHT * aspect;
    camera.right = ORTHO_HALF_HEIGHT * aspect;
    camera.top = ORTHO_HALF_HEIGHT;
    camera.bottom = -ORTHO_HALF_HEIGHT;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    paint();
  };

  const onResize = (): void => resize();
  window.addEventListener('resize', onResize);
  // 定格帧只画一次，而立绘贴图是异步到达的；每有一张图就绪就补画一帧
  const offTextureLoaded = onSpriteTextureLoaded(() => {
    if (session) paint();
  });

  return {
    showFrame(setup, tick) {
      session = setupMixWorld(setup);
      battleView.reset();
      prev = takeSnapshot(session.world);
      curr = takeSnapshot(session.world);
      const target = Math.max(0, Math.min(Math.floor(tick), setup.maxTicks));
      for (let i = 0; i < target; i += 1) {
        session.world.step();
        const reuse = prev;
        prev = curr;
        curr = takeSnapshot(session.world, reuse);
        if (isBattleSettled(session.world, session.aFaction, session.bFaction)) break;
      }
      resize();
      return readStats();
    },
    resize,
    dispose() {
      window.removeEventListener('resize', onResize);
      offTextureLoaded();
      battleView.reset();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      disposeLineObject(grid);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** 与阵型预览同刻度的参考网格，方便对照双方落点。 */
function createReplayGrid(
  originX: number,
  originZ: number,
  halfW: number,
  halfH: number,
): THREE.LineSegments {
  const points: number[] = [];
  for (let x = -halfW + 1; x < halfW; x += 1) {
    points.push(originX + x, 0.01, originZ - halfH, originX + x, 0.01, originZ + halfH);
  }
  for (let z = -halfH + 1; z < halfH; z += 1) {
    points.push(originX - halfW, 0.01, originZ + z, originX + halfW, 0.01, originZ + z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x4a5a70, transparent: true, opacity: 0.75 }),
  );
}

function disposeLineObject(object: THREE.LineSegments): void {
  object.geometry.dispose();
  const material = object.material;
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}
