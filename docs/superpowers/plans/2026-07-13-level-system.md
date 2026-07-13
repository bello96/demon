# 关卡系统实施计划（level 分支）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把硬编码地图改为云端可配置的关卡系统：关卡 Schema 与小程序对齐、选关菜单 + 顺序解锁、`public/level.html` 编辑器保存到 Cloudflare KV 后全网生效。

**Architecture:** 单仓库单 Pages 项目：游戏页 + 编辑器页（public/ 静态单文件）+ `functions/` API（GET 公开读 / PUT 口令写 KV）。游戏启动拉取 `/api/levels`，失败回退内置 6 关。规格见 `docs/superpowers/specs/2026-07-13-level-system-design.md`（一切以规格为准）。

**Tech Stack:** Three.js 0.168 / Vite 6 / TypeScript 5.7 strict / pnpm / vitest / wrangler（Cloudflare Pages Functions + KV）

## Global Constraints

- 只在 `level` 分支工作；**绝不修改** `D:/code/demo/my-game/nightmare-cube-mini-program` 下任何文件（从中 `cp` 复制出来是允许的）。
- 每个任务收尾必须 `pnpm typecheck` 全绿（Task 1 起含 `pnpm test` 全绿）再提交。
- 所有 `if` 必须带花括号；公开 API 必须有类型注解；新文件必须 `.ts`（public/level.html 内联 JS 除外，它沿用小程序编辑器形态）。
- 注释与 commit 描述用简体中文；commit 标题带 Conventional Commits 前缀；commit 末尾署名一行：`贡献者：Claude Opus 4.6`（不要 Co-Authored-By）。
- 提交用消息文件：把消息写入 `C:\Users\jbdeng4\AppData\Local\Temp\claude\D--code-demo-my-game-demon\c6dbcb44-17af-4a0d-8298-63d1ff4309e7\scratchpad\commit-msg.txt` 后 `git commit -F <该文件>`（本机 shell 对多行 `-m` 处理有问题；git 版本老，没有 `--show-current`）。
- 网格坐标恒为 100×100 绝对格坐标；关卡校验区间：`darkAmbient>0`、`darkFogFar≥5`、`0<ghostSpeed≤5.9`、矩形 `x,z,w,d≥1 且 x+w<100、z+d<100`。
- KV key 恒为 `levels`；环境变量名恒为 `LEVEL_ADMIN_TOKEN`；KV binding 名恒为 `LEVELS_KV`；编辑器域名恒为 `demon-level.dengjiabei.cn`。

---

### Task 1: 关卡 Schema 层（types 精简 + levels.ts + 内置数据 + vitest 基建）

**Files:**
- Modify: `src/types.ts`（RoomLayout 删 `features`，新增 `MansionOptions`）
- Modify: `src/game.ts:11-22`（硬编码 roomLayout 去掉 `features` 属性，保持编译绿）
- Create: `src/levels_data.json`（从小程序复制）
- Create: `src/levels.ts`
- Modify: `package.json`（devDep `vitest`，script `"test": "vitest run"`）
- Modify: `tsconfig.json`（include 加 `"tests/**/*.ts"`）
- Test: `tests/levels.test.ts`

**Interfaces:**
- Produces: `interface LevelConfig { rooms: RoomLayout[]; corridorRects?: RoomLayout[]; doorCount: number; darkAmbient: number; darkFogFar: number; ghostSpeed: number; lightsOn: boolean; ghostEnabled: boolean }`；`parseLevelsData(data: unknown): LevelConfig[] | null`；`BUILTIN_LEVELS: LevelConfig[]`；`getLevelConfig(levels: LevelConfig[], level: number): LevelConfig`；`interface MansionOptions { doorCount?: number; corridorRects?: RoomLayout[] }`
- Consumes: 无（首任务）

- [ ] **Step 1: 安装 vitest 并配置脚本**

```bash
cd /d/code/demo/my-game/demon && pnpm add -D vitest
```

`package.json` 的 scripts 加一行：`"test": "vitest run"`。
`tsconfig.json` 的 `"include": ["src/**/*.ts"]` 改为 `"include": ["src/**/*.ts", "tests/**/*.ts"]`。

- [ ] **Step 2: 复制内置关卡数据**

```bash
cp /d/code/demo/my-game/nightmare-cube-mini-program/src/levels_data.json /d/code/demo/my-game/demon/src/levels_data.json
```

- [ ] **Step 3: 写失败测试 `tests/levels.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { BUILTIN_LEVELS, getLevelConfig, parseLevelsData } from '../src/levels'

// 一个各字段全部合法的最小单关样例，逐用例在它基础上改坏一处
const validLevel = {
  rooms: [{ x: 10, z: 10, w: 30, d: 30 }],
  doorCount: 1,
  darkAmbient: 0.2,
  darkFogFar: 20,
  ghostSpeed: 2.6,
  lightsOn: false,
  ghostEnabled: true,
}

describe('parseLevelsData', () => {
  it('合法数据解析成功，字段原样保留', () => {
    const out = parseLevelsData({ levels: [validLevel] })
    expect(out).not.toBeNull()
    expect(out!).toHaveLength(1)
    expect(out![0].rooms).toEqual([{ x: 10, z: 10, w: 30, d: 30 }])
    expect(out![0].ghostSpeed).toBe(2.6)
  })

  it('doorCount 恒为 1（JSON 里写多少都忽略）', () => {
    const out = parseLevelsData({ levels: [{ ...validLevel, doorCount: 3 }] })
    expect(out![0].doorCount).toBe(1)
  })

  it('lightsOn 缺省 false、ghostEnabled 缺省 true', () => {
    const { lightsOn: _a, ghostEnabled: _b, ...rest } = validLevel
    const out = parseLevelsData({ levels: [rest] })
    expect(out![0].lightsOn).toBe(false)
    expect(out![0].ghostEnabled).toBe(true)
  })

  it('corridorRects 可选，给了就校验坐标', () => {
    const ok = parseLevelsData({
      levels: [{ ...validLevel, corridorRects: [{ x: 40, z: 23, w: 30, d: 1 }] }],
    })
    expect(ok![0].corridorRects).toEqual([{ x: 40, z: 23, w: 30, d: 1 }])
    const bad = parseLevelsData({
      levels: [{ ...validLevel, corridorRects: [{ x: 0, z: 23, w: 30, d: 1 }] }],
    })
    expect(bad).toBeNull()
  })

  it.each([
    ['rooms 为空', { ...validLevel, rooms: [] }],
    ['房间越界 x+w>=100', { ...validLevel, rooms: [{ x: 20, z: 10, w: 80, d: 30 }] }],
    ['darkAmbient<=0', { ...validLevel, darkAmbient: 0 }],
    ['darkFogFar<5', { ...validLevel, darkFogFar: 4 }],
    ['ghostSpeed>5.9', { ...validLevel, ghostSpeed: 6 }],
    ['ghostSpeed<=0', { ...validLevel, ghostSpeed: 0 }],
    ['lightsOn 非布尔', { ...validLevel, lightsOn: 1 }],
    ['ghostEnabled 非布尔', { ...validLevel, ghostEnabled: 'yes' }],
  ])('%s → 整包拒绝返回 null', (_name, lv) => {
    expect(parseLevelsData({ levels: [lv] })).toBeNull()
  })

  it('顶层结构非法 → null', () => {
    expect(parseLevelsData(null)).toBeNull()
    expect(parseLevelsData({})).toBeNull()
    expect(parseLevelsData({ levels: [] })).toBeNull()
  })
})

describe('BUILTIN_LEVELS / getLevelConfig', () => {
  it('内置 levels_data.json 是合法的 6 关', () => {
    expect(BUILTIN_LEVELS).toHaveLength(6)
  })

  it('getLevelConfig 越界钳制到 [1, N]', () => {
    expect(getLevelConfig(BUILTIN_LEVELS, 0)).toBe(BUILTIN_LEVELS[0])
    expect(getLevelConfig(BUILTIN_LEVELS, 999)).toBe(BUILTIN_LEVELS[5])
    expect(getLevelConfig(BUILTIN_LEVELS, 3)).toBe(BUILTIN_LEVELS[2])
  })
})
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL，报 `Cannot find module '../src/levels'`（或等价的模块不存在错误）

- [ ] **Step 5: 改 `src/types.ts`**

用下面内容整体替换 `src/types.ts`（删 `features` 死字段、`RoomLayout` 变纯矩形、新增 `MansionOptions`；`Room`/`LightSwitch`/`Interactable` 保持原样）：

```ts
import type * as THREE from 'three'

export interface RoomLayout {
  x: number
  z: number
  w: number
  d: number
}

export interface Room extends RoomLayout {
  id: number
}

/** 世界生成的关卡选项（关卡编辑器产物） */
export interface MansionOptions {
  /** 逃生门数量：当前产品恒为 1，保留扩展位 */
  doorCount?: number
  /**
   * 手画走廊矩形：按矩形原样挖空，宽度任意；与房间/彼此重叠或贴边即打通。
   * 房间贴边/重叠本身就算连通，绝不自动生成走廊；唯一例外是防死局兜底——
   * 与 1 号房不连通的房间补一条 L 形直廊。
   */
  corridorRects?: RoomLayout[]
}

export interface LightSwitch {
  pos: THREE.Vector3
  box: THREE.Box3
  handle: THREE.Mesh
  isOn: boolean
}

export interface Interactable {
  type: 'cabinet' | 'switch' | 'key' | 'radar' | 'door'
  pos: THREE.Vector3
  // box 仅 switch 会用到精确 AABB 判定（目前也只是预留，未被读取），其它交互物靠 pos 距离即可
  box?: THREE.Box3
  obj?: LightSwitch
  mesh?: THREE.Mesh
  collected?: boolean
}
```

同时把 `src/game.ts:11-22` 的硬编码数组里每个对象的 `, features: [...]` 删掉（共 10 处），例如第一行变成 `{ x: 5, z: 5, w: 15, d: 15 },`。

- [ ] **Step 6: 新建 `src/levels.ts`**

```ts
import type { RoomLayout } from './types'
import rawLevelsData from './levels_data.json'

/** 单个关卡的完整难度配置：地图布局 + 环境氛围 + 幽灵参数（与小程序版格式一致） */
export interface LevelConfig {
  /** 房间布局（100×100 网格内；重叠/贴边 = 拼接成不规则大房间） */
  rooms: RoomLayout[]
  /** 手画走廊矩形（关卡编辑器产物）：原样挖空、宽度任意；房间贴边/重叠即连通，无需走廊 */
  corridorRects?: RoomLayout[]
  /** 逃生门数量：当前产品设计恒为 1——唯一的门，每局随机分到某个房间的随机墙面 */
  doorCount: number
  /** 关灯时环境光强度：可逐关变暗（开灯后各关一样亮） */
  darkAmbient: number
  /** 关灯时可视距离（米）：雾可逐关变浓 */
  darkFogFar: number
  /** 幽灵巡逻速度：追击时 ×1.5；玩家步行 6 / 疾跑 9，上限须留出逃生余地 */
  ghostSpeed: number
  /** 开局房间灯是否已打开（默认 false=摸黑找开关；开着时玩家仍可去把它关掉） */
  lightsOn: boolean
  /** 本关是否出现幽灵（默认 true；false=无追逐的纯逃脱关） */
  ghostEnabled: boolean
}

// 内置 JSON 被改坏（数值非法）时的应急单关：保证游戏能开、不黑屏，控制台有报错提示
const FALLBACK_LEVELS: LevelConfig[] = [
  {
    rooms: [{ x: 30, z: 30, w: 20, d: 20 }],
    doorCount: 1,
    darkAmbient: 0.2,
    darkFogFar: 20,
    ghostSpeed: 2.6,
    lightsOn: false,
    ghostEnabled: true,
  },
]

/**
 * 解析并校验关卡 JSON（关卡编辑器导出的格式，顶层 { levels: [...] }）；
 * 任何一处非法都整体拒绝返回 null——宁可回退，也不能拿半坏的数据生成世界。
 * 游戏端与 Cloudflare Functions 端共用本函数，保持校验单一来源。
 */
export function parseLevelsData(data: unknown): LevelConfig[] | null {
  const arr = (data as { levels?: unknown })?.levels
  if (!Array.isArray(arr) || arr.length === 0) {
    return null
  }
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const rectOk = (r: unknown): boolean => {
    const q = r as { x?: unknown; z?: unknown; w?: unknown; d?: unknown }
    return (
      num(q.x) &&
      num(q.z) &&
      num(q.w) &&
      num(q.d) &&
      q.x >= 1 &&
      q.z >= 1 &&
      q.w >= 1 &&
      q.d >= 1 &&
      q.x + q.w < 100 &&
      q.z + q.d < 100
    )
  }
  const out: LevelConfig[] = []
  for (const lv of arr) {
    const l = lv as {
      rooms?: unknown[]
      corridorRects?: unknown[]
      darkAmbient?: unknown
      darkFogFar?: unknown
      ghostSpeed?: unknown
      lightsOn?: unknown
      ghostEnabled?: unknown
    }
    if (!Array.isArray(l.rooms) || l.rooms.length === 0 || !l.rooms.every(rectOk)) {
      return null
    }
    if (
      l.corridorRects !== undefined &&
      (!Array.isArray(l.corridorRects) || !l.corridorRects.every(rectOk))
    ) {
      return null
    }
    if (!num(l.darkAmbient) || !num(l.darkFogFar) || !num(l.ghostSpeed)) {
      return null
    }
    if (l.darkAmbient <= 0 || l.darkFogFar < 5 || l.ghostSpeed <= 0 || l.ghostSpeed > 5.9) {
      return null
    }
    // 两个开关都是可选布尔：缺省用默认值，写了就必须是 true/false
    if (l.lightsOn !== undefined && typeof l.lightsOn !== 'boolean') {
      return null
    }
    if (l.ghostEnabled !== undefined && typeof l.ghostEnabled !== 'boolean') {
      return null
    }
    out.push({
      rooms: (l.rooms as RoomLayout[]).map((r) => ({ x: r.x, z: r.z, w: r.w, d: r.d })),
      corridorRects: l.corridorRects
        ? (l.corridorRects as RoomLayout[]).map((r) => ({ x: r.x, z: r.z, w: r.w, d: r.d }))
        : undefined,
      doorCount: 1,
      darkAmbient: l.darkAmbient,
      darkFogFar: l.darkFogFar,
      ghostSpeed: l.ghostSpeed,
      lightsOn: l.lightsOn === true,
      ghostEnabled: l.ghostEnabled !== false,
    })
  }
  return out
}

/** 内置兜底关卡（src/levels_data.json）；构建期数据非法时回退应急单关 */
export const BUILTIN_LEVELS: LevelConfig[] = (() => {
  const parsed = parseLevelsData(rawLevelsData)
  if (!parsed) {
    console.error('[levels] src/levels_data.json 数据非法，已启用应急关卡（请检查 JSON）')
    return FALLBACK_LEVELS
  }
  return parsed
})()

/** 从给定关卡数组取第 level 关；越界钳制到 [1, levels.length]（存档损坏兜底） */
export function getLevelConfig(levels: LevelConfig[], level: number): LevelConfig {
  const idx = Math.min(Math.max(Math.round(level), 1), levels.length) - 1
  return levels[idx]
}
```

- [ ] **Step 7: 跑测试与类型检查确认通过**

Run: `pnpm test`
Expected: PASS（levels.test.ts 全绿）
Run: `pnpm typecheck`
Expected: 无错误（game.ts 删 features 后应绿；若报 world.ts 引用 features 之类错误说明漏改）

- [ ] **Step 8: 提交**

```bash
git add src/types.ts src/game.ts src/levels.ts src/levels_data.json tests/levels.test.ts package.json tsconfig.json pnpm-lock.yaml
git commit -F <消息文件>
```

消息：

```
feat: 移植关卡 Schema 层（LevelConfig + 校验 + 内置 6 关）

自小程序版移植 levels.ts 与 levels_data.json；getLevelConfig 改为
双参（关卡数组由调用方注入，为云端加载做准备）；RoomLayout 删除
死字段 features，新增 MansionOptions；引入 vitest 基建与首批单测。

贡献者：Claude Opus 4.6
```

---

### Task 2: 进度纯函数移植（progress.ts）

**Files:**
- Create: `src/progress.ts`
- Test: `tests/progress.test.ts`

**Interfaces:**
- Produces: `migrateProgress(reachedRaw: number, clearedRaw: number, levelCount: number): { level: number; cleared: number }`；`isLevelUnlocked(n: number, cleared: number): boolean`
- Consumes: 无

- [ ] **Step 1: 写失败测试 `tests/progress.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { isLevelUnlocked, migrateProgress } from '../src/progress'

describe('migrateProgress', () => {
  it('新玩家（两键都是 NaN）→ 第 1 关、已通 0 关', () => {
    expect(migrateProgress(NaN, NaN, 6)).toEqual({ level: 1, cleared: 0 })
  })

  it('正常档：reached=3 cleared=2 → 原样', () => {
    expect(migrateProgress(3, 2, 6)).toEqual({ level: 3, cleared: 2 })
  })

  it('旧档只有 reached：按已通 reached-1 关推导', () => {
    expect(migrateProgress(4, NaN, 6)).toEqual({ level: 4, cleared: 3 })
  })

  it('矛盾档以 cleared 为准：reached=5 cleared=1 → level 钳到 2', () => {
    expect(migrateProgress(5, 1, 6)).toEqual({ level: 2, cleared: 1 })
  })

  it('关卡数变少：reached=9 cleared=9 levelCount=6 → 全部钳到 6', () => {
    expect(migrateProgress(9, 9, 6)).toEqual({ level: 6, cleared: 6 })
  })

  it('脏值（负数/小数）钳制', () => {
    expect(migrateProgress(-3, -1, 6)).toEqual({ level: 1, cleared: 0 })
    expect(migrateProgress(2.9, 1.9, 6)).toEqual({ level: 2, cleared: 1 })
  })
})

describe('isLevelUnlocked', () => {
  it('已通 2 关：1/2/3 可进，4 不可进，0 不可进', () => {
    expect(isLevelUnlocked(1, 2)).toBe(true)
    expect(isLevelUnlocked(2, 2)).toBe(true)
    expect(isLevelUnlocked(3, 2)).toBe(true)
    expect(isLevelUnlocked(4, 2)).toBe(false)
    expect(isLevelUnlocked(0, 2)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL，`Cannot find module '../src/progress'`

- [ ] **Step 3: 新建 `src/progress.ts`**（自小程序原样移植）

```ts
/**
 * 关卡进度的存档语义（两个 localStorage 键，纯函数便于单测）：
 *  - levelReached：下次进入的默认关（全通关后回 1 开新轮）
 *  - levelCleared：历史已通过的最高关数，只增不减——全通关也不清零，
 *    专用于关卡选择界面的解锁判定
 */

/** 读档并迁移：旧档只有 levelReached 时按"已通 reached-1 关"推导；一切脏值钳回合法区间 */
export function migrateProgress(
  reachedRaw: number,
  clearedRaw: number,
  levelCount: number,
): { level: number; cleared: number } {
  const reached = Number.isFinite(reachedRaw) ? Math.floor(reachedRaw) : 1
  const clearedBase = Number.isFinite(clearedRaw) ? Math.floor(clearedRaw) : reached - 1
  const cleared = Math.min(Math.max(clearedBase, 0), levelCount)
  // level 除了落在 [1, levelCount]，还不得越过解锁边界（矛盾档以 cleared 为准）
  const level = Math.min(Math.max(reached, 1), levelCount, cleared + 1)
  return { level, cleared }
}

/** 关卡 n 是否可进：已通关的关可重玩，最多只放行到"已通最高关的下一关" */
export function isLevelUnlocked(n: number, cleared: number): boolean {
  return n >= 1 && n <= cleared + 1
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```
feat: 移植关卡进度纯函数（迁移钳制 + 解锁判定）

贡献者：Claude Opus 4.6
```

---

### Task 3: world.ts 改造（100×100 + 手画走廊 + 防死局兜底）

**Files:**
- Modify: `src/world.ts`

**Interfaces:**
- Consumes: `MansionOptions`（Task 1）
- Produces: `World.generateMansion(roomLayout: RoomLayout[], opts?: MansionOptions): void`；`World.regenerate(roomLayout: RoomLayout[], opts?: MansionOptions): void`（opts 可选，现有调用点 `game.ts` 不改也能编译）

- [ ] **Step 1: 改网格常量**（`src/world.ts:8-9`）

```ts
  readonly MAP_WIDTH = 100
  readonly MAP_DEPTH = 100
```

- [ ] **Step 2: 新增三个私有辅助方法**（放在 `createRoomNumber` 方法之后、`generateMansion` 之前；自小程序原样移植）

```ts
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
```

- [ ] **Step 3: 改 `generateMansion` 签名与走廊逻辑**

签名（`src/world.ts:69`）改为：

```ts
  generateMansion(roomLayout: RoomLayout[], opts: MansionOptions = {}): void {
```

并在文件头 import 补上 `MansionOptions`：`import type { Room, RoomLayout, Interactable, LightSwitch, MansionOptions } from './types'`。

**整段删除**现有步骤 3（`// 3. Connect rooms via corridors` 注释起，到收集 walkable 节点前的 `for` 循环整块，即原 `world.ts:90-105` 的相邻房间连接逻辑），替换为：

```ts
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
```

- [ ] **Step 4: walkable 节点只收主连通区域**

把现有步骤 4（`// 4. Collect walkable nodes` 的双层 for）替换为：

```ts
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
```

（注意：原步骤 4 里也声明了 `offsetX/offsetZ/totalCells`，替换后保持只声明一次。）

- [ ] **Step 5: `regenerate` 透传 opts**（`src/world.ts:479`）

```ts
  regenerate(roomLayout: RoomLayout[], opts: MansionOptions = {}): void {
```

方法体最后一行改为 `this.generateMansion(roomLayout, opts)`。

- [ ] **Step 6: 类型检查 + 手动烟测**

Run: `pnpm typecheck`
Expected: 无错误（game.ts 现有 `generateMansion(roomLayout)` 单参调用因 opts 可选依旧合法）

Run: `pnpm dev`，浏览器打开 http://localhost:5173/
Expected: 点「开始游戏」能进入游戏；旧硬编码 10 房地图在 100×100 网格下仍可走通（房间彼此分离时由防死局兜底自动补 L 廊）；小地图正常；幽灵会动。

- [ ] **Step 7: 提交**

```
feat: 世界生成支持关卡选项（100x100 网格 + 手画走廊 + 防死局兜底）

网格扩至 100x100 与小程序对齐；generateMansion/regenerate 增加
MansionOptions 二参；相邻房间自动连廊改为编辑器 corridorRects 挖空
+ 孤岛房间 L 形兜底；walkableNodes 只收 1 号房主连通区域。

贡献者：Claude Opus 4.6
```

---

### Task 4: 幽灵/玩家参数化（setSpeed / setEnabled / setEnvDark + 常量）

**Files:**
- Create: `src/constants.ts`
- Modify: `src/ghost.ts`
- Modify: `src/player.ts`

**Interfaces:**
- Produces: `LIT_AMBIENT = 0.8`、`LIT_FOG_FAR = 100`（constants.ts）；`Ghost.setSpeed(speed: number): void`、`Ghost.setEnabled(enabled: boolean): void`、`Ghost.isEnabled: boolean`（getter）；`Player.setEnvDark(ambient: number, fogFar: number): void`
- Consumes: 无（game.ts 在 Task 6 才接线；本任务保持默认行为不变：ghost 速度 2.8、暗态 0.05/12）

- [ ] **Step 1: 新建 `src/constants.ts`**

```ts
/** 开灯后的环境光强度（各关一致；关灯值由关卡配置 darkAmbient 决定） */
export const LIT_AMBIENT = 0.8
/** 开灯后的可视距离（雾远平面；关灯值由关卡配置 darkFogFar 决定） */
export const LIT_FOG_FAR = 100
```

- [ ] **Step 2: 改 `src/ghost.ts`**

字段区（`private speed = 2.8` 附近）改为：

```ts
  private speed = 2.8
  private enabled = true
  private posSound: THREE.PositionalAudio | null = null
```

`createMesh()` 里创建 PositionalAudio 的块，把局部 `const sound` 存到字段：`sound.play()` 之后加 `this.posSound = sound`（其余不动）。

类中新增三个成员（放 `reset()` 之后）：

```ts
  /** 幽灵巡逻速度（追击自动 ×1.5），由关卡配置注入 */
  setSpeed(speed: number): void {
    this.speed = speed
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** 无幽灵关：隐藏本体、停位置音效、update 短路（不追不杀） */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.mesh.visible = enabled
    if (this.posSound) {
      if (enabled && !this.posSound.isPlaying) {
        this.posSound.play()
      }
      if (!enabled && this.posSound.isPlaying) {
        this.posSound.stop()
      }
    }
  }
```

`update(dt)` 方法体第一行加：

```ts
    if (!this.enabled) {
      return false
    }
```

- [ ] **Step 3: 改 `src/player.ts`**

头部 import 加：`import { LIT_AMBIENT, LIT_FOG_FAR } from './constants'`。

字段区加（`flashlightIntensity` 附近）：

```ts
  // 关灯态的环境值，由关卡配置注入（默认沿用原硬编码值）
  private darkAmbient = 0.05
  private darkFogFar = 12
```

新增方法（放 `setMouseSensitivity` 之后）：

```ts
  /** 注入本关关灯态的环境光/雾距（进关时由 Game 调用） */
  setEnvDark(ambient: number, fogFar: number): void {
    this.darkAmbient = ambient
    this.darkFogFar = fogFar
  }
```

`interact()` 的 switch 分支里，四个硬编码值替换：`0.8`→`LIT_AMBIENT`、`100`→`LIT_FOG_FAR`、`0.05`→`this.darkAmbient`、`12`→`this.darkFogFar`。

- [ ] **Step 4: 验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿
Run: `pnpm dev` 烟测：游戏可玩，找到开关按 E 开/关灯行为与之前一致。

- [ ] **Step 5: 提交**

```
feat: 幽灵与灯光参数化（setSpeed/setEnabled/setEnvDark）

为关卡配置注入做准备：幽灵速度与是否出场可设，玩家灯开关的
明暗值改用注入值 + LIT 常量，默认行为与原版一致。

贡献者：Claude Opus 4.6
```

---

### Task 5: 云端关卡加载服务（level_service.ts）

**Files:**
- Create: `src/level_service.ts`
- Test: `tests/level_service.test.ts`

**Interfaces:**
- Consumes: `BUILTIN_LEVELS`、`parseLevelsData`、`LevelConfig`（Task 1）
- Produces: `interface LoadedLevels { levels: LevelConfig[]; source: 'remote' | 'builtin' }`；`loadLevels(timeoutMs?: number): Promise<LoadedLevels>`（默认超时 3000ms，永不 reject）

- [ ] **Step 1: 写失败测试 `tests/level_service.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_LEVELS } from '../src/levels'
import { loadLevels } from '../src/level_service'

const remoteData = {
  levels: [
    {
      rooms: [{ x: 20, z: 20, w: 40, d: 40 }],
      doorCount: 1,
      darkAmbient: 0.15,
      darkFogFar: 18,
      ghostSpeed: 3,
      lightsOn: true,
      ghostEnabled: false,
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadLevels', () => {
  it('云端 200 且数据合法 → source=remote', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(remoteData))))
    const out = await loadLevels()
    expect(out.source).toBe('remote')
    expect(out.levels).toHaveLength(1)
    expect(out.levels[0].lightsOn).toBe(true)
    expect(out.levels[0].ghostEnabled).toBe(false)
  })

  it('云端 404 → 回退内置', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })))
    const out = await loadLevels()
    expect(out.source).toBe('builtin')
    expect(out.levels).toBe(BUILTIN_LEVELS)
  })

  it('云端 200 但数据非法 → 回退内置', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"levels":[{"rooms":[]}]}')))
    const out = await loadLevels()
    expect(out.source).toBe('builtin')
  })

  it('网络异常 → 回退内置且不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down')
    }))
    const out = await loadLevels()
    expect(out.source).toBe('builtin')
  })

  it('超时 → 回退内置', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
    ))
    const out = await loadLevels(50)
    expect(out.source).toBe('builtin')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL，`Cannot find module '../src/level_service'`

- [ ] **Step 3: 新建 `src/level_service.ts`**

```ts
import { BUILTIN_LEVELS, parseLevelsData, type LevelConfig } from './levels'

export interface LoadedLevels {
  levels: LevelConfig[]
  source: 'remote' | 'builtin'
}

/**
 * 拉取云端关卡（/api/levels）：超时/失败/校验不过一律回退内置关卡，
 * 只 console.warn 不抛错——关卡加载失败绝不能阻塞游戏启动。
 */
export async function loadLevels(timeoutMs: number = 3000): Promise<LoadedLevels> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch('/api/levels', { cache: 'no-store', signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (res.ok) {
      const parsed = parseLevelsData(await res.json())
      if (parsed) {
        return { levels: parsed, source: 'remote' }
      }
      console.warn('[levels] 云端数据校验失败，使用内置关卡')
    } else {
      console.warn(`[levels] 云端无关卡数据（HTTP ${res.status}），使用内置关卡`)
    }
  } catch (e) {
    console.warn('[levels] 拉取云端关卡失败，使用内置关卡：', e)
  }
  return { levels: BUILTIN_LEVELS, source: 'builtin' }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test && pnpm typecheck`
Expected: 全 PASS

- [ ] **Step 5: 提交**

```
feat: 云端关卡加载服务（3 秒超时 + 内置回退）

贡献者：Claude Opus 4.6
```

---

### Task 6: 游戏关卡生命周期 + 选关 UI + 文案

**Files:**
- Modify: `src/game.ts`（最大改动）
- Modify: `index.html`（选关面板、胜利/死亡/暂停按钮、CSS）
- Modify: `src/localization.ts`（新增文案 + DOM 映射）

**Interfaces:**
- Consumes: `loadLevels`（Task 5）、`getLevelConfig`/`LevelConfig`（Task 1）、`migrateProgress`/`isLevelUnlocked`（Task 2）、`World.regenerate(rooms, opts)`（Task 3）、`Ghost.setSpeed/setEnabled/isEnabled`、`Player.setEnvDark`、`LIT_AMBIENT/LIT_FOG_FAR`（Task 4）
- Produces: 完整可玩的关卡流（供 Task 9 验收）；localStorage 键 `levelReached`/`levelCleared`

- [ ] **Step 1: `index.html` 增加 UI**

菜单：`#instructions-text` 那个 `<p>` 之后、`#hint-text` 之前插入：

```html
          <div id="level-select">
            <div id="level-select-title">选择关卡</div>
            <div id="level-grid"></div>
          </div>
```

胜利界面：`#game-win` 内的 `<button id="play-again-btn">再玩一次</button>` 替换为：

```html
        <button id="next-level-btn">进入下一关</button>
        <button id="win-menu-btn">返回选关</button>
```

死亡界面：`#respawn-btn` 按钮后面加 `<button id="dead-menu-btn">返回选关</button>`。

暂停菜单：`.pause-button-group` 里 `#btn-restart` 后面加 `<button id="btn-menu">返回选关</button>`。

游戏内信息：`#game-info` 里 `#info-switch` 之前加 `<div id="info-level"></div>`。

`<style>` 里（`#loader-area` 规则前）加：

```css
      #level-select {
        margin: 20px 0;
        text-align: left;
      }
      #level-select-title {
        color: #ccc;
        font-size: 22px;
        margin-bottom: 10px;
      }
      #level-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 10px;
      }
      .level-tile {
        padding: 10px 0;
        font-size: 26px;
        min-width: 0;
      }
      .level-tile.locked {
        opacity: 0.35;
        cursor: not-allowed;
      }
      .level-tile.locked:hover {
        background: #444;
        transform: none;
      }
      .level-tile.current {
        border-color: #ffaa00;
        color: #ffaa00;
      }
```

- [ ] **Step 2: `src/localization.ts` 增补文案**

`TranslationStrings` 接口加字段：`selectLevel: string`、`levelLabel: string`、`lockedTip: string`、`nextLevel: string`、`backToSelect: string`、`allCleared: string`。

zh 增加：

```ts
    selectLevel: '选择关卡',
    levelLabel: '第 {n} 关',
    lockedTip: '未解锁',
    nextLevel: '进入下一关',
    backToSelect: '返回选关',
    allCleared: '全部通关！'
```

en 增加：

```ts
    selectLevel: 'Select Level',
    levelLabel: 'Level {n}',
    lockedTip: 'Locked',
    nextLevel: 'Next Level',
    backToSelect: 'Back to Levels',
    allCleared: 'All Levels Cleared!'
```

`updateDOM()` 的 map 中删掉 `'play-again-btn': 'playAgain'`，加：

```ts
    'level-select-title': 'selectLevel',
    'next-level-btn': 'nextLevel',
    'win-menu-btn': 'backToSelect',
    'dead-menu-btn': 'backToSelect',
    'btn-menu': 'backToSelect'
```

（接口里 `playAgain` 键保留不删，避免无谓 churn。）

- [ ] **Step 3: 改造 `src/game.ts`**

**imports** 区新增/调整：

```ts
import { BUILTIN_LEVELS, getLevelConfig, type LevelConfig } from './levels'
import { loadLevels } from './level_service'
import { isLevelUnlocked, migrateProgress } from './progress'
import { LIT_AMBIENT, LIT_FOG_FAR } from './constants'
```

**删除** `game.ts:11-22` 的硬编码 `roomLayout` 常量（连同它上面的 `import type { RoomLayout } from './types'` 若不再被用到一并清掉）。

**Game 类新增字段**：

```ts
  private levels: LevelConfig[] = BUILTIN_LEVELS
  private level = 1
  private levelCleared = 0
```

**构造函数**：删掉 `this.world.generateMansion(roomLayout)`、`this.player.spawn()`、`this.ghost.spawn()` 三行（World/Player/Ghost 的 new 保留原顺序），在 `this.setupInput()` 之后加 `void this.bootstrap()`。

**`setupLoader()`**：把 `texturesLoaded.then(...)` 回调里的 `if (startBtn) { startBtn.disabled = false }` 一行删掉（按钮启用改由 bootstrap 统一负责，避免关卡未就绪就能点开始）。

**新增方法**（放构造函数之后）：

```ts
  /** 启动引导：纹理与云端关卡都就绪后才建世界、开放开始按钮 */
  private async bootstrap(): Promise<void> {
    const [, loaded] = await Promise.all([texturesLoaded, loadLevels()])
    this.levels = loaded.levels
    if (loaded.source === 'builtin') {
      console.warn('[game] 使用内置关卡（云端不可用或暂无数据）')
    }

    const reachedRaw = Number(localStorage.getItem('levelReached') ?? NaN)
    const clearedRaw = Number(localStorage.getItem('levelCleared') ?? NaN)
    const p = migrateProgress(reachedRaw, clearedRaw, this.levels.length)
    this.level = p.level
    this.levelCleared = p.cleared

    this.buildLevel(this.level)
    this.renderLevelGrid()

    const startBtn = document.getElementById('btn-start') as HTMLButtonElement | null
    if (startBtn) {
      startBtn.disabled = false
    }
  }

  /** 按关卡配置重建世界并应用环境/幽灵参数（进关、重玩、切关共用） */
  private buildLevel(n: number): void {
    const cfg = getLevelConfig(this.levels, n)
    this.world.regenerate(cfg.rooms, { doorCount: cfg.doorCount, corridorRects: cfg.corridorRects })
    this.updateSwitchInfo()
    this.player.reset()
    this.ghost.reset()
    this.player.spawn()
    this.ghost.spawn()
    this.applyLevelConfig(cfg)
  }

  private applyLevelConfig(cfg: LevelConfig): void {
    this.ghost.setSpeed(cfg.ghostSpeed)
    this.ghost.setEnabled(cfg.ghostEnabled)
    this.player.setEnvDark(cfg.darkAmbient, cfg.darkFogFar)

    const fog = this.scene.fog as THREE.Fog
    if (cfg.lightsOn && this.world.lightSwitch) {
      // 开局灯已亮：开关拨到 ON，环境用统一亮值
      this.world.lightSwitch.isOn = true
      this.world.lightSwitch.handle.rotation.x = Math.PI / 4
      this.ambientLight.intensity = LIT_AMBIENT
      fog.far = LIT_FOG_FAR
    } else {
      this.ambientLight.intensity = cfg.darkAmbient
      fog.far = cfg.darkFogFar
    }

    const infoLevel = document.getElementById('info-level')
    if (infoLevel) {
      infoLevel.innerText = t('levelLabel', { n: this.level })
    }
  }

  /** 渲染选关网格：已解锁可点、未解锁灰显、当前关高亮 */
  private renderLevelGrid(): void {
    const grid = document.getElementById('level-grid')
    if (!grid) {
      return
    }
    grid.innerHTML = ''
    for (let n = 1; n <= this.levels.length; n++) {
      const btn = document.createElement('button')
      btn.className = 'level-tile'
      btn.textContent = String(n)
      const unlocked = isLevelUnlocked(n, this.levelCleared)
      if (!unlocked) {
        btn.classList.add('locked')
        btn.disabled = true
        btn.title = t('lockedTip')
      }
      if (n === this.level) {
        btn.classList.add('current')
      }
      btn.addEventListener('click', () => this.startGame(n))
      grid.appendChild(btn)
    }
  }

  /** 从菜单进入第 n 关（点关卡格子或「开始游戏」按钮） */
  private startGame(n: number): void {
    if (!isLevelUnlocked(n, this.levelCleared)) {
      return
    }
    if (this.listener.context.state === 'suspended') {
      void this.listener.context.resume()
    }
    this.level = n
    localStorage.setItem('levelReached', String(n))
    this.buildLevel(n)
    document.getElementById('menu')!.classList.add('hidden')
    this.enterPlay()
  }

  /** 通用"进入游玩态"：隐藏结算层、锁指针、复位时钟 */
  private enterPlay(): void {
    document.getElementById('game-over')!.classList.add('hidden')
    document.getElementById('game-win')!.classList.add('hidden')
    document.getElementById('pause-menu')!.classList.add('hidden')
    document.getElementById('game-info')!.style.display = 'block'

    const cabinetOverlay = document.getElementById('cabinet-overlay')
    if (cabinetOverlay) {
      cabinetOverlay.style.display = 'none'
    }
    const interactionMsg = document.getElementById('interaction-msg')
    if (interactionMsg) {
      interactionMsg.style.display = 'none'
    }
    this.stopHeartbeatUI()

    this.isGameOver = false
    this.isPaused = false
    this.isPlaying = true
    this.shouldLockPointer = true
    this.clock.getDelta()
    document.body.requestPointerLock()
    this.syncMouseSensitivityToSliders()
  }

  /** 回主菜单（选关）：胜利/死亡/暂停三处「返回选关」共用 */
  private showMenu(): void {
    this.isPlaying = false
    this.isPaused = false
    this.isGameOver = false
    this.shouldLockPointer = false
    document.exitPointerLock()
    this.stopHeartbeatUI()
    document.getElementById('game-over')!.classList.add('hidden')
    document.getElementById('game-win')!.classList.add('hidden')
    document.getElementById('pause-menu')!.classList.add('hidden')
    document.getElementById('game-info')!.style.display = 'none'
    this.renderLevelGrid()
    document.getElementById('menu')!.classList.remove('hidden')
  }

  /** 停心跳音效与 UI（多处复用） */
  private stopHeartbeatUI(): void {
    if (this.heartbeat.isPlaying) {
      this.heartbeat.stop()
    }
    const heartbeatUi = document.getElementById('heartbeat-ui')
    if (heartbeatUi) {
      heartbeatUi.style.opacity = '0'
      heartbeatUi.style.animation = 'none'
    }
  }
```

**`setupInput()` 改动**：

- `btn-start` 的 click 回调整体替换为 `() => this.startGame(this.level)`。
- `respawn-btn` / `btn-restart` 保持调 `this.restart()`。
- 删掉 `play-again-btn` 那行绑定，新增：

```ts
    document.getElementById('next-level-btn')?.addEventListener('click', () => {
      this.level = Math.min(this.level + 1, this.levels.length)
      localStorage.setItem('levelReached', String(this.level))
      this.buildLevel(this.level)
      this.enterPlay()
    })
    document.getElementById('win-menu-btn')?.addEventListener('click', () => this.showMenu())
    document.getElementById('dead-menu-btn')?.addEventListener('click', () => this.showMenu())
    document.getElementById('btn-menu')?.addEventListener('click', () => this.showMenu())
```

**`restart()`（重玩当前关）** 整体替换为：

```ts
  private restart(): void {
    this.buildLevel(this.level)
    this.enterPlay()
  }
```

（原方法里的 UI 清理已并入 `enterPlay`/`stopHeartbeatUI`；原来写死的 `ambientLight.intensity = 0.05`、`fog.far = 12` 由 `applyLevelConfig` 取代。）

**`animate()` 胜利分支** 替换为：

```ts
    if (this.player.hasWon) {
      this.isPlaying = false
      this.shouldLockPointer = false
      document.exitPointerLock()

      this.levelCleared = Math.max(this.levelCleared, this.level)
      localStorage.setItem('levelCleared', String(this.levelCleared))
      const wonAll = this.level >= this.levels.length
      localStorage.setItem('levelReached', String(wonAll ? 1 : this.level + 1))

      const escapedText = document.getElementById('escaped-text')
      if (escapedText) {
        escapedText.innerText = wonAll ? t('allCleared') : t('escaped')
      }
      const nextBtn = document.getElementById('next-level-btn') as HTMLButtonElement | null
      if (nextBtn) {
        nextBtn.style.display = wonAll ? 'none' : 'inline-block'
      }
      document.getElementById('game-win')!.classList.remove('hidden')
    }
```

**`animate()` 心跳块**：`if (dist < threshold && ...)` 的条件前面加 `this.ghost.isEnabled && `。

- [ ] **Step 4: 验证**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿

Run: `pnpm dev` 手动验收（无 wrangler 时控制台应出现"使用内置关卡"警告）：
1. 菜单出现 6 格选关，只有第 1 关可点、其余灰显加锁。
2. 点第 1 关格子（或「开始游戏」）进入 100×100 单大房间关。
3. 通关第 1 关（找钥匙→开门）→ 显示「逃脱成功」+「进入下一关/返回选关」；点下一关直接进第 2 关。
4. 刷新页面：第 2 关已解锁且为默认关（进度持久化生效）。
5. 死亡 → 「重生」重玩本关；「返回选关」回菜单。
6. Esc 暂停 → 「返回选关」可回菜单。

- [ ] **Step 5: 提交**

```
feat: 游戏接入关卡系统（选关菜单 + 顺序解锁 + 通关推进）

启动并行等待纹理与云端关卡；选关网格 UI（未解锁灰显）；进关应用
darkAmbient/darkFogFar/lightsOn/ghostSpeed/ghostEnabled；胜利存档
levelCleared 并可进入下一关，末关显示全部通关；死亡重玩本关；
胜利/死亡/暂停均可返回选关。

贡献者：Claude Opus 4.6
```

---

### Task 7: Cloudflare Functions + wrangler 配置

**Files:**
- Create: `functions/api/levels.ts`
- Create: `functions/_middleware.ts`
- Create: `functions/tsconfig.json`
- Create: `wrangler.toml`
- Create: `.dev.vars.example`
- Modify: `.gitignore`（追加 `.dev.vars`）
- Modify: `package.json`（devDeps `wrangler`、`@cloudflare/workers-types`；typecheck 脚本扩展）

**Interfaces:**
- Consumes: `parseLevelsData`（Task 1，functions 直接 import `../../src/levels`）
- Produces: HTTP 契约 `GET /api/levels`（200 `{levels:[...]}` / 404 `{"error":"not_found"}`）、`PUT /api/levels`（200 `{"ok":true,"count":N}` / 401 `{"error":"unauthorized"}` / 400 `{"error":"invalid","detail":"..."}`）、其它方法 405 `{"error":"method_not_allowed"}`；KV binding `LEVELS_KV`（key `levels`）；env `LEVEL_ADMIN_TOKEN`

- [ ] **Step 1: 装依赖**

```bash
pnpm add -D wrangler @cloudflare/workers-types
```

- [ ] **Step 2: 新建 `functions/api/levels.ts`**

```ts
import { parseLevelsData } from '../../src/levels'

interface Env {
  LEVELS_KV: KVNamespace
  LEVEL_ADMIN_TOKEN?: string
}

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  // 保存后刷新即生效：禁止任何中间缓存
  'Cache-Control': 'no-store',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

async function handleGet(ctx: EventContext<Env, string, unknown>): Promise<Response> {
  const raw = await ctx.env.LEVELS_KV.get('levels')
  if (!raw) {
    return json({ error: 'not_found' }, 404)
  }
  return new Response(raw, { status: 200, headers: JSON_HEADERS })
}

async function handlePut(ctx: EventContext<Env, string, unknown>): Promise<Response> {
  const token = ctx.env.LEVEL_ADMIN_TOKEN
  const auth = ctx.request.headers.get('Authorization') ?? ''
  // 未配置口令时拒绝一切写入，避免"忘配环境变量 = 裸奔"
  if (!token || auth !== `Bearer ${token}`) {
    return json({ error: 'unauthorized' }, 401)
  }
  let body: unknown
  try {
    body = await ctx.request.json()
  } catch {
    return json({ error: 'invalid', detail: '请求体不是合法 JSON' }, 400)
  }
  const parsed = parseLevelsData(body)
  if (parsed === null) {
    return json({ error: 'invalid', detail: '关卡数据校验失败（结构 / 坐标范围 / 数值区间）' }, 400)
  }
  await ctx.env.LEVELS_KV.put('levels', JSON.stringify({ levels: parsed }))
  return json({ ok: true, count: parsed.length }, 200)
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  switch (ctx.request.method) {
    case 'GET':
      return handleGet(ctx)
    case 'PUT':
      return handlePut(ctx)
    default:
      return json({ error: 'method_not_allowed' }, 405)
  }
}
```

- [ ] **Step 3: 新建 `functions/_middleware.ts`**

```ts
/** 关卡编辑器专属域名：访问其根路径直接呈现编辑器页 */
const EDITOR_HOST = 'demon-level.dengjiabei.cn'

interface Env {
  ASSETS: Fetcher
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  if (url.hostname === EDITOR_HOST && url.pathname === '/') {
    url.pathname = '/level.html'
    return ctx.env.ASSETS.fetch(new Request(url.toString(), ctx.request))
  }
  return ctx.next()
}
```

- [ ] **Step 4: 新建 `functions/tsconfig.json`**（workers 类型与 DOM lib 隔离，避免全局类型冲突）

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["@cloudflare/workers-types"],
    "lib": ["ESNext"]
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 5: 新建 `wrangler.toml`、`.dev.vars.example`，改 `.gitignore` 与 scripts**

`wrangler.toml`：

```toml
name = "demon"
compatibility_date = "2026-07-01"
pages_build_output_dir = "dist"

# 部署前先执行：npx wrangler kv namespace create LEVELS_KV
# 然后把生成的 id 填到下面（本地 pnpm dev:cf 用的是本地模拟 KV，占位 id 不影响）
[[kv_namespaces]]
binding = "LEVELS_KV"
id = "REPLACE_WITH_REAL_KV_NAMESPACE_ID"
```

`.dev.vars.example`：

```
# 复制本文件为 .dev.vars（已 gitignore），供 pnpm dev:cf 本地联调使用
LEVEL_ADMIN_TOKEN=dev-token
```

`.gitignore` 追加一行 `.dev.vars`。

`package.json` scripts：`"typecheck"` 改为 `"tsc --noEmit && tsc --noEmit -p functions"`，并新增：

```json
    "dev:cf": "vite build && wrangler pages dev dist",
    "deploy": "vite build && wrangler pages deploy dist"
```

- [ ] **Step 6: 验证（typecheck + wrangler 本地联调）**

Run: `pnpm typecheck && pnpm test`
Expected: 全绿（functions 目录单独用 workers 类型检查）

```bash
cp .dev.vars.example .dev.vars
pnpm dev:cf
```

另开终端逐条 curl（端口以 wrangler 输出为准，默认 8788）：

```bash
curl -s http://localhost:8788/api/levels
# 预期：{"error":"not_found"}（HTTP 404，本地 KV 为空）

curl -s -X PUT http://localhost:8788/api/levels -H "Content-Type: application/json" --data-binary @src/levels_data.json
# 预期：{"error":"unauthorized"}（无口令 401）

curl -s -X PUT http://localhost:8788/api/levels -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" --data-binary '{"levels":[{"rooms":[{"x":0,"z":1,"w":10,"d":10}],"darkAmbient":0.2,"darkFogFar":20,"ghostSpeed":2.6}]}'
# 预期：{"error":"invalid",...}（x=0 越界 400）

curl -s -X PUT http://localhost:8788/api/levels -H "Authorization: Bearer dev-token" -H "Content-Type: application/json" --data-binary @src/levels_data.json
# 预期：{"ok":true,"count":6}

curl -s http://localhost:8788/api/levels | head -c 80
# 预期：{"levels":[{"rooms":... （200）

curl -s -X DELETE http://localhost:8788/api/levels
# 预期：{"error":"method_not_allowed"}（405）

curl -s -H "Host: demon-level.dengjiabei.cn" http://localhost:8788/ | head -c 200
# 预期：level.html 的开头（Task 8 完成后才有该文件；本任务此条可先跳过，Task 8 复测）
```

同时验证游戏侧：浏览器开 http://localhost:8788/ ，控制台**不再**出现"使用内置关卡"，游戏加载的是刚 PUT 进去的云端 6 关。

- [ ] **Step 7: 提交**

```
feat: 关卡云端 API 与 Pages 部署配置

functions/api/levels：GET 公开读 KV、PUT 管理口令写入（服务端复用
parseLevelsData 校验）；_middleware 把编辑器域名根路径重写到
/level.html；wrangler.toml + .dev.vars.example + dev:cf/deploy 脚本；
functions 独立 tsconfig 用 workers 类型检查。

贡献者：Claude Opus 4.6
```

---

### Task 8: 关卡编辑器页（public/level.html 云端化）

**Files:**
- Create: `public/level.html`（复制小程序编辑器后改造）

**Interfaces:**
- Consumes: `GET/PUT /api/levels` 契约（Task 7）；localStorage 键 `nc-admin-token`（口令）、`nc-editor-draft`（草稿，沿用原编辑器）
- Produces: 可视化编辑 + 云端保存的编辑器页，路径 `/level.html`

- [ ] **Step 1: 复制原编辑器**

```bash
mkdir -p /d/code/demo/my-game/demon/public
cp /d/code/demo/my-game/nightmare-cube-mini-program/tools/level-editor.html /d/code/demo/my-game/demon/public/level.html
```

- [ ] **Step 2: 标题与帮助文案**

- `<title>` 改为 `方块噩梦 · 关卡编辑器`。
- 帮助弹窗（`使用说明` modal）里"出图流程"一行改为：`· 出图流程：画好后点右上角「☁ 保存到云端」→ 所有玩家刷新游戏即玩到新关卡（边缘节点最长约 1 分钟同步）<br />`

- [ ] **Step 3: 加保存按钮**

按钮区（`<button id="btnCopy">复制jSON</button>` 之前）插入：

```html
            <button id="btnCloudSave">☁ 保存到云端</button>
```

- [ ] **Step 4: script 里加云端保存/加载逻辑**

在 `// ================= 草稿自动保存 =================` 注释**之前**插入：

```js
      // ================= 云端保存 / 加载 =================
      const TOKEN_KEY = 'nc-admin-token'
      function getAdminToken(forceAsk) {
        let t = localStorage.getItem(TOKEN_KEY)
        if (!t || forceAsk) {
          t = prompt('请输入管理口令（保存关卡到云端需要）：')
          if (t) localStorage.setItem(TOKEN_KEY, t)
        }
        return t
      }
      async function putLevels(json, token) {
        return fetch('/api/levels', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: json,
        })
      }
      async function cloudSave() {
        const json = guardedJSON()
        if (json === null) return
        let token = getAdminToken(false)
        if (!token) return
        const btn = $('btnCloudSave')
        btn.disabled = true
        btn.textContent = '保存中…'
        try {
          let res = await putLevels(json, token)
          if (res.status === 401) {
            // 口令过期/记错：清掉重新问一次
            localStorage.removeItem(TOKEN_KEY)
            token = getAdminToken(true)
            if (token) res = await putLevels(json, token)
          }
          if (res.ok) {
            alert('已保存，全网生效（边缘节点最长约 1 分钟同步）')
          } else {
            const err = await res.json().catch(() => ({}))
            alert('保存失败（HTTP ' + res.status + '）：' + (err.detail || err.error || '未知错误'))
          }
        } catch (e) {
          alert('保存失败：网络错误 ' + e)
        } finally {
          btn.disabled = false
          btn.textContent = '☁ 保存到云端'
        }
      }
      $('btnCloudSave').onclick = cloudSave
```

- [ ] **Step 5: init 改为云端优先**

把文件末尾的 `;(function init() { ... })()` 整体替换为（云端有数据就用云端；否则维持原草稿恢复逻辑，并顺手补上原版草稿丢失 lightsOn/ghostEnabled 的小缺陷）：

```js
      ;(async function init() {
        setModeUI()
        // 优先加载云端正式数据；失败/为空再回退本地草稿
        let cloudLoaded = false
        try {
          const res = await fetch('/api/levels', { cache: 'no-store' })
          if (res.ok) {
            const data = await res.json()
            if (data && Array.isArray(data.levels) && data.levels.length) {
              loadLevelsData(data.levels)
              cloudLoaded = true
            }
          }
        } catch {}
        if (!cloudLoaded) {
          try {
            const d = JSON.parse(localStorage.getItem('nc-editor-draft'))
            if (
              d &&
              Array.isArray(d.levels) &&
              d.levels.length &&
              confirm('云端暂无数据。检测到本地草稿，是否恢复？（取消 = 空白画布）')
            ) {
              levels = d.levels.map((lv) => ({
                rooms: lv.rooms || [],
                corrRects: lv.corrRects || [],
                darkAmbient: lv.darkAmbient || 0.2,
                darkFogFar: lv.darkFogFar || 20,
                ghostSpeed: lv.ghostSpeed || 2.8,
                lightsOn: lv.lightsOn === true,
                ghostEnabled: lv.ghostEnabled !== false,
              }))
              cur = Math.min(d.cur || 0, levels.length - 1)
            }
          } catch {}
        }
        render()
      })()
```

- [ ] **Step 6: 联调验证**

Run: `pnpm dev:cf`（沿用 Task 7 的 .dev.vars）

1. 浏览器开 http://localhost:8788/level.html → 编辑器加载出 Task 7 里 PUT 进去的 6 关（云端优先生效）。
2. 随便改一关（如把第 1 关房间缩小），点「☁ 保存到云端」→ 首次弹口令框，输 `dev-token` → 提示已保存。
3. 故意输错口令验证：DevTools 里 `localStorage.removeItem('nc-admin-token')` 后再保存，输错口令 → 保存失败并再次弹窗。
4. 拖一个孤岛房间（不与其它连通）→ 点保存 → 弹"配置有错误"拦截，不发请求。
5. 新开标签访问 http://localhost:8788/ → 游戏加载到刚保存的修改。
6. `curl -s -H "Host: demon-level.dengjiabei.cn" http://localhost:8788/ | head -c 200` → 返回编辑器 HTML 开头（middleware 域名分流生效）。

- [ ] **Step 7: 提交**

```
feat: 网页版关卡编辑器（云端加载/保存）

复制小程序编辑器为 public/level.html：新增「保存到云端」（管理
口令，401 自动重问）与打开时云端优先加载；保留原有画房间/走廊、
参数、连通性校验与本地草稿；顺手修复草稿恢复丢 lightsOn/
ghostEnabled 的问题。

贡献者：Claude Opus 4.6
```

---

### Task 9: 部署文档 + README + 全链路验收

**Files:**
- Create: `docs/DEPLOY.md`
- Modify: `README.md`（特性、结构、开发命令、部署段落）
- Modify: `CLAUDE.md`（目录结构与"仍需关注"提到关卡系统入口，简述）

**Interfaces:**
- Consumes: 前八个任务的全部产出
- Produces: 可交付的分支（文档 + 验收通过）

- [ ] **Step 1: 新建 `docs/DEPLOY.md`**

```markdown
# 部署指引（Cloudflare Pages + KV）

## 一次性配置

1. **创建 KV 命名空间**：
   `npx wrangler kv namespace create LEVELS_KV`
   把输出的 id 填入 `wrangler.toml` 的 `kv_namespaces[0].id`。
2. **首次部署**：`pnpm deploy`（= vite build + wrangler pages deploy dist，
   项目名取 wrangler.toml 的 `name = "demon"`）。
3. **控制台配置**（Cloudflare Dashboard → Pages → demon）：
   - Custom domains 绑定两个域名：游戏主域名 + `demon-level.dengjiabei.cn`
     （编辑器域名的根路径由 functions/_middleware.ts 自动呈现编辑器）。
   - Settings → Environment variables 添加 `LEVEL_ADMIN_TOKEN=<管理口令>`
     （Production 环境；改完需重新部署一次生效）。

## 日常发布

代码更新：`pnpm typecheck && pnpm test && pnpm deploy`
关卡更新：无需发版——打开 `https://demon-level.dengjiabei.cn/` 画好点
「☁ 保存到云端」即可（KV 全球同步最长约 1 分钟）。

## 本地联调

```bash
cp .dev.vars.example .dev.vars   # 本地口令默认 dev-token
pnpm dev:cf                      # http://localhost:8788（游戏 / /level.html 编辑器 / /api）
```

日常改游戏逻辑用 `pnpm dev` 即可（无 API 时自动回退内置关卡）。
```

- [ ] **Step 2: 更新 README.md 与 CLAUDE.md**

README：特性列表加「🗺️ 云端可配置关卡 —— 选关菜单 + 顺序解锁，编辑器保存即全网生效」；项目结构补 `public/level.html`、`functions/`、`src/levels*.ts`、`src/progress.ts`、`src/level_service.ts`；开发命令补 `pnpm test` / `pnpm dev:cf` / `pnpm deploy`；部署段落改为指向 `docs/DEPLOY.md`。
CLAUDE.md：目录结构小节补上述新文件一行说明；开发命令表补 `test`/`dev:cf`/`deploy`。

- [ ] **Step 3: 全量回归验收**

```bash
pnpm typecheck && pnpm test && pnpm build
```
Expected: 全绿、构建成功。

按设计文档 §11 的实机清单完整过一遍（`pnpm dev` 游戏侧 6 项 + `pnpm dev:cf` 编辑器全链路），发现问题当场修复并纳入本任务提交。

- [ ] **Step 4: 提交**

```
docs: 部署指引与 README/CLAUDE 更新（关卡系统）

贡献者：Claude Opus 4.6
```

---

## 计划自审记录

- **规格覆盖**：规格 §4 Schema→Task 1；§6.3 进度→Task 2；§6.1 world→Task 3；§6.4/6.5 ghost/player→Task 4；§5.2 加载→Task 5；§6.2/6.6 game/UI/文案→Task 6；§8/§3 API/middleware/wrangler→Task 7；§7 编辑器→Task 8；§9/§11 部署文档与验收→Task 9。无遗漏。
- **类型一致性**：`getLevelConfig(levels, n)` 双参签名在 Task 1 定义、Task 6 使用一致；`MansionOptions` Task 1 定义、Task 3/6 使用一致；`isEnabled` getter Task 4 定义、Task 6 心跳分支使用一致；localStorage 键名 `levelReached`/`levelCleared`/`nc-admin-token`/`nc-editor-draft` 全文一致。
- **占位符**：无 TBD/TODO；所有代码步骤均给出完整代码或精确锚点替换指令。
