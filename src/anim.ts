import type { PerspectiveCamera, Vector3 } from 'three'

/**
 * UI / 演出动画层：按需从 CDN 加载 anime.js v4。
 * esm.sh 的 ?exports= 参数在 CDN 端摇树，只取 animate / createTimeline / stagger
 * 三个导出（未压缩约 43KB，gzip 传输十几 KB，远小于全量包）。
 * 铁律：动画是"增强"而非"依赖"——CDN 不可达或尚未加载完成时，
 * 所有函数降级为原有的瞬时切换行为，游戏流程绝不因动画层受阻。
 */

/** anime.js v4 最小类型面：只声明本项目用到的 API 形态（完整类型不随 CDN 引入） */
interface AnimeInstance {
  cancel(): void
}
interface AnimeTimeline extends AnimeInstance {
  add(targets: unknown, params: Record<string, unknown>, position?: string | number): AnimeTimeline
}
interface AnimeAPI {
  animate(targets: unknown, params: Record<string, unknown>): AnimeInstance
  createTimeline(params?: Record<string, unknown>): AnimeTimeline
  stagger(value: number): unknown
}

/** 锁定版本 + 显式导出清单：升级须重验 API（v4 的 ease/onComplete 命名与 v3 不兼容） */
const ANIME_CDN_URL = 'https://esm.sh/animejs@4.5.0?exports=animate,createTimeline,stagger'

let anime: AnimeAPI | null = null

/** 存活的演出动画（被抓运镜 / 结算入场）：重开或返回菜单时统一 cancel，
    防止残留补间在新一局继续覆盖相机姿态 */
const liveAnims: AnimeInstance[] = []
/** 被抓演出"延迟弹结算面板"的定时器 */
let caughtPanelTimer: number | null = null

/** 启动加载（fire-and-forget）：游戏构造时调用一次；完成前各函数自动走降级分支 */
export function initAnime(): void {
  void import(/* @vite-ignore */ ANIME_CDN_URL)
    .then((m) => {
      anime = m as unknown as AnimeAPI
    })
    .catch(() => {
      console.warn('[anim] anime.js CDN 加载失败，UI 过渡与演出降级为瞬时切换')
    })
}

/** 面板入场：淡入 + 轻微上浮；降级 = 仅移除 hidden。
    离场一律保持瞬切——无回调时序要管理，快速连点不会撞车 */
export function showPanel(el: HTMLElement): void {
  if (!anime) {
    el.classList.remove('hidden')
    el.style.opacity = ''
    return
  }
  // 先手动置透明再显示：anime 首帧写值在下一 rAF，不预置会闪一帧完整面板
  el.style.opacity = '0'
  el.classList.remove('hidden')
  anime.animate(el, { opacity: [0, 1], y: [10, 0], duration: 190, ease: 'outQuad' })
}

/** 选关卡片交错入场：用缩放而非位移——网格在 overflow-y:auto 容器内且高度贴合内容
    （底部只有 6px padding 余量），位移会暂时扩大可滚动区，滚动条闪现占掉 10px 宽、
    内容居中位置横跳；缩放收在原盒内无此问题。不动 opacity 是为了不让 inline 值
    覆盖 .locked 的灰显；仅在面板打开时调用，单击选卡的重绘不重播 */
export function animateLevelCards(grid: HTMLElement | null): void {
  if (!anime || !grid || grid.children.length === 0) {
    return
  }
  anime.animate(Array.from(grid.children), {
    scale: [0.94, 1],
    duration: 220,
    ease: 'outQuad',
    delay: anime.stagger(24),
  })
}

/**
 * 被抓演出：红屏冲击 + 相机沿最短弧猛转向幽灵并侧倾下沉（死亡回眸 + 跌倒感），
 * 约半秒后"你死了"面板砸入。前提：Game 已置 isPlaying=false——主循环只渲染不更新，
 * 相机补间无人覆盖；重生必经 buildLevel → player.reset/spawn，相机姿态整体复位。
 * 降级 = 立即弹面板（与旧行为一致）。
 */
export function playCaughtCinematic(camera: PerspectiveCamera, ghostPos: Vector3): void {
  const panel = document.getElementById('game-over')
  if (!panel) {
    return
  }
  if (!anime) {
    panel.classList.remove('hidden')
    return
  }
  const api = anime

  // 红屏：瞬间冲到高亮再回落到低透明度常驻（面板出现后仍压着红雾，重开时归零）
  const flash = document.getElementById('damage-flash')
  if (flash) {
    liveAnims.push(
      api.animate(flash, {
        opacity: [
          { to: 0.85, duration: 70, ease: 'outQuad' },
          { to: 0.3, duration: 450, ease: 'outQuad' },
        ],
      })
    )
  }

  // 相机：yaw 差归一化到 [-π, π] 走最短弧；位置只降高度不平移，避免补间穿墙
  const yawTo = Math.atan2(-(ghostPos.x - camera.position.x), -(ghostPos.z - camera.position.z))
  let dYaw = yawTo - camera.rotation.y
  dYaw = ((((dYaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI
  liveAnims.push(
    api.animate(camera.rotation, {
      x: -0.05,
      y: camera.rotation.y + dYaw,
      z: 0.42,
      duration: 620,
      ease: 'outCubic',
    })
  )
  liveAnims.push(
    api.animate(camera.position, {
      y: camera.position.y - 0.5,
      duration: 620,
      ease: 'outCubic',
    })
  )

  // 半拍后结算面板：整体快速淡入，标题从 2.2 倍砸到原大，按钮组交错浮现
  caughtPanelTimer = window.setTimeout(() => {
    caughtPanelTimer = null
    panel.style.opacity = '0'
    panel.classList.remove('hidden')
    const title = document.getElementById('died-text')
    const btns = Array.from(panel.querySelectorAll('button'))
    const tl = api.createTimeline({ defaults: { ease: 'outQuad' } })
    tl.add(panel, { opacity: [0, 1], duration: 160 })
    if (title) {
      tl.add(title, { opacity: [0, 1], scale: [2.2, 1], duration: 280 }, '-=40')
    }
    if (btns.length > 0) {
      tl.add(btns, { opacity: [0, 1], y: [14, 0], duration: 220, delay: api.stagger(90) }, '-=140')
    }
    liveAnims.push(tl)
  }, 520)
}

/** 胜利结算入场：面板淡入 → 标题回弹放大 → 按钮交错浮现；降级 = 立即弹面板 */
export function playWinEntrance(): void {
  const panel = document.getElementById('game-win')
  if (!panel) {
    return
  }
  if (!anime) {
    panel.classList.remove('hidden')
    return
  }
  panel.style.opacity = '0'
  panel.classList.remove('hidden')
  const title = document.getElementById('escaped-text')
  const btns = Array.from(panel.querySelectorAll('button'))
  const tl = anime.createTimeline({ defaults: { ease: 'outQuad' } })
  tl.add(panel, { opacity: [0, 1], duration: 180 })
  if (title) {
    tl.add(title, { opacity: [0, 1], scale: [0.4, 1], duration: 340, ease: 'outBack' }, '-=60')
  }
  if (btns.length > 0) {
    tl.add(btns, { opacity: [0, 1], y: [16, 0], duration: 220, delay: anime.stagger(90) }, '-=120')
  }
  liveAnims.push(tl)
}

/** 终止全部演出并清理残留：重开 / 返回选关时调用
    （相机补间停止、延迟弹窗取消、红雾归零） */
export function cancelCinematics(): void {
  for (const a of liveAnims) {
    a.cancel()
  }
  liveAnims.length = 0
  if (caughtPanelTimer !== null) {
    clearTimeout(caughtPanelTimer)
    caughtPanelTimer = null
  }
  const flash = document.getElementById('damage-flash')
  if (flash) {
    flash.style.opacity = '0'
  }
}
