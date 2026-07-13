import type { World } from './world'
import type { Player } from './player'
import type { Ghost } from './ghost'
import type { LevelConfig } from './levels'

/**
 * 把关卡布局画成缩略图（选关卡片用）：黑底 + 走廊暗块 + 房间亮块。
 * 关卡坐标系恰为 100×100，画布 100×100 时 1 格 = 1 像素。
 */
export function drawLevelThumbnail(canvas: HTMLCanvasElement, cfg: LevelConfig): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }
  ctx.fillStyle = '#0c0a08'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#3a352d'
  for (const c of cfg.corridorRects ?? []) {
    ctx.fillRect(c.x, c.z, c.w, c.d)
  }
  ctx.fillStyle = '#6b6156'
  for (const r of cfg.rooms) {
    ctx.fillRect(r.x, r.z, r.w, r.d)
  }
}

export function drawMinimap(canvasId: string, world: World, player: Player, ghost: Ghost): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null
  if (!canvas) { return }
  const ctx = canvas.getContext('2d')!
  const size = canvas.clientWidth
  if (canvas.width !== size) {
    canvas.width = size
    canvas.height = size
  }

  ctx.clearRect(0, 0, size, size)

  const cellSize = size / world.MAP_WIDTH
  const offsetX = -world.MAP_WIDTH / 2
  const offsetZ = -world.MAP_DEPTH / 2

  // 墙体 —— 使用 World 预生成的离屏缓存，一次 drawImage 替代 6400 次 fillRect
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(world.getWallMapCanvas(), 0, 0, size, size)

  // Room numbers
  if (world.rooms) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.font = 'bold 12px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const r of world.rooms) {
      ctx.fillText(r.id.toString(), (r.x + r.w / 2) * cellSize, (r.z + r.d / 2) * cellSize)
    }
  }

  // Player
  const px = player.pos.x - offsetX
  const pz = player.pos.z - offsetZ
  ctx.fillStyle = '#0f0'
  ctx.beginPath()
  ctx.arc(px * cellSize, pz * cellSize, cellSize * 1.5, 0, Math.PI * 2)
  ctx.fill()

  // Flashlight cone
  if (player.flashlightOn) {
    ctx.fillStyle = 'rgba(255, 255, 0, 0.3)'
    ctx.beginPath()
    ctx.moveTo(px * cellSize, pz * cellSize)
    const canvasAngle = -player.yaw - Math.PI / 2
    ctx.arc(px * cellSize, pz * cellSize, cellSize * 8, canvasAngle - Math.PI / 6, canvasAngle + Math.PI / 6)
    ctx.fill()
  }

  // Ghost (requires radar)
  if (player.hasRadar && ghost.isEnabled) {
    const gx = ghost.mesh.position.x - offsetX
    const gz = ghost.mesh.position.z - offsetZ
    ctx.fillStyle = '#f00'
    ctx.beginPath()
    ctx.arc(gx * cellSize, gz * cellSize, cellSize * 1.5, 0, Math.PI * 2)
    ctx.fill()
  }
}
