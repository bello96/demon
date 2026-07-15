import * as THREE from 'three'
import { createPixelTexture, materials } from './utils'
import { t } from './localization'
import type { Room, RoomLayout, Interactable, LightSwitch, MansionOptions, ThemeSurface } from './types'

export class World {
  readonly BLOCK_SIZE = 1
  // 净层高（米）：地板顶面 0.5 → 天花板底面 WALL_HEIGHT+0.5，碰撞判定按此推导。
  // 墙体由 WALL_LAYERS 层方块堆成，每层 y 向拉伸 WALL_HEIGHT/WALL_LAYERS（=1.125，
  // 贴图纵向微拉伸可接受）——原 4 米体感偏矮，按需求提到 4.5 米
  readonly WALL_HEIGHT = 4.5
  readonly WALL_LAYERS = 4
  readonly MAP_WIDTH = 100
  readonly MAP_DEPTH = 100

  grid: number[][] = []
  furnitureBlocks = new Set<string>()
  // 高家具（遮挡视线），例如橱柜 —— 供幽灵视线算法查询；矮家具仅阻挡移动不入此集合
  tallFurnitureBlocks = new Set<string>()
  interactables: Interactable[] = []
  walkableNodes: THREE.Vector3[] = []
  rooms: Room[] = []
  lightSwitch: LightSwitch | null = null
  switchRoomId = -1
  spawnRoomId = -1

  private scene: THREE.Scene
  private geometry: THREE.BoxGeometry
  private worldGroup: THREE.Group
  // 小地图墙体静态缓存：生成一次，重开时清空
  private wallMapCanvas: HTMLCanvasElement | null = null

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.geometry = new THREE.BoxGeometry(this.BLOCK_SIZE, this.BLOCK_SIZE, this.BLOCK_SIZE)
    this.worldGroup = new THREE.Group()
    this.scene.add(this.worldGroup)
  }

  private addFurniture(x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.worldGroup.add(mesh)
    const key = `${Math.round(x)},${Math.round(y)},${Math.round(z)}`
    this.furnitureBlocks.add(key)
    // addFurniture 出的全部是 1×1×1 立方体（橱柜），视为视线遮挡物
    this.tallFurnitureBlocks.add(key)
    return mesh
  }

  private createRoomNumber(x: number, y: number, z: number, num: number): void {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 80px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(num.toString(), 64, 64)

    const tex = new THREE.CanvasTexture(canvas)
    const mat = new THREE.MeshBasicMaterial({ map: tex })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
    mesh.position.set(x, y + 0.01, z)
    mesh.rotation.x = -Math.PI / 2
    this.worldGroup.add(mesh)
  }

  /** L 形挖廊：先沿 x 在 z1 行走到 x2，再沿 z 在 x2 列走到 z2 */
  private carveL(x1: number, z1: number, x2: number, z2: number): void {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      this.grid[x][z1] = 0
    }
    for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
      this.grid[x2][z] = 0
    }
  }

  /** 从 (sx,sz) 出发四邻可达的空地集合（key = x*MAP_DEPTH+z）；起点无效/非空地返回 null */
  private floodFrom(sx: number, sz: number): Set<number> | null {
    if (sx < 0 || sz < 0 || sx >= this.MAP_WIDTH || sz >= this.MAP_DEPTH) {
      return null
    }
    if (this.grid[sx][sz] !== 0) {
      return null
    }
    const visited = new Set<number>([sx * this.MAP_DEPTH + sz])
    const stack: number[] = [sx * this.MAP_DEPTH + sz]
    while (stack.length > 0) {
      const key = stack.pop()!
      const x = Math.floor(key / this.MAP_DEPTH)
      const z = key % this.MAP_DEPTH
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const nz = z + dz
        if (nx < 0 || nx >= this.MAP_WIDTH || nz < 0 || nz >= this.MAP_DEPTH) {
          continue
        }
        const nk = nx * this.MAP_DEPTH + nz
        if (this.grid[nx][nz] === 0 && !visited.has(nk)) {
          visited.add(nk)
          stack.push(nk)
        }
      }
    }
    return visited
  }

  /** 两格之间是否存在四邻路径（防死局兜底用） */
  private gridPathExists(x1: number, z1: number, x2: number, z2: number): boolean {
    const region = this.floodFrom(x1, z1)
    return region !== null && region.has(x2 * this.MAP_DEPTH + z2)
  }

  generateMansion(roomLayout: RoomLayout[], opts: MansionOptions = {}): void {
    // 1. Initialize grid (all walls)
    for (let x = 0; x < this.MAP_WIDTH; x++) {
      this.grid[x] = new Array<number>(this.MAP_DEPTH).fill(1)
    }

    const rooms: Room[] = []

    // 2. Carve rooms
    roomLayout.forEach((r, index) => {
      if (r.x + r.w < this.MAP_WIDTH && r.z + r.d < this.MAP_DEPTH) {
        const room: Room = { ...r, id: index + 1 }
        rooms.push(room)
        for (let rx = r.x; rx < r.x + r.w; rx++) {
          for (let rz = r.z; rz < r.z + r.d; rz++) {
            this.grid[rx][rz] = 0
          }
        }
      }
    })

    // 2.5 手画走廊矩形（关卡编辑器产物）：按矩形原样挖空，宽度即矩形短边；
    // 与房间/彼此重叠或贴边自然打通。出界部分裁剪（四周至少留 1 格外墙）
    const corridorRects = opts.corridorRects ?? []
    for (const c of corridorRects) {
      const x1 = Math.min(this.MAP_WIDTH - 2, c.x + c.w - 1)
      const z1 = Math.min(this.MAP_DEPTH - 2, c.z + c.d - 1)
      for (let x = Math.max(1, c.x); x <= x1; x++) {
        for (let z = Math.max(1, c.z); z <= z1; z++) {
          this.grid[x][z] = 0
        }
      }
    }

    // 3. 独木不成林：连通性只看格级事实（房间贴边/重叠、走廊搭接都算通），
    // 绝不凭空生成走廊。唯一的例外是防死局兜底——绕过编辑器校验的孤岛房间
    // 沿前一房间补一条直廊，否则钥匙/门落在孤岛里就是死局
    for (let i = 1; i < rooms.length; i++) {
      const head = rooms[0]
      const cur = rooms[i]
      if (
        !this.gridPathExists(
          Math.floor(head.x + head.w / 2),
          Math.floor(head.z + head.d / 2),
          Math.floor(cur.x + cur.w / 2),
          Math.floor(cur.z + cur.d / 2),
        )
      ) {
        const prev = rooms[i - 1]
        this.carveL(
          Math.floor(prev.x + prev.w / 2),
          Math.floor(prev.z + prev.d / 2),
          Math.floor(cur.x + cur.w / 2),
          Math.floor(cur.z + cur.d / 2),
        )
      }
    }

    // 4. Collect walkable nodes —— 只收与 1 号房连通的主区域：
    // 悬空的手画走廊（没接到任何房间）不能成为幽灵的出生/巡逻点
    const offsetX = -this.MAP_WIDTH / 2
    const offsetZ = -this.MAP_DEPTH / 2
    const totalCells = this.MAP_WIDTH * this.MAP_DEPTH
    const mainRegion = this.floodFrom(
      rooms.length > 0 ? Math.floor(rooms[0].x + rooms[0].w / 2) : -1,
      rooms.length > 0 ? Math.floor(rooms[0].z + rooms[0].d / 2) : -1,
    )

    for (let x = 0; x < this.MAP_WIDTH; x++) {
      for (let z = 0; z < this.MAP_DEPTH; z++) {
        if (
          this.grid[x][z] === 0 &&
          (mainRegion === null || mainRegion.has(x * this.MAP_DEPTH + z))
        ) {
          this.walkableNodes.push(new THREE.Vector3(x + offsetX, 1, z + offsetZ))
        }
      }
    }

    // 5. 解析关卡主题为五个表面材质：preset 用共享单例（dispose 白名单成员，不会被误清），
    // color 现做像素噪点材质、image 从 data URL 现载贴图——都挂上网格后由
    // disposeWorldResources 在下次重建时自动回收（材质连同 map 一起）
    const themeMat = (spec: ThemeSurface | undefined, fallback: THREE.Material): THREE.Material => {
      if (!spec) { return fallback }
      if (spec.type === 'preset') {
        const m = (materials as Record<string, THREE.Material | undefined>)[spec.value]
        return m ?? fallback
      }
      if (spec.type === 'image') {
        // data URL 同步返回纹理、异步解码，图片就绪前该面短暂显示材质底色
        const tex = new THREE.TextureLoader().load(spec.value)
        tex.colorSpace = THREE.SRGBColorSpace
        return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
      }
      return new THREE.MeshStandardMaterial({
        map: createPixelTexture(spec.value, 0.15, true),
        roughness: 0.85,
      })
    }
    const theme = opts.theme
    const roomFloorM = themeMat(theme?.roomFloor, materials.floor1)
    const corridorFloorM = themeMat(theme?.corridorFloor, materials.planks)
    const roomWallM = themeMat(theme?.roomWall, materials.roomWall)
    const corridorWallM = themeMat(theme?.corridorWall, materials.stone)
    const ceilingM = themeMat(theme?.ceiling, materials.ceiling)

    // Assign each room a floor material（房间地板可扩展为多选随机，当前全房统一主题地板）
    const roomFloorChoices: THREE.Material[] = [roomFloorM]
    const roomFloorMat = new Map<number, THREE.Material>()
    for (const r of rooms) {
      roomFloorMat.set(r.id, roomFloorChoices[Math.floor(Math.random() * roomFloorChoices.length)])
    }

    // 6. 预计算每个格子属于哪个房间（-1 表示不在任何房间内）
    const cellRoomId: number[] = new Array(totalCells).fill(-1)
    for (const r of rooms) {
      for (let rx = r.x; rx < r.x + r.w; rx++) {
        for (let rz = r.z; rz < r.z + r.d; rz++) {
          cellRoomId[rx * this.MAP_DEPTH + rz] = r.id
        }
      }
    }

    // 7. Classify every cell: floor material + wall category
    // 墙分三类：
    //   room  —— 所有相邻可走格都在房间内（整面都是瓷砖）
    //   corridor —— 没有房间相邻（纯走廊或完全封闭的墙）
    //   corner —— 同时有房间相邻和走廊相邻，这种是视觉上的 90° 转角
    //             单独用多材质 Mesh 渲染，面向房间的面贴瓷砖，面向走廊的面贴砖纹
    //             纹理切换恰好发生在立方体两面之间的那条边线上，视觉上就是"拐角分割"
    const floorMatPerCell: THREE.Material[] = new Array(totalCells)
    const isRoomWallPerCell: boolean[] = new Array(totalCells).fill(false)
    const isCornerWallPerCell: boolean[] = new Array(totalCells).fill(false)
    const cornerCells: Array<[number, number]> = []
    const floorMatCounts = new Map<THREE.Material, number>()
    floorMatCounts.set(corridorFloorM, 0)
    for (const mat of roomFloorChoices) { floorMatCounts.set(mat, 0) }

    let corridorWallCount = 0
    let roomWallCount = 0

    for (let x = 0; x < this.MAP_WIDTH; x++) {
      for (let z = 0; z < this.MAP_DEPTH; z++) {
        const cellIdx = x * this.MAP_DEPTH + z

        const roomId = cellRoomId[cellIdx]
        const floorMat: THREE.Material = roomId === -1 ? corridorFloorM : roomFloorMat.get(roomId)!
        floorMatPerCell[cellIdx] = floorMat
        floorMatCounts.set(floorMat, (floorMatCounts.get(floorMat) ?? 0) + 1)

        if (this.grid[x][z] === 1) {
          let hasRoomNeighbor = false
          let hasCorridorNeighbor = false

          if (x > 0 && this.grid[x - 1][z] === 0) {
            if (cellRoomId[(x - 1) * this.MAP_DEPTH + z] !== -1) { hasRoomNeighbor = true }
            else { hasCorridorNeighbor = true }
          }
          if (x < this.MAP_WIDTH - 1 && this.grid[x + 1][z] === 0) {
            if (cellRoomId[(x + 1) * this.MAP_DEPTH + z] !== -1) { hasRoomNeighbor = true }
            else { hasCorridorNeighbor = true }
          }
          if (z > 0 && this.grid[x][z - 1] === 0) {
            if (cellRoomId[x * this.MAP_DEPTH + (z - 1)] !== -1) { hasRoomNeighbor = true }
            else { hasCorridorNeighbor = true }
          }
          if (z < this.MAP_DEPTH - 1 && this.grid[x][z + 1] === 0) {
            if (cellRoomId[x * this.MAP_DEPTH + (z + 1)] !== -1) { hasRoomNeighbor = true }
            else { hasCorridorNeighbor = true }
          }

          if (hasRoomNeighbor && hasCorridorNeighbor) {
            isCornerWallPerCell[cellIdx] = true
            cornerCells.push([x, z])
          } else if (hasRoomNeighbor) {
            isRoomWallPerCell[cellIdx] = true
            roomWallCount += this.WALL_LAYERS
          } else {
            corridorWallCount += this.WALL_LAYERS
          }
        }
      }
    }

    // 8. Build 3D world with InstancedMesh + per-corner multi-material Mesh
    const matrix = new THREE.Matrix4()
    // 墙块专用矩阵与复用对象：墙块带 y 向拉伸（与地板/天花板的 matrix 分开，
    // 避免 setPosition 残留 compose 写入的 scale 分量）
    const layerScale = this.WALL_HEIGHT / this.WALL_LAYERS
    const matrixWall = new THREE.Matrix4()
    const wallPos = new THREE.Vector3()
    const wallQuat = new THREE.Quaternion()
    const wallScale = new THREE.Vector3(1, layerScale, 1)

    const floorMeshes = new Map<THREE.Material, THREE.InstancedMesh>()
    const floorIdxMap = new Map<THREE.Material, number>()
    for (const [mat, count] of floorMatCounts) {
      if (count === 0) { continue }
      const mesh = new THREE.InstancedMesh(this.geometry, mat, count)
      mesh.receiveShadow = true
      floorMeshes.set(mat, mesh)
      floorIdxMap.set(mat, 0)
    }

    const ceilingMesh = new THREE.InstancedMesh(this.geometry, ceilingM, totalCells)
    ceilingMesh.receiveShadow = true

    const corridorWallMesh = new THREE.InstancedMesh(this.geometry, corridorWallM, corridorWallCount)
    corridorWallMesh.castShadow = true
    corridorWallMesh.receiveShadow = true

    const roomWallMesh = new THREE.InstancedMesh(this.geometry, roomWallM, roomWallCount)
    roomWallMesh.castShadow = true
    roomWallMesh.receiveShadow = true

    let ceilingIdx = 0
    let corridorWallIdx = 0
    let roomWallIdx = 0

    for (let x = 0; x < this.MAP_WIDTH; x++) {
      for (let z = 0; z < this.MAP_DEPTH; z++) {
        const wx = x + offsetX
        const wz = z + offsetZ
        const cellIdx = x * this.MAP_DEPTH + z

        const floorMat = floorMatPerCell[cellIdx]
        const floorMesh = floorMeshes.get(floorMat)!
        const floorIdx = floorIdxMap.get(floorMat)!
        matrix.setPosition(wx, 0, wz)
        floorMesh.setMatrixAt(floorIdx, matrix)
        floorIdxMap.set(floorMat, floorIdx + 1)

        matrix.setPosition(wx, this.WALL_HEIGHT + 1, wz)
        ceilingMesh.setMatrixAt(ceilingIdx++, matrix)

        if (this.grid[x][z] === 1 && !isCornerWallPerCell[cellIdx]) {
          const isRoomWall = isRoomWallPerCell[cellIdx]
          for (let y = 1; y <= this.WALL_LAYERS; y++) {
            // 第 y 层拉伸块中心：墙体从 0.5 起、每层高 layerScale，无缝堆到 WALL_HEIGHT+0.5
            wallPos.set(wx, 0.5 + (y - 0.5) * layerScale, wz)
            matrixWall.compose(wallPos, wallQuat, wallScale)
            if (isRoomWall) {
              roomWallMesh.setMatrixAt(roomWallIdx++, matrixWall)
            } else {
              corridorWallMesh.setMatrixAt(corridorWallIdx++, matrixWall)
            }
          }
        }
      }
    }

    // 9. Build corner walls — each cube has per-face materials
    // BoxGeometry 的 6 个面分组顺序：[+x右, -x左, +y顶, -y底, +z南, -z北]
    // 面向房间内部的面贴瓷砖，其它面贴砖，切换发生在立方体的边线上
    const isRoomInterior = (nx: number, nz: number): boolean => {
      if (nx < 0 || nx >= this.MAP_WIDTH || nz < 0 || nz >= this.MAP_DEPTH) { return false }
      if (this.grid[nx][nz] !== 0) { return false }
      return cellRoomId[nx * this.MAP_DEPTH + nz] !== -1
    }

    for (const [x, z] of cornerCells) {
      const wx = x + offsetX
      const wz = z + offsetZ

      const cornerMaterials: THREE.Material[] = [
        isRoomInterior(x + 1, z) ? roomWallM : corridorWallM,
        isRoomInterior(x - 1, z) ? roomWallM : corridorWallM,
        corridorWallM,
        corridorWallM,
        isRoomInterior(x, z + 1) ? roomWallM : corridorWallM,
        isRoomInterior(x, z - 1) ? roomWallM : corridorWallM,
      ]

      for (let y = 1; y <= this.WALL_LAYERS; y++) {
        const cornerMesh = new THREE.Mesh(this.geometry, cornerMaterials)
        cornerMesh.position.set(wx, 0.5 + (y - 0.5) * layerScale, wz)
        cornerMesh.scale.y = layerScale
        cornerMesh.castShadow = true
        cornerMesh.receiveShadow = true
        this.worldGroup.add(cornerMesh)
      }
    }

    for (const mesh of floorMeshes.values()) {
      mesh.instanceMatrix.needsUpdate = true
      this.worldGroup.add(mesh)
    }
    ceilingMesh.instanceMatrix.needsUpdate = true
    corridorWallMesh.instanceMatrix.needsUpdate = true
    roomWallMesh.instanceMatrix.needsUpdate = true

    this.worldGroup.add(ceilingMesh)
    this.worldGroup.add(corridorWallMesh)
    this.worldGroup.add(roomWallMesh)

    // 10. Find spawn room
    const spawnNode = this.walkableNodes[Math.floor(this.walkableNodes.length / 2)]
    const spawnGridX = spawnNode.x - offsetX
    const spawnGridZ = spawnNode.z - offsetZ

    let spawnRoom: Room | null = null
    for (const r of rooms) {
      if (spawnGridX >= r.x && spawnGridX < r.x + r.w &&
          spawnGridZ >= r.z && spawnGridZ < r.z + r.d) {
        spawnRoom = r
        break
      }
    }
    this.spawnRoomId = spawnRoom ? spawnRoom.id : -1

    // 11. Room numbers
    rooms.forEach(r => {
      this.createRoomNumber(r.x + offsetX + r.w / 2, 0.02, r.z + offsetZ + r.d / 2, r.id)
    })

    // 12. Distribute items — 尽量分散：洗牌后的非出生房排前、出生房垫底，
    // 按序轮转分配；房间不够时绕回列表头复用，允许多件道具同房共处
    const others = rooms.filter(r => r.id !== this.spawnRoomId)
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]]
    }
    if (spawnRoom) {
      others.push(spawnRoom)
    }
    if (others.length === 0) {
      // 布局为空（全部越界被丢弃）：无处安置任何东西，直接收尾
      this.rooms = rooms
      return
    }
    let roomCursor = 0
    const nextRoom = (): Room => others[roomCursor++ % others.length]

    const doorRoom = nextRoom()
    const switchRoom = nextRoom()
    const keyRoom = nextRoom()
    // 关卡关闭小地图时雷达无处显示（雷达=在小地图标出幽灵位置），不投放也不占房
    const radarRoom = opts.radarEnabled !== false ? nextRoom() : null
    const shoesRoom = nextRoom()
    // 柜子占满剩余未用房间；一间不剩时也放 1 个，保证总有处可躲
    const cabinetRooms = roomCursor < others.length ? others.slice(roomCursor) : [nextRoom()]

    const randomInRoom = (r: Room): { x: number; z: number } => ({
      x: r.x + offsetX + 1 + Math.random() * (r.w - 2),
      z: r.z + offsetZ + 1 + Math.random() * (r.d - 2)
    })

    /** Pick a random valid wall position — ensures a wall block exists behind it */
    const randomOnWall = (r: Room): { x: number; z: number; rotY: number } => {
      type WP = { x: number; z: number; rotY: number }
      const candidates: WP[] = []
      const rx = r.x + offsetX
      const rz = r.z + offsetZ

      // North wall — check grid[gx][r.z - 1] is a wall
      if (r.z > 0) {
        for (let gx = r.x + 1; gx < r.x + r.w - 1; gx++) {
          if (this.grid[gx][r.z - 1] === 1) {
            candidates.push({ x: gx + offsetX, z: rz - 0.4, rotY: 0 })
          }
        }
      }
      // South wall — check grid[gx][r.z + r.d] is a wall
      if (r.z + r.d < this.MAP_DEPTH) {
        for (let gx = r.x + 1; gx < r.x + r.w - 1; gx++) {
          if (this.grid[gx][r.z + r.d] === 1) {
            candidates.push({ x: gx + offsetX, z: rz + r.d - 0.6, rotY: Math.PI })
          }
        }
      }
      // West wall — check grid[r.x - 1][gz] is a wall
      if (r.x > 0) {
        for (let gz = r.z + 1; gz < r.z + r.d - 1; gz++) {
          if (this.grid[r.x - 1][gz] === 1) {
            candidates.push({ x: rx - 0.4, z: gz + offsetZ, rotY: Math.PI / 2 })
          }
        }
      }
      // East wall — check grid[r.x + r.w][gz] is a wall
      if (r.x + r.w < this.MAP_WIDTH) {
        for (let gz = r.z + 1; gz < r.z + r.d - 1; gz++) {
          if (this.grid[r.x + r.w][gz] === 1) {
            candidates.push({ x: rx + r.w - 0.6, z: gz + offsetZ, rotY: -Math.PI / 2 })
          }
        }
      }

      if (candidates.length === 0) {
        return { x: rx + r.w / 2, z: rz + r.d / 2, rotY: 0 }
      }
      return candidates[Math.floor(Math.random() * candidates.length)]
    }

    // Door — random wall
    {
      const wp = randomOnWall(doorRoom)
      const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.5, 0.2), materials.door)
      doorMesh.position.set(wp.x, 1.25, wp.z)
      doorMesh.rotation.y = wp.rotY
      this.worldGroup.add(doorMesh)
      this.interactables.push({
        type: 'door',
        pos: new THREE.Vector3(wp.x, 1.25, wp.z),
        box: new THREE.Box3().setFromObject(doorMesh)
      })
    }

    // Switch — random wall
    {
      this.switchRoomId = switchRoom.id
      const wp = randomOnWall(switchRoom)

      const switchGroup = new THREE.Group()
      switchGroup.position.set(wp.x, 1.5, wp.z)
      switchGroup.rotation.y = wp.rotY
      this.worldGroup.add(switchGroup)

      const baseGeo = new THREE.BoxGeometry(0.3, 0.5, 0.1)
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x555555 })
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.castShadow = true
      switchGroup.add(base)

      const handleGeo = new THREE.BoxGeometry(0.08, 0.4, 0.08)
      handleGeo.translate(0, 0.2, 0)
      const handleMat = new THREE.MeshStandardMaterial({ color: 0xaa0000 })
      const handle = new THREE.Mesh(handleGeo, handleMat)
      handle.position.set(0, -0.1, 0.05)
      handle.rotation.x = -Math.PI / 4
      switchGroup.add(handle)

      this.lightSwitch = {
        pos: new THREE.Vector3(wp.x, 1.5, wp.z),
        box: new THREE.Box3().setFromObject(base),
        handle,
        isOn: false
      }
      this.interactables.push({
        type: 'switch',
        pos: this.lightSwitch.pos,
        box: this.lightSwitch.box,
        obj: this.lightSwitch
      })
    }

    // Key — random position in room
    {
      const kp = randomInRoom(keyRoom)
      const keyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.3, 0.3),
        this.makeItemMaterials(t('badgeKey'), '#ffd700'),
      )
      keyMesh.position.set(kp.x, 0.5, kp.z)
      this.worldGroup.add(keyMesh)
      this.interactables.push({
        type: 'key',
        pos: keyMesh.position.clone(),
        mesh: keyMesh
      })
    }

    // Radar — random position in room
    if (radarRoom) {
      const rp = randomInRoom(radarRoom)
      const radarMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.1, 0.4),
        this.makeItemMaterials(t('badgeRadar'), '#00ff00'),
      )
      radarMesh.position.set(rp.x, 0.5, rp.z)
      this.worldGroup.add(radarMesh)
      this.interactables.push({
        type: 'radar',
        pos: radarMesh.position.clone(),
        mesh: radarMesh
      })
    }

    // Shoes — 亮蓝悬浮方块（与钥匙/雷达同族的道具造型，比例居中便于区分）：
    // 拾取后步行速度 ×1.5（player 侧生效）
    {
      const sp = randomInRoom(shoesRoom)
      const shoesMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.2, 0.4),
        this.makeItemMaterials(t('badgeShoes'), '#1e90ff'),
      )
      shoesMesh.position.set(sp.x, 0.5, sp.z)
      this.worldGroup.add(shoesMesh)
      this.interactables.push({
        type: 'shoes',
        pos: shoesMesh.position.clone(),
        mesh: shoesMesh
      })
    }

    // 出生格坐标：柜子绝不允许压在这里，否则玩家开局卡死在家具内
    const spawnCellX = Math.round(spawnNode.x)
    const spawnCellZ = Math.round(spawnNode.z)

    // Cabinets — one per remaining room, random 1 or 2 layers.
    // 第一个保证是 2 层，避免极端情况下玩家完全无处可躲；
    // 2 层可躲进去并加入 interactables，1 层只是障碍物不参与交互。
    for (let i = 0; i < cabinetRooms.length; i++) {
      const r = cabinetRooms[i]
      let cp = randomInRoom(r)
      let cx = Math.round(cp.x)
      let cz = Math.round(cp.z)
      // 与出生格重合则重掷；极端不中则放弃本柜（宁缺毋卡死）
      for (let attempt = 0; attempt < 8 && cx === spawnCellX && cz === spawnCellZ; attempt++) {
        cp = randomInRoom(r)
        cx = Math.round(cp.x)
        cz = Math.round(cp.z)
      }
      if (cx === spawnCellX && cz === spawnCellZ) {
        continue
      }
      const isTall = i === 0 || Math.random() < 0.5
      const lowerMesh = this.addFurniture(cx, 1, cz, materials.cabinet)
      if (isTall) {
        const upperMesh = this.addFurniture(cx, 2, cz, materials.cabinet)
        this.interactables.push({
          type: 'cabinet',
          pos: new THREE.Vector3(cx, 1, cz),
          meshes: [lowerMesh, upperMesh]
        })
      }
    }

    this.rooms = rooms
  }

  regenerate(roomLayout: RoomLayout[], opts: MansionOptions = {}): void {
    this.disposeWorldResources()
    this.worldGroup.clear()
    this.grid = []
    this.furnitureBlocks.clear()
    this.tallFurnitureBlocks.clear()
    this.interactables = []
    this.walkableNodes = []
    this.rooms = []
    this.lightSwitch = null
    this.switchRoomId = -1
    this.spawnRoomId = -1
    this.wallMapCanvas = null
    this.generateMansion(roomLayout, opts)
  }

  /**
   * 道具带字材质组：文字只印在顶面（玩家俯视道具时正对视线的"正面"），
   * 四个侧面与底面用同色纯色材质——按需求侧边不带字。
   * 底色即道具识别色，字用半透明黑在金/绿/蓝亮底上都清楚。
   * 每次生成都是新材质+CanvasTexture，由 disposeWorldResources 白名单外机制自动回收。
   */
  private makeItemMaterials(text: string, baseColor: string): THREE.MeshStandardMaterial[] {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = baseColor
    ctx.fillRect(0, 0, size, size)
    ctx.font = 'bold 52px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillText(text, size / 2, size / 2)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.3 })
    const sideMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.4, metalness: 0.3 })
    // BoxGeometry 面序 [+x, -x, +y(顶), -y, +z, -z]：仅顶面用带字材质
    return [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]
  }

  /**
   * 释放 worldGroup 下所有非共享的 GPU 资源。
   * 共享的 `this.geometry` 和 `materials.*` 条目不会被 dispose，其它全部回收，
   * 避免每次 regenerate 累计泄漏 CanvasTexture、独立的 BoxGeometry / PlaneGeometry
   * 和 switch 那两个临时 MeshStandardMaterial。
   */
  private disposeWorldResources(): void {
    const sharedMats = new Set<THREE.Material>(Object.values(materials) as THREE.Material[])

    this.worldGroup.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) { return }

      if (obj instanceof THREE.InstancedMesh) {
        obj.dispose()
      }

      if (obj.geometry !== this.geometry) {
        obj.geometry.dispose()
      }

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if (sharedMats.has(m)) { continue }
        const mapped = m as { map?: THREE.Texture | null }
        if (mapped.map) { mapped.map.dispose() }
        m.dispose()
      }
    })
  }

  hasFurnitureAt(wx: number, wz: number): boolean {
    const rx = Math.round(wx)
    const rz = Math.round(wz)
    return this.furnitureBlocks.has(`${rx},1,${rz}`) || this.furnitureBlocks.has(`${rx},2,${rz}`)
  }

  /**
   * 判断网格坐标 (gx, gz) 处是否有高家具（视线遮挡物）。
   * 供幽灵视线算法使用——走网格坐标避免在 Bresenham 循环里反复做世界坐标换算。
   */
  hasTallFurnitureAtGrid(gx: number, gz: number): boolean {
    const wx = Math.round(gx - this.MAP_WIDTH / 2)
    const wz = Math.round(gz - this.MAP_DEPTH / 2)
    return this.tallFurnitureBlocks.has(`${wx},1,${wz}`) || this.tallFurnitureBlocks.has(`${wx},2,${wz}`)
  }

  /**
   * 返回墙体静态位图缓存（尺寸 = MAP_WIDTH × MAP_DEPTH，每格一像素）。
   * 小地图每帧用 drawImage 缩放到目标尺寸即可，避免重复逐格填充 6400 次。
   */
  getWallMapCanvas(): HTMLCanvasElement {
    if (this.wallMapCanvas) { return this.wallMapCanvas }
    const c = document.createElement('canvas')
    c.width = this.MAP_WIDTH
    c.height = this.MAP_DEPTH
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#444'
    for (let x = 0; x < this.MAP_WIDTH; x++) {
      for (let z = 0; z < this.MAP_DEPTH; z++) {
        if (this.grid[x][z] === 1) { ctx.fillRect(x, z, 1, 1) }
      }
    }
    this.wallMapCanvas = c
    return c
  }

  /** Grid-based collision — no Box3 storage needed for walls/floor/ceiling */
  checkCollision(pos: THREE.Vector3, radius: number, playerHeight: number, stepHeight: number = 0): boolean {
    const minY = pos.y + stepHeight
    const maxY = pos.y + playerHeight - 0.1

    // Floor (block y=0, top face y=0.5)
    if (minY <= 0.5) { return true }

    // Ceiling (block y=WALL_HEIGHT+1, bottom face WALL_HEIGHT+0.5)
    if (maxY >= this.WALL_HEIGHT + 0.5) { return true }

    const offsetX = -this.MAP_WIDTH / 2
    const offsetZ = -this.MAP_DEPTH / 2

    // Walls via grid lookup
    const gxMin = Math.max(0, Math.floor(pos.x - radius - offsetX - 0.5))
    const gxMax = Math.min(this.MAP_WIDTH - 1, Math.ceil(pos.x + radius - offsetX + 0.5))
    const gzMin = Math.max(0, Math.floor(pos.z - radius - offsetZ - 0.5))
    const gzMax = Math.min(this.MAP_DEPTH - 1, Math.ceil(pos.z + radius - offsetZ + 0.5))

    for (let gx = gxMin; gx <= gxMax; gx++) {
      for (let gz = gzMin; gz <= gzMax; gz++) {
        if (this.grid[gx][gz] === 1) {
          const wx = gx + offsetX
          const wz = gz + offsetZ
          if (pos.x + radius >= wx - 0.5 && pos.x - radius <= wx + 0.5 &&
              maxY >= 0.5 && minY <= this.WALL_HEIGHT + 0.5 &&
              pos.z + radius >= wz - 0.5 && pos.z - radius <= wz + 0.5) {
            return true
          }
        }
      }
    }

    // Furniture (small set, O(n) is fine)
    for (const key of this.furnitureBlocks) {
      const parts = key.split(',')
      const bx = Number(parts[0])
      const by = Number(parts[1])
      const bz = Number(parts[2])
      if (pos.x + radius >= bx - 0.5 && pos.x - radius <= bx + 0.5 &&
          maxY >= by - 0.5 && minY <= by + 0.5 &&
          pos.z + radius >= bz - 0.5 && pos.z - radius <= bz + 0.5) {
        return true
      }
    }

    return false
  }
}
