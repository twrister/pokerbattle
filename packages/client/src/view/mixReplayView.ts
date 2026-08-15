import * as THREE from 'three';
import {
  TICK_RATE,
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
import { syncArenaCoords, toSceneX, toSceneZ } from './coords.js';

const STEP_MS = 1000 / TICK_RATE;
/** 单帧最多补几个逻辑帧，避免切回标签页时一次追太多。 */
const MAX_CATCHUP_STEPS = 8;
/** 对拆锚点中点；蓝 (9,6) 与红 (9,12) 的几何中心。 */
const LOOK_SIM_X = 9;
const LOOK_SIM_Y = 9;
const GROUND_HALF_W = 9;
const GROUND_HALF_H = 8;
const ORTHO_HALF_HEIGHT = 8;

export interface MixReplayHandle {
  load(setup: MixReplaySetup, options?: { totalTicks?: number }): void;
  play(): void;
  pause(): void;
  setSpeed(multiplier: number): void;
  seek(tick: number): void;
  resize(): void;
  dispose(): void;
}

export interface MixReplayState {
  tick: number;
  totalTicks: number;
  playing: boolean;
  aliveA: number;
  aliveB: number;
  hpFracA: number;
  hpFracB: number;
  finished: boolean;
}

export interface MixReplayViewOptions {
  onState?: (state: MixReplayState) => void;
}

/**
 * 搭配对比回放的独立 3D 场景。
 * 不进主战场：用同一 seed 重跑 World，按 20Hz 步进后交给 BattleView 插值。
 */
export function createMixReplayView(
  container: HTMLElement,
  options: MixReplayViewOptions = {},
): MixReplayHandle {
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
  let setup: MixReplaySetup | null = null;
  let prev: Snapshot = emptySnapshot();
  let curr: Snapshot = emptySnapshot();
  let playing = false;
  let finished = false;
  let speed = 1;
  let totalTicks = 1;
  let accumulator = 0;
  let lastNow = 0;
  let rafId = 0;

  const emitState = (): void => {
    if (!session || !setup) return;
    options.onState?.({
      tick: session.world.tick,
      totalTicks,
      playing,
      aliveA: countAlive(session.world, session.aFaction),
      aliveB: countAlive(session.world, session.bFaction),
      hpFracA: session.maxHpA > 0 ? remainingHp(session.world, session.aFaction) / session.maxHpA : 0,
      hpFracB: session.maxHpB > 0 ? remainingHp(session.world, session.bFaction) / session.maxHpB : 0,
      finished,
    });
  };

  const paint = (): void => {
    const alpha = playing && !finished ? Math.min(1, accumulator / STEP_MS) : 1;
    battleView.render(prev, curr, alpha, camera);
    renderer.render(scene, camera);
  };

  const stepOnce = (): void => {
    if (!session || !setup || finished) return;
    session.world.step();
    const reuse = prev;
    prev = curr;
    curr = takeSnapshot(session.world, reuse);
    if (
      isBattleSettled(session.world, session.aFaction, session.bFaction)
      || session.world.tick >= setup.maxTicks
    ) {
      finished = true;
      playing = false;
      accumulator = 0;
    }
  };

  const loop = (now: number): void => {
    rafId = requestAnimationFrame(loop);
    const deltaMs = lastNow === 0 ? 0 : now - lastNow;
    lastNow = now;
    if (playing && !finished) {
      accumulator += deltaMs * speed;
      let steps = 0;
      while (accumulator >= STEP_MS && !finished) {
        if (steps >= MAX_CATCHUP_STEPS) {
          accumulator = 0;
          break;
        }
        stepOnce();
        accumulator -= STEP_MS;
        steps += 1;
      }
      if (steps > 0) emitState();
    }
    paint();
  };

  /** 重建 World 再快跑到目标 tick；上限约 1200 步，比存帧更省内存。 */
  const rebuildTo = (tick: number): void => {
    if (!setup) return;
    session = setupMixWorld(setup);
    battleView.reset();
    prev = takeSnapshot(session.world);
    curr = takeSnapshot(session.world);
    finished = false;
    accumulator = 0;
    const target = Math.max(0, Math.min(Math.floor(tick), setup.maxTicks));
    for (let i = 0; i < target; i += 1) {
      session.world.step();
      const reuse = prev;
      prev = curr;
      curr = takeSnapshot(session.world, reuse);
      if (isBattleSettled(session.world, session.aFaction, session.bFaction)) {
        finished = true;
        playing = false;
        break;
      }
    }
    if (session.world.tick >= setup.maxTicks) {
      finished = true;
      playing = false;
    }
    emitState();
    paint();
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
  rafId = requestAnimationFrame(loop);

  return {
    load(nextSetup, loadOptions) {
      setup = nextSetup;
      totalTicks = Math.max(1, loadOptions?.totalTicks ?? nextSetup.maxTicks);
      playing = false;
      rebuildTo(0);
    },
    play() {
      if (!setup) return;
      if (finished) rebuildTo(0);
      playing = true;
      lastNow = 0;
      emitState();
    },
    pause() {
      playing = false;
      emitState();
    },
    setSpeed(multiplier) {
      speed = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    },
    seek(tick) {
      rebuildTo(tick);
    },
    resize,
    dispose() {
      window.removeEventListener('resize', onResize);
      if (rafId !== 0) cancelAnimationFrame(rafId);
      rafId = 0;
      playing = false;
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
