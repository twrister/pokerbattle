import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ARENA_H, ARENA_W } from './coords.js';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** 地面所在平面，点击放兵时用它做射线求交 */
  groundPlane: THREE.Plane;
  dispose(): void;
}

/** 搭好 3D 场景：斜俯视相机、两盏灯、场地平面和网格线 */
export function createScene(container: HTMLElement): SceneContext {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  camera.position.set(0, 27, 27);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 8;
  controls.maxDistance = 70;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xbdd4ff, 0x20242c, 1.2));

  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(14, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowSpan = Math.max(ARENA_W, ARENA_H) * 0.75;
  sun.shadow.camera.left = -shadowSpan;
  sun.shadow.camera.right = shadowSpan;
  sun.shadow.camera.top = shadowSpan;
  sun.shadow.camera.bottom = -shadowSpan;
  sun.shadow.camera.far = 90;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_W, ARENA_H),
    new THREE.MeshStandardMaterial({ color: 0x2b3444, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(createArenaGrid());
  scene.add(createArenaBorder());
  scene.add(createHalfCourtLine());

  const resize = () => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    controls,
    groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    dispose() {
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/** 一格一线的参考网格。GridHelper 只能画正方形，场地是 18x32 所以自己拼。 */
function createArenaGrid(): THREE.LineSegments {
  const halfW = ARENA_W / 2;
  const halfH = ARENA_H / 2;
  const points: number[] = [];
  for (let x = 1; x < ARENA_W; x++) {
    points.push(x - halfW, 0.01, -halfH, x - halfW, 0.01, halfH);
  }
  for (let z = 1; z < ARENA_H; z++) {
    points.push(-halfW, 0.01, z - halfH, halfW, 0.01, z - halfH);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x3b4557, transparent: true, opacity: 0.6 }),
  );
}

function createArenaBorder(): THREE.Line {
  const halfW = ARENA_W / 2;
  const halfH = ARENA_H / 2;
  const points = [
    new THREE.Vector3(-halfW, 0.02, -halfH),
    new THREE.Vector3(halfW, 0.02, -halfH),
    new THREE.Vector3(halfW, 0.02, halfH),
    new THREE.Vector3(-halfW, 0.02, halfH),
    new THREE.Vector3(-halfW, 0.02, -halfH),
  ];
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x8394ad }),
  );
}

/** 中线，只用来标记两边半场 */
function createHalfCourtLine(): THREE.Line {
  const points = [
    new THREE.Vector3(-ARENA_W / 2, 0.02, 0),
    new THREE.Vector3(ARENA_W / 2, 0.02, 0),
  ];
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x6b7a92 }),
  );
}
