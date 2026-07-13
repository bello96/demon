# CLAUDE.md

> 本文件为 Claude Code / 任何 AI Agent 在本仓库工作时的指引，概述项目架构、开发流程与协作约定。

---

## 1. 项目概述

**方块噩梦 (Blocky Horror / Horror Maze Adventure)** —— 一款基于 Three.js 的第一人称恐怖迷宫逃脱游戏。玩家需要在程序生成的豪宅中寻找钥匙并通过出口逃脱，同时躲避一个会沿 A\* 路径追击的幽灵 AI。

- **形态**：前端 SPA（游戏 + 关卡编辑器）+ Cloudflare Pages Functions 轻后端（关卡数据 REST API，KV 存储）
- **部署**：Cloudflare Pages（`pnpm deploy` 一键发布；详见第 9 节与 `docs/DEPLOY.md`）

---

## 2. 技术栈

| 层       | 选择                          | 版本       |
| -------- | ----------------------------- | ---------- |
| 渲染引擎 | `three`                       | ^0.168.0   |
| 构建工具 | `vite`                        | ^6.x       |
| 语言     | TypeScript (strict)           | ^5.7       |
| 包管理   | `pnpm`（有 `pnpm-lock.yaml`） | -          |
| 音频     | Web Audio API（程序化合成）   | 浏览器原生 |

---

## 3. 开发命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 启动本地开发服务器（Vite，默认 http://localhost:5173）
pnpm build          # 构建到 dist/
pnpm preview        # 预览生产构建
pnpm typecheck      # tsc --noEmit（含 functions/ 子项目），只做类型检查
pnpm test           # vitest run，跑 levels / progress / level_service 单测
pnpm dev:cf         # vite build + wrangler pages dev dist，本地模拟 Functions + KV（默认 http://localhost:8788）
pnpm deploy         # vite build + wrangler pages deploy dist，发布到 Cloudflare Pages
```

> ⚠️ 本项目**没有配置 ESLint / Prettier**，目前仅靠 `tsc --noEmit` 做静态检查。修改前请至少运行 `pnpm typecheck` 再交付。

---

## 4. 目录结构

```
horror-maze-adventure/
├── index.html                 # 游戏页入口 HTML，包含所有 UI 层 DOM + 内联样式
├── vite.config.ts             # Vite 构建配置（仅 target: esnext）
├── tsconfig.json              # TS 配置（strict + ESNext + bundler）
├── wrangler.toml               # Cloudflare Pages 配置 + KV 绑定（LEVELS_KV，binding 名固定）
├── package.json
├── README.md
├── CLAUDE.md                  # ← 本文件
├── docs/
│   └── DEPLOY.md                # 部署指引：一次性配置 / 日常发布 / 本地联调 / 部署后验证清单
├── public/
│   └── level.html                # 关卡编辑器页（自包含单文件，云端加载/保存；域名分流后即编辑器首页）
├── functions/                   # Cloudflare Pages Functions（部署时自动生效）
│   ├── _middleware.ts            # 编辑器域名（demon-level.dengjiabei.cn）根路径重写到 /level.html
│   └── api/
│       └── levels.ts               # GET 公开读关卡 ／ PUT 口令写入 KV（服务端复用 src/levels.ts 的校验）
├── tests/                        # vitest 单测：levels / progress / level_service
└── src/
    ├── game.ts                # 主循环 / 场景组装 / UI 事件绑定 / 关卡生命周期与选关面板
    ├── player.ts              # 玩家控制、相机、碰撞、交互、手电筒
    ├── ghost.ts               # 幽灵 AI（巡逻 / 追击状态机 + A* 寻路 + Bresenham 视线）
    ├── world.ts               # 程序化豪宅生成、网格碰撞、交互物分布
    ├── minimap.ts             # 2D 小地图 Canvas 绘制
    ├── sound_generator.ts     # 基于 Web Audio API 的程序化音效
    ├── localization.ts        # 中/英 文本词典（根据 navigator.language 自动选择）
    ├── materials（utils.ts） # 共享材质、像素化 Canvas 纹理、图片纹理加载
    ├── types.ts               # Room / RoomLayout / Interactable / LightSwitch 接口
    ├── utils.ts               # 见上方 materials
    ├── levels.ts                # LevelConfig 接口 + parseLevelsData 校验 + getLevelConfig（游戏端与 Functions 端共用同一份）
    ├── levels_data.json         # 内置兜底 6 关关卡数据（自小程序移植）
    ├── progress.ts               # 关卡进度纯函数：migrateProgress（迁移钳制）/ isLevelUnlocked（解锁判定）
    ├── level_service.ts          # 云端关卡拉取：3 秒超时 + 校验失败 / 网络错误一律回退内置关卡
    ├── constants.ts               # 共享数值常量（如 LIT_AMBIENT / LIT_FOG_FAR）
    └── static/                # 墙 / 地面贴图
```

---

## 5. 架构核心

### 5.1 运行时对象图

```
Game (game.ts)
  ├─ THREE.Scene / PerspectiveCamera / WebGLRenderer
  ├─ World (world.ts)           — 生成网格、墙体、地板、天花板、家具、交互物
  │    └─ interactables[]       — cabinet / switch / key / radar / door
  ├─ Player (player.ts)         — 持有 camera + flashlight (SpotLight)
  ├─ Ghost (ghost.ts)           — 持有 mesh + 位置音效
  └─ SoundGenerator             — 心跳 / 开关 / 拾取 / 幽灵呼吸
```

### 5.2 地图生成管线（`World.generateMansion`）

1. **网格初始化**：`MAP_WIDTH × MAP_DEPTH = 80×80`，全部置 1（墙）
2. **房间挖凿**：按 `roomLayout[]` 把房间区域置 0
3. **走廊连接**：相邻房间中心用 L 形走廊连通
4. **可行走节点收集**：`walkableNodes[]`
5. **墙体分类**（本分支重点）：
   - `room` 墙：所有邻居都是房间内 → 贴 `roomWall` 材质
   - `corridor` 墙：邻居都是走廊或完全封闭 → 贴 `stone` 砖纹
   - `corner` 墙：同时邻房间和走廊 → 单独用**多材质 BoxGeometry**，每个面按朝向贴不同材质，视觉上形成 90° 转角切换
6. **构建 InstancedMesh**：地板、天花板、走廊墙、房间墙分别批量实例化
7. **物品分配**：剩余房间打乱后按顺序分配 door / switch / key / radar / cabinet
8. **门与开关贴墙**：`randomOnWall` 会验证相邻格必须是墙体，保证贴墙不穿墙
9. **bed 装饰**：在 `features.includes('bed')` 的非特殊房间随机放一张压扁的床（仅阻挡移动，不遮挡视线）

### 5.3 幽灵 AI（`Ghost.update`）

- **状态**：`patrol` ↔ `chase`
- **视觉**：Bresenham 栅格视线（`hasLineOfSight`）+ 点积判定朝向（cos > 0.3）
- **寻路**：A\* + 二叉小堆，500 ms 重规划一次；最多 2000 次迭代后返回最近节点
- **放弃追击**：
  - 玩家进入隐藏（`isHidden`）
  - 追击目标到达时玩家已不在视野
  - 追击时路径无法推进累计超时 `CHASE_STUCK_TIMEOUT_MS = 30 s`（例如玩家站箱顶）

### 5.4 碰撞与视线模型

**`World.checkCollision`**（移动碰撞）

- 墙 / 地板 / 天花板：**直接查栅格**，O(邻格)，零分配
- 家具：用 `furnitureBlocks: Set<string>` 记 `"x,y,z"`，线性扫描（数量少）
- 玩家：AABB 模型（radius + height）

**`World.hasTallFurnitureAtGrid`**（视线遮挡）

- 独立的 `tallFurnitureBlocks: Set<string>`，只记录高家具（橱柜）
- 供 `Ghost.hasLineOfSight` 的 Bresenham 栅格遍历查询
- 床等矮家具不入此集合，不遮挡幽灵视线

**`World.getWallMapCanvas`**（小地图缓存）

- 首次调用时按 `MAP_WIDTH × MAP_DEPTH` 像素生成一张灰色墙体位图
- `regenerate` 时清空，下一帧懒重建

### 5.5 重开流程（`Game.restart`）

- 不刷新页面，完全走内存重建：`World.regenerate()` → dispose GPU 资源 → `generateMansion()` → `player.reset()` + `ghost.reset()` → `spawn()`

---

### ⚠️ 仍需关注

1. **Corner 墙放弃了 InstancedMesh**  
   `world.ts` 每个转角每层都 `new Mesh`，累计几十到上百个独立 draw call。规模不大时可忽略，后续可按"材质组合 key"聚合成 InstancedMesh 再批量实例化。

2. **`box.exe.stackdump` 偶尔残留在工作区根目录**（Cygwin bash 崩溃产物）。

3. **本节以上「5. 架构核心」仍是关卡系统改造前的描述**（固定 10 房间、80×80 网格、`roomLayout[]` 硬编码等）。
   关卡系统实际设计（100×100 网格、`corridorRects` 手画走廊、云端 Schema 与选关/进度/编辑器数据流）
   以 `docs/superpowers/specs/2026-07-13-level-system-design.md` 为准；关卡系统入口见「4. 目录结构」新增的
   `public/level.html`（编辑器）/ `functions/api/levels.ts`（API）/ `src/level_service.ts`（游戏侧云端加载）。

4. **本机 workerd 需 VC++ 14.40+**：Windows 本地跑 `pnpm dev:cf` 依赖的 workerd 原生二进制要求
   Microsoft Visual C++ 2015-2022 Redistributable (x64) ≥ 14.40，版本过旧会在启动时崩溃（`0xc0000005`）。
   不影响 Cloudflare 云端部署与线上运行，详见 `docs/DEPLOY.md`。

### 🧹 代码质量建议

- `World.generateMansion` 超过 400 行，可拆分：`buildGrid` / `classifyWalls` / `buildMeshes` / `placeInteractables`
- 大量 `!` 非空断言，可用更早的 guard 替代
- 魔法数字（心跳阈值 15、幽灵速度 2.8、橱柜 8 方向弹出偏移）集中到 `constants.ts`
- 建议引入 ESLint + Prettier（全局 CLAUDE.md 已强制要求）

---

## 7. 代码约定（项目级）

> 以下约定与 `~/.claude/CLAUDE.md` 全局规则一致，团队需遵守：

- **优先 TypeScript**，新文件必须 `.ts`
- **所有 `if` 必须带花括号 `{}`**，即便只有一行（本仓库现有代码已遵守）
- **公开 API 必须有类型注解**（函数参数 / 返回值 / 导出变量）
- **中文注释、中文 commit 描述**：
  - `feat:` / `fix:` / `style:` 等前缀保留英文
  - 描述部分必须中文
  - 贡献者署名统一：`贡献者：Claude Opus 4.6`（不要 `Co-Authored-By: ...`）
- **UI 实现**：无设计稿时**不要猜布局**，先索取截图
- **编辑完成后**必须运行 `pnpm typecheck`，确保无 TS 错误再交付

---

## 9. 部署（Cloudflare Pages）

`package.json` 已配置 `pnpm deploy`（= `vite build` + `wrangler pages deploy dist`，项目名取
`wrangler.toml` 的 `name = "demon"`）。关卡系统还依赖 KV 命名空间绑定、`LEVEL_ADMIN_TOKEN`
环境变量、编辑器域名分流等一次性配置；完整步骤、日常发布流程、本地联调注意事项与部署后验证
清单见 [`docs/DEPLOY.md`](./docs/DEPLOY.md)。

## 10. 调试技巧

- **卡场景问题**：浏览器 DevTools → Performance 录制一帧，看是否 InstancedMesh 没生效（如新增网格忘记 `instanceMatrix.needsUpdate = true`）
- **追击卡死**：查看控制台是否打印 `[Player] popOutOfHiding: 8 方向全部堵死`，意味着玩家退出橱柜时四周全是墙/家具
- **A\* 找不到路**：`Ghost.findPath` 限 2000 次迭代，超出后返回距离最近可达点；若幽灵持续不动，可能是 `hasFurnitureAt` 把目标格子标了家具阻塞
- **内存泄漏**：每次 `World.regenerate()` 都会走 `disposeWorldResources`；若发现 GPU 内存持续增长，检查新增的非共享材质是否被 `materials` 白名单漏掉
