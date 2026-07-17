import { describe, expect, it, beforeAll, vi } from 'vitest'
import * as THREE from 'three'
import { World } from '../src/world'
import { Ghost } from '../src/ghost'
import { ROOM_LAYOUT } from './fixtures'

// 网格坐标 → 世界坐标（y=1，与 walkableNodes 一致）
function v(world: World, gx: number, gz: number): THREE.Vector3 {
  return new THREE.Vector3(gx - world.MAP_WIDTH / 2, 1, gz - world.MAP_DEPTH / 2)
}

describe('Ghost 寻路与视线', () => {
  let world: World
  let ghost: Ghost

  beforeAll(() => {
    world = new World(new THREE.Scene())
    world.generateMansion(ROOM_LAYOUT)
    const fakePlayer = { pos: world.walkableNodes[0].clone(), isHidden: false }
    // listener/soundGen 传 null：Ghost 构造器对二者做了空值保护，跳过音频
    ghost = new Ghost(new THREE.Scene(), world, fakePlayer as any, null as any, null as any)
  })

  it('A* 能跨房间找到合法路径并到达目标', () => {
    const start = world.walkableNodes[0]
    // 生产 findPath 有 2000 次迭代上限（超限返回最近可达点，是幽灵追击的刻意
    // 性能取舍），横跨全图的极端目标可能触顶。测试选中等距离、且未被家具占据
    // 的目标格，保证「必须完整到达」的断言与生产语义一致。
    const end = world.walkableNodes.find((n) => {
      const d = Math.abs(n.x - start.x) + Math.abs(n.z - start.z)
      return d >= 25 && d <= 40 && !world.hasFurnitureAt(n.x, n.z)
    })
    expect(end).toBeDefined()
    const path: THREE.Vector3[] = (ghost as any).findPath(start, end!)

    expect(path.length).toBeGreaterThan(0)

    // 终点等于目标格
    const last = path[path.length - 1]
    expect(Math.round(last.x)).toBe(Math.round(end!.x))
    expect(Math.round(last.z)).toBe(Math.round(end!.z))

    // 每一步都是 4 邻接、且落在空地上
    const offsetX = -world.MAP_WIDTH / 2
    const offsetZ = -world.MAP_DEPTH / 2
    let prev = start
    for (const p of path) {
      const stepDist =
        Math.abs(Math.round(p.x) - Math.round(prev.x)) +
        Math.abs(Math.round(p.z) - Math.round(prev.z))
      expect(stepDist).toBe(1)
      const gx = Math.round(p.x - offsetX)
      const gz = Math.round(p.z - offsetZ)
      expect(world.grid[gx][gz]).toBe(0)
      prev = p
    }
  })

  it('同房间开阔地视线通畅', () => {
    // 1 号房间 (5,5)-(19,19) 内部对角
    expect((ghost as any).hasLineOfSight(v(world, 6, 6), v(world, 18, 18))).toBe(true)
  })

  it('穿墙视线被阻挡，走廊挖穿处视线通畅', () => {
    // 布局固定：x=12 的纵向走廊挖穿了 z20..24 的墙带（房间 3→4 的兜底直廊），
    // 相邻的 x=11 列同一段仍是实墙。
    expect((ghost as any).hasLineOfSight(v(world, 11, 19), v(world, 11, 25))).toBe(false)
    expect((ghost as any).hasLineOfSight(v(world, 12, 19), v(world, 12, 25))).toBe(true)
  })
})

describe('Ghost 移动丝滑性（位移预算 + 平滑转向 + 前瞻拉直）', () => {
  let world: World
  let ghost: Ghost
  let fakePlayer: { pos: THREE.Vector3; isHidden: boolean }

  // 移动用例统一布置在房间 5（x25..49, z30..54）内部深处：格子必为空地。
  // 手工路径全部共线设计——随机家具只影响前瞻跳点与否，不影响断言结论。
  const GX = 30
  const GZ = 40

  beforeAll(() => {
    world = new World(new THREE.Scene())
    world.generateMansion(ROOM_LAYOUT)
    // 玩家放地图角落（距房间 5 远超 20 格视距）→ canSee 恒 false，状态机稳定停在 patrol
    fakePlayer = { pos: world.walkableNodes[0].clone(), isHidden: false }
    ghost = new Ghost(new THREE.Scene(), world, fakePlayer as any, null as any, null as any)
  })

  /** 把幽灵摆到 (GX,GZ)、塞一条手工巡逻路径（相对 GX/GZ 的格偏移列表） */
  function setupPath(offsets: ReadonlyArray<readonly [number, number]>): THREE.Vector3 {
    const g = ghost as any
    const p0 = v(world, GX, GZ)
    ghost.mesh.position.set(p0.x, 1, p0.z)
    g.state = 'patrol'
    g.path = offsets.map(([dx, dz]) => v(world, GX + dx, GZ + dz))
    g.pathIndex = 0
    return p0
  }

  it('沿路径匀速推进：路径点交接处不再出现零位移冻结帧', () => {
    ghost.setSpeed(2.8)
    setupPath([
      [1, 0],
      [2, 0],
      [3, 0],
    ])

    // 60 帧 × 2.8/60 = 2.8 < 路径总长 3.0，全程路径未耗尽 → 每帧位移都必须是
    // 满额 speed·dt。旧实现每经过一个路径点就有一帧只递增索引不移动（零位移）。
    const dt = 1 / 60
    const before = new THREE.Vector3()
    for (let f = 0; f < 60; f++) {
      before.copy(ghost.mesh.position)
      ghost.update(dt)
      expect(before.distanceTo(ghost.mesh.position)).toBeCloseTo(2.8 * dt, 6)
    }
  })

  it('大步长一帧连续跨越多个路径点：位移不过冲、索引同步推进', () => {
    ghost.setSpeed(20) // dt=0.1 → 单帧位移预算 2.0，远超路径点间隔 1.0
    const p0 = setupPath([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ])

    ghost.update(0.1)
    // 位移预算完整消费且保持在共线路径上（旧实现朝首点方向冲 2.0 但索引原地不动）
    expect(ghost.mesh.position.distanceTo(p0)).toBeCloseTo(2.0, 6)
    expect(ghost.mesh.position.z).toBeCloseTo(p0.z, 6)
    expect((ghost as any).pathIndex).toBeGreaterThanOrEqual(1)
  })

  it('转向是连续渐进的，不再一帧瞬跳到位', () => {
    ghost.setSpeed(2.8)
    setupPath([
      [1, 0],
      [2, 0],
      [3, 0],
    ])
    ghost.mesh.rotation.set(0, 0, 0) // 面朝世界 +Z；路径朝 +X → 目标 yaw = π/2

    ghost.update(1 / 60)
    const firstYaw = ghost.mesh.rotation.y
    expect(firstYaw).toBeGreaterThan(0) // 开始转向
    expect(firstYaw).toBeLessThan(Math.PI / 2 - 0.3) // 但单帧远未到位（旧 lookAt 一帧直达）

    for (let f = 0; f < 60; f++) {
      ghost.update(1 / 60)
    }
    expect(Math.abs(ghost.mesh.rotation.y - Math.PI / 2)).toBeLessThan(0.05)
  })

  it('抓捕判定：单层箱顶摸得着、双层柜顶绝对安全、躲藏免疫', () => {
    const g = ghost as any
    const base = v(world, 35, 40)
    // 每次摆位后跑一帧近零 dt 的 update：返回值即抓捕判定（位置几乎不动）
    const caught = (px: number, pz: number, py: number, gx: number, gz: number): boolean => {
      fakePlayer.pos.set(px, py, pz)
      fakePlayer.isHidden = false
      ghost.mesh.position.set(gx, 1, gz)
      g.state = 'patrol'
      g.path = []
      g.pathIndex = 0
      return ghost.update(1e-9)
    }

    // 单层箱顶（脚高 1.5）：幽灵站相邻格中心（水平 1.0）应能抓到——
    // 旧 3D 球形判定 √(1²+0.5²)≈1.118 > 1.0 抓不到，箱顶成了挂机点
    expect(caught(base.x, base.z, 1.5, base.x + 1, base.z)).toBe(true)

    // 双层柜顶（脚高 2.5）：水平贴零也绝对安全（高度窗排除）
    expect(caught(base.x, base.z, 2.5, base.x, base.z)).toBe(false)

    // 地面贴身照常抓；水平超出臂展不抓
    expect(caught(base.x, base.z, 0.5, base.x + 0.5, base.z)).toBe(true)
    expect(caught(base.x, base.z, 0.5, base.x + 1.3, base.z)).toBe(false)

    // 躲藏中（柜子里）任何距离都免疫
    fakePlayer.pos.set(base.x, 1, base.z)
    fakePlayer.isHidden = true
    ghost.mesh.position.set(base.x, 1, base.z)
    g.state = 'patrol'
    g.path = []
    g.pathIndex = 0
    expect(ghost.update(1e-9)).toBe(false)
    fakePlayer.isHidden = false
    fakePlayer.pos.copy(world.walkableNodes[0])
  })

  it('追击待机分两档：丢失视线 5 秒放弃恢复巡逻（无冷却），看得见维持 10 秒对峙', () => {
    const g = ghost as any
    const p0 = v(world, GX, GZ)
    const boxCell = v(world, GX, GZ + 1)
    const boxKey = `${Math.round(boxCell.x)},1,${Math.round(boxCell.z)}`
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // —— 丢失视线档：玩家从头顶跳过后的残留场景——target 带跳跃高度（3D 距离
      //    1.5 > 1，"到达放弃"永不触发），玩家本人已跑远（>20 米 → canSee=false）
      vi.setSystemTime(1_000_000)
      ghost.mesh.position.set(p0.x, 1, p0.z)
      fakePlayer.pos.copy(world.walkableNodes[0])
      fakePlayer.isHidden = false
      g.state = 'chase'
      g.target.set(p0.x, 2.5, p0.z)
      g.path = []
      g.pathIndex = 0
      g.chaseStuckSince = 0
      g.chaseBlockedUntil = 0
      g.lastPathTime = 1_000_000

      ghost.update(1 / 60) // 启动待机计时
      expect(g.state).toBe('chase')

      vi.setSystemTime(1_000_000 + 4900)
      ghost.update(1 / 60) // 4.9 秒：仍定在原地（旧行为要罚站满 10 秒）
      expect(g.state).toBe('chase')
      expect(ghost.mesh.position.distanceTo(p0)).toBeLessThan(1e-6)

      vi.setSystemTime(1_000_000 + 5100)
      ghost.update(1 / 60) // 过 5 秒：放弃追击恢复巡逻，且不进巡逻冷却
      expect(g.state).toBe('patrol')
      expect(g.chaseBlockedUntil).toBe(0)

      // —— 看得见档：箱顶对峙——玩家站在幽灵正前方相邻格的"箱顶"上，
      //    目标格被家具阻塞（A* 只能给出幽灵自身格 → 空路径待机）
      vi.setSystemTime(2_000_000)
      ghost.mesh.position.set(p0.x, 1, p0.z)
      ghost.mesh.rotation.set(0, 0, 0) // 面朝 +Z，正对玩家 → 视锥内
      fakePlayer.pos.set(boxCell.x, 2.5, boxCell.z)
      world.furnitureBlocks.add(boxKey)
      g.state = 'patrol'
      g.path = []
      g.pathIndex = 0
      g.chaseStuckSince = 0
      g.chaseBlockedUntil = 0
      g.lastPathTime = 0

      ghost.update(1 / 60) // canSee → 进入 chase，目标格阻塞 → 空路径 → 计时开始
      expect(g.state).toBe('chase')

      vi.setSystemTime(2_000_000 + 5500)
      ghost.update(1 / 60) // 5.5 秒：看得见 → 仍守着（若误用 5 秒档此处已放弃）
      expect(g.state).toBe('chase')

      vi.setSystemTime(2_000_000 + 10100)
      ghost.update(1 / 60) // 过 10 秒：放弃 + 开启巡逻冷却（防 canSee 立刻拉回）
      expect(g.state).toBe('patrol')
      expect(g.chaseBlockedUntil).toBeGreaterThan(0)
    } finally {
      world.furnitureBlocks.delete(boxKey)
      vi.useRealTimers()
      fakePlayer.pos.copy(world.walkableNodes[0])
      fakePlayer.isHidden = false
    }
  })

  it('前瞻直线检查：拒斜穿墙角对角缝、家具算阻挡、正常直线放行', () => {
    const g = ghost as any
    const toW = (gx: number, gz: number): [number, number] => [
      gx - world.MAP_WIDTH / 2,
      gz - world.MAP_DEPTH / 2,
    ]
    // 房间 5 内部人工布置场景（用完恢复）：对角双墙 (36,44)、(37,45)
    world.grid[36][44] = 1
    world.grid[37][45] = 1
    const [fwx, fwz] = toW(37, 43)
    try {
      // ① 斜穿对角缝：(37,44) → (36,45) 的两个正交过渡格都是墙，
      //    幽灵有体积不可斜穿（视线版 Bresenham 会放行这条线）
      expect(g.hasWalkableLine(v(world, 37, 44), v(world, 36, 45))).toBe(false)

      // ② 正常直线放行：横穿三格 (36,43)→(38,43)；先清掉中间格 (37,43)
      //    可能随机落上的家具，保证断言确定性（delete 不存在的 key 无害）
      world.furnitureBlocks.delete(`${fwx},1,${fwz}`)
      world.furnitureBlocks.delete(`${fwx},2,${fwz}`)
      expect(g.hasWalkableLine(v(world, 36, 43), v(world, 38, 43))).toBe(true)

      // ③ 家具算阻挡：同一条线的中间格放上家具立即被拒
      //    （视线版对矮家具是放行的，行走版必须拒——否则拉直后穿模）
      world.furnitureBlocks.add(`${fwx},1,${fwz}`)
      expect(g.hasWalkableLine(v(world, 36, 43), v(world, 38, 43))).toBe(false)
    } finally {
      world.grid[36][44] = 0
      world.grid[37][45] = 0
      world.furnitureBlocks.delete(`${fwx},1,${fwz}`)
    }
  })
})
