// 单测环境：以最小桩替代浏览器 DOM（node 环境跑 utils/world/ghost 等含
// canvas 纹理、图片加载的模块）。目标只是让模块可加载，不模拟真实渲染。

// 固定种子的 LCG 接管 Math.random：世界生成（物品/家具随机摆放）在每次
// 运行间完全可复现，杜绝随机布局导致的偶发红测
let seed = 20260706
Math.random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

const ctxStub = (): any => ({
  fillStyle: '',
  strokeStyle: '',
  font: '',
  textAlign: '',
  textBaseline: '',
  lineWidth: 0,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true,
  fillRect() {},
  strokeRect() {},
  clearRect() {},
  fillText() {},
  strokeText() {},
  beginPath() {},
  closePath() {},
  arc() {},
  moveTo() {},
  lineTo() {},
  bezierCurveTo() {},
  rect() {},
  fill() {},
  stroke() {},
  save() {},
  restore() {},
  scale() {},
  translate() {},
  drawImage() {},
  setLineDash() {},
  measureText() {
    return { width: 0 }
  },
})

function createCanvasStub(): any {
  return { width: 0, height: 0, getContext: () => ctxStub() }
}

/** 通用元素桩：THREE.ImageLoader 走 createElementNS('img') 只需要事件接口与可写属性 */
function createElementStub(): any {
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
  }
}

;(globalThis as any).document = {
  createElement: (tag: string) =>
    tag === 'canvas' ? createCanvasStub() : createElementStub(),
  createElementNS: () => createElementStub(),
  getElementById: () => null,
}

// world.ts 的道具 icon 走 new Image()：complete=false 让绘制路径停在
// 「等 load 事件」分支（测试里不需要真的把 SVG 画上去）
;(globalThis as any).Image = class {
  complete = false
  naturalWidth = 0
  src = ''
  addEventListener(): void {}
  removeEventListener(): void {}
}
