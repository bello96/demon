import * as THREE from 'three'
import { materials } from './utils'
import type { World } from './world'
import type { Player } from './player'
import type { SoundGenerator } from './sound_generator'

// ---------- Binary Min-Heap for A* ----------
interface PathNode {
  x: number
  z: number
  f: number
}

class MinHeap {
  private data: PathNode[] = []

  get size(): number { return this.data.length }

  push(item: PathNode): void {
    this.data.push(item)
    this.bubbleUp(this.data.length - 1)
  }

  pop(): PathNode | undefined {
    if (this.data.length === 0) { return undefined }
    const top = this.data[0]
    const last = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = last
      this.sinkDown(0)
    }
    return top
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.data[i].f < this.data[parent].f) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]]
        i = parent
      } else {
        break
      }
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length
    while (true) {
      let smallest = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && this.data[l].f < this.data[smallest].f) { smallest = l }
      if (r < n && this.data[r].f < this.data[smallest].f) { smallest = r }
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]]
        i = smallest
      } else {
        break
      }
    }
  }
}

// ---------- Neighbor offsets ----------
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

// 追击卡死（路径无法推进，典型场景：玩家站在箱子顶、跳过幽灵后留下的不可达目标）
// 的待机阈值。期间幽灵原地静止，超时后由 abandonChase + chaseBlockedUntil 接力处理。
const CHASE_STUCK_TIMEOUT_MS = 10000

// 待机超时后强制进入"巡逻冷却"：即便 canSee 仍为 true 也拒绝重新进入 chase，
// 让幽灵真正离开原地；玩家跳下箱子（grid 变化）或进入隐藏会立刻解除。
const POST_STUCK_CHASE_BLOCK_MS = 6000

// ---------- Ghost ----------
export class Ghost {
  mesh: THREE.Group

  private target = new THREE.Vector3()
  private state: 'patrol' | 'chase' = 'patrol'
  private speed = 2.8

  private path: THREE.Vector3[] = []
  private pathIndex = 0
  private lastPathTime = 0
  private chaseStuckSince = 0
  // 追击卡死超时后的巡逻冷却窗口；Date.now() 过此值才允许再次进入 chase
  private chaseBlockedUntil = 0
  // 进入冷却时记录玩家当时所在 grid 格子，玩家离开该格子即解除冷却
  private chaseBlockedGridX = 0
  private chaseBlockedGridZ = 0

  // Pre-allocated vectors
  private readonly _toPlayer = new THREE.Vector3()
  private readonly _ghostDir = new THREE.Vector3()
  private readonly _moveDir = new THREE.Vector3()

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private player: Player,
    private listener: THREE.AudioListener,
    private soundGen: SoundGenerator
  ) {
    this.mesh = new THREE.Group()
    this.createMesh()
  }

  private createMesh(): void {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.3), materials.obsidian)
    body.position.y = 0.9
    this.mesh.add(body)

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), materials.obsidian)
    head.position.y = 2.05
    this.mesh.add(head)

    const eyeGeo = new THREE.BoxGeometry(0.1, 0.05, 0.05)
    const leftEye = new THREE.Mesh(eyeGeo, materials.glow)
    leftEye.position.set(-0.1, 2.05, 0.26)
    this.mesh.add(leftEye)

    const rightEye = new THREE.Mesh(eyeGeo, materials.glow)
    rightEye.position.set(0.1, 2.05, 0.26)
    this.mesh.add(rightEye)

    if (this.listener && this.soundGen) {
      const sound = new THREE.PositionalAudio(this.listener)
      const buffer = this.soundGen.getGhostBuffer()
      if (buffer) {
        sound.setBuffer(buffer)
        sound.setRefDistance(1)
        sound.setRolloffFactor(2)
        sound.setLoop(true)
        sound.setVolume(1.5)
        sound.play()
      }
      this.mesh.add(sound)
    }

    this.scene.add(this.mesh)
  }

  spawn(): void {
    let spawnNode = this.world.walkableNodes[0]
    let maxDist = 0
    for (const node of this.world.walkableNodes) {
      const d = node.distanceTo(this.player.pos)
      if (d > maxDist) {
        maxDist = d
        spawnNode = node
      }
    }
    if (spawnNode) {
      this.mesh.position.copy(spawnNode)
      this.mesh.position.y = 1
      this.target.copy(this.mesh.position)
    }
  }

  reset(): void {
    this.state = 'patrol'
    this.path = []
    this.pathIndex = 0
    this.lastPathTime = 0
    this.chaseStuckSince = 0
    this.chaseBlockedUntil = 0
  }

  /** Bresenham line-of-sight on the grid — O(distance), zero allocations */
  private hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const offsetX = -this.world.MAP_WIDTH / 2
    const offsetZ = -this.world.MAP_DEPTH / 2

    let x0 = Math.round(from.x - offsetX)
    let z0 = Math.round(from.z - offsetZ)
    const x1 = Math.round(to.x - offsetX)
    const z1 = Math.round(to.z - offsetZ)

    const dx = Math.abs(x1 - x0)
    const dz = Math.abs(z1 - z0)
    const sx = x0 < x1 ? 1 : -1
    const sz = z0 < z1 ? 1 : -1
    let err = dx - dz

    while (x0 !== x1 || z0 !== z1) {
      if (x0 >= 0 && x0 < this.world.MAP_WIDTH && z0 >= 0 && z0 < this.world.MAP_DEPTH) {
        if (this.world.grid[x0][z0] === 1) { return false }
        // 高家具（橱柜）同样遮挡视线——玩家可以真正藏在箱子后面
        if (this.world.hasTallFurnitureAtGrid(x0, z0)) { return false }
      }
      const e2 = 2 * err
      if (e2 > -dz) { err -= dz; x0 += sx }
      if (e2 < dx) { err += dx; z0 += sz }
    }
    return true
  }

  /** A* with binary heap + closed set */
  private findPath(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] {
    const offsetX = -this.world.MAP_WIDTH / 2
    const offsetZ = -this.world.MAP_DEPTH / 2
    const depth = this.world.MAP_DEPTH

    const startX = Math.round(start.x - offsetX)
    const startZ = Math.round(start.z - offsetZ)
    const endX = Math.round(end.x - offsetX)
    const endZ = Math.round(end.z - offsetZ)

    const key = (x: number, z: number): number => x * depth + z

    const open = new MinHeap()
    const gCost = new Map<number, number>()
    const cameFrom = new Map<number, number>()
    const closed = new Set<number>()

    const startKey = key(startX, startZ)
    gCost.set(startKey, 0)
    open.push({ x: startX, z: startZ, f: Math.abs(startX - endX) + Math.abs(startZ - endZ) })

    let found = false
    let closestX = startX
    let closestZ = startZ
    let minDist = Infinity
    let iterations = 0

    while (open.size > 0 && iterations < 2000) {
      iterations++
      const current = open.pop()!
      const currentKey = key(current.x, current.z)

      if (closed.has(currentKey)) { continue }
      closed.add(currentKey)

      const d = Math.abs(current.x - endX) + Math.abs(current.z - endZ)
      if (d < minDist) {
        minDist = d
        closestX = current.x
        closestZ = current.z
      }

      if (d === 0) {
        found = true
        break
      }

      const currentG = gCost.get(currentKey)!

      for (const [dx, dz] of DIRS) {
        const nx = current.x + dx
        const nz = current.z + dz

        if (nx < 0 || nx >= this.world.MAP_WIDTH || nz < 0 || nz >= this.world.MAP_DEPTH) { continue }

        const nKey = key(nx, nz)
        if (closed.has(nKey)) { continue }
        if (this.world.grid[nx][nz] === 1) { continue }

        const wx = nx + offsetX
        const wz = nz + offsetZ
        if (this.world.hasFurnitureAt(wx, wz)) { continue }

        const newG = currentG + 1
        const existingG = gCost.get(nKey)

        if (existingG === undefined || newG < existingG) {
          gCost.set(nKey, newG)
          cameFrom.set(nKey, currentKey)
          const h = Math.abs(nx - endX) + Math.abs(nz - endZ)
          open.push({ x: nx, z: nz, f: newG + h })
        }
      }
    }

    // Reconstruct path
    const path: THREE.Vector3[] = []
    let curr = found ? key(endX, endZ) : key(closestX, closestZ)

    while (curr !== startKey) {
      const cx = Math.floor(curr / depth)
      const cz = curr % depth
      path.push(new THREE.Vector3(cx + offsetX, 1, cz + offsetZ))
      const prev = cameFrom.get(curr)
      if (prev === undefined) { break }
      curr = prev
    }
    return path.reverse()
  }

  update(dt: number): boolean {
    const dist = this.mesh.position.distanceTo(this.player.pos)
    const now = Date.now()

    // 1. Vision check (Bresenham LOS instead of expensive raycasting)
    let canSee = false
    if (!this.player.isHidden && dist < 20) {
      this._toPlayer.subVectors(this.player.pos, this.mesh.position).normalize()
      this._ghostDir.set(0, 0, 1).applyQuaternion(this.mesh.quaternion)

      if (this._toPlayer.dot(this._ghostDir) > 0.3) {
        canSee = this.hasLineOfSight(this.mesh.position, this.player.pos)
      }
    }

    // 1.5 追击冷却窗口：待机超时后禁止立即重新进入 chase（让幽灵先 patrol 离开）。
    //     玩家隐藏 / 离开待机时所在 grid 格子 → 立即解除冷却，兼容"跳下箱子立刻恢复追击"。
    const playerGridX = Math.round(this.player.pos.x + this.world.MAP_WIDTH / 2)
    const playerGridZ = Math.round(this.player.pos.z + this.world.MAP_DEPTH / 2)
    if (now < this.chaseBlockedUntil) {
      if (this.player.isHidden ||
          playerGridX !== this.chaseBlockedGridX ||
          playerGridZ !== this.chaseBlockedGridZ) {
        this.chaseBlockedUntil = 0
      }
    }

    // 2. State machine
    if (canSee && now >= this.chaseBlockedUntil) {
      this.state = 'chase'
      this.target.copy(this.player.pos)
    } else if (this.state === 'chase') {
      // 玩家躲起来了（例如进箱子）→ 立即放弃追击
      if (this.player.isHidden) {
        this.abandonChase()
      } else if (this.mesh.position.distanceTo(this.target) < 1) {
        this.abandonChase()
      }
    }

    // 3. Pathfinding
    if (this.state === 'chase') {
      if (now - this.lastPathTime > 500) {
        this.path = this.findPath(this.mesh.position, this.target)
        this.pathIndex = 0
        this.lastPathTime = now
      }
    } else if (this.state === 'patrol') {
      if (this.path.length === 0 || this.pathIndex >= this.path.length) {
        if (this.world.walkableNodes.length > 0) {
          const rNode = this.world.walkableNodes[Math.floor(Math.random() * this.world.walkableNodes.length)]
          this.target.copy(rNode)
          this.path = this.findPath(this.mesh.position, this.target)
          this.pathIndex = 0
        }
      }
    }

    // 3.5 追击待机：追击中路径无法推进（玩家在箱顶等不可达点，或被跳过后目标点是 A*
    //     返回的最近替代点）即进入原地静止，累计 10 秒后放弃追击 + 开启巡逻冷却，
    //     让幽灵真正离开而非被 canSee=true 立刻拉回 chase 形成永久静止。
    if (this.state === 'chase') {
      const pathDone = this.path.length === 0 || this.pathIndex >= this.path.length
      if (pathDone) {
        if (this.chaseStuckSince === 0) {
          this.chaseStuckSince = now
        } else if (now - this.chaseStuckSince >= CHASE_STUCK_TIMEOUT_MS) {
          this.abandonChase()
          this.chaseBlockedUntil = now + POST_STUCK_CHASE_BLOCK_MS
          this.chaseBlockedGridX = playerGridX
          this.chaseBlockedGridZ = playerGridZ
        }
      } else {
        this.chaseStuckSince = 0
      }
    } else {
      this.chaseStuckSince = 0
    }

    // 4. Move along path
    if (this.path.length > 0 && this.pathIndex < this.path.length) {
      const nextPoint = this.path[this.pathIndex]
      this._moveDir.subVectors(nextPoint, this.mesh.position)
      this._moveDir.y = 0
      const d = this._moveDir.length()

      if (d < 0.1) {
        this.pathIndex++
      } else {
        this._moveDir.normalize()
        this.mesh.lookAt(nextPoint.x, this.mesh.position.y, nextPoint.z)
        const moveSpeed = this.state === 'chase' ? this.speed * 1.5 : this.speed
        this.mesh.position.addScaledVector(this._moveDir, moveSpeed * dt)
      }
    }

    return !this.player.isHidden && dist < 1.0
  }

  private abandonChase(): void {
    this.state = 'patrol'
    this.path = []
    this.pathIndex = 0
    this.chaseStuckSince = 0
  }
}
