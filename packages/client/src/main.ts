import { Faction, type UnitTypeId, fromFloat, spawnCommand } from '@pb/sim';
import { SimLoop } from './loop.js';
import { createPanel } from './debug/panel.js';
import { enablePlacement } from './input/placement.js';
import { ARENA_H } from './view/coords.js';
import { createScene } from './view/scene.js';
import { BattleView } from './view/viewSync.js';

const container = document.getElementById('app');
if (!container) throw new Error('找不到 #app 容器');

const sceneContext = createScene(container);
const loop = new SimLoop(20260806);
const battleView = new BattleView(sceneContext.scene);

const panel = createPanel({
  loop,
  onClear: () => {
    loop.reset();
    battleView.reset();
  },
  onBrawl: () => spawnBrawl(loop),
});

enablePlacement({
  domElement: sceneContext.renderer.domElement,
  camera: sceneContext.camera,
  groundPlane: sceneContext.groundPlane,
  onPlace: (simX, simY) => {
    loop.enqueue(spawnCommand(panel.faction, panel.unitType, fromFloat(simX), fromFloat(simY)));
  },
});

/** 一键摆一场混战，用来快速验证寻路、推挤和战斗结算 */
function spawnBrawl(target: SimLoop): void {
  const lineup: Array<[UnitTypeId, number]> = [
    ['melee_grunt', 5],
    ['melee_grunt', 7],
    ['melee_grunt', 9],
    ['melee_grunt', 11],
    ['ranged_archer', 6],
    ['ranged_archer', 8],
    ['ranged_archer', 10],
    ['ranged_archer', 12],
  ];
  for (const [typeId, x] of lineup) {
    const backRow = typeId === 'ranged_archer';
    const blueY = backRow ? 3 : 6;
    const redY = ARENA_H - (backRow ? 3 : 6);
    target.enqueue(spawnCommand(Faction.Blue, typeId, fromFloat(x), fromFloat(blueY)));
    target.enqueue(spawnCommand(Faction.Red, typeId, fromFloat(x), fromFloat(redY)));
  }
}

let lastFrameAt = performance.now();
let smoothedFps = 60;

function frame(now: number): void {
  const deltaMs = Math.min(now - lastFrameAt, 250);
  lastFrameAt = now;
  smoothedFps += (1000 / Math.max(deltaMs, 1) - smoothedFps) * 0.08;

  loop.advance(deltaMs);
  sceneContext.controls.update();
  battleView.render(loop.prev, loop.curr, loop.alpha, sceneContext.camera);
  sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
  panel.updateStats(smoothedFps);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
