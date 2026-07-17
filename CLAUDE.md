# CLAUDE.md

> 本文件为 Claude Code / 任何 AI Agent 在本仓库工作时的指引，概述项目架构、开发流程与协作约定。

---

## 1. 项目概述

**方块噩梦 (Blocky Horror / Horror Maze Adventure)** —— 一款基于 Three.js 的第一人称恐怖迷宫逃脱游戏。玩家需要在程序生成的豪宅中寻找钥匙并通过出口逃脱，同时躲避一个会沿 A\* 路径追击的幽灵 AI。

- **形态**：前端 SPA（游戏 + 关卡编辑器）+ Cloudflare Pages Functions 轻后端（关卡数据 REST API，KV 存储）
- **部署**：Cloudflare Pages（`pnpm run deploy` 一键发布；详见第 9 节与 `docs/DEPLOY.md`）

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
pnpm test           # vitest run，跑 levels / progress / level_service / stamina / ghost 单测
pnpm dev:cf         # vite build + wrangler pages dev dist，本地模拟 Functions + KV（默认 http://localhost:8788）
pnpm run deploy         # vite build + wrangler pages deploy dist，发布到 Cloudflare Pages
```

> ⚠️ 本项目**没有配置 ESLint / Prettier**，目前仅靠 `tsc --noEmit` 做静态检查。修改前请至少运行 `pnpm typecheck` 再交付。

---

## 4. 目录结构

```
horror-maze-adventure/
├── index.html                 # 游戏页入口 HTML，包含所有 UI 层 DOM + 内联样式（游戏风像素 UI）
├── vite.config.ts             # Vite 配置：/level 无后缀重写（等效线上）+ /api 代理到线上生产
├── tsconfig.json              # TS 配置（strict + ESNext + bundler）
├── vitest.config.ts           # vitest 配置：node 环境 + tests/setup.ts DOM 桩（canvas/Image/固定种子随机）
├── wrangler.toml               # Cloudflare Pages 配置 + KV 绑定（LEVELS_KV，binding 名固定）
├── package.json
├── README.md
├── CLAUDE.md                  # ← 本文件
├── docs/
│   ├── DEPLOY.md                # 部署指引：一次性配置 / 日常发布 / 本地联调 / 部署后验证清单
│   └── superpowers/             # 关卡系统设计文档与实施计划（specs/plans）
├── public/
│   ├── level.html                # 关卡编辑器页（自包含单文件，云端加载/保存；线上路径 /level，
│   │                               Pages 原生无后缀路由，本地 dev 由 vite 中间件等效重写；
│   │                               进门口令门禁 + 游戏页同款像素风 UI + 1280×800~1920×1080 自适应）
│   └── level-default.json        # 初版硬编码地图存档（关卡系统之前的默认地图，仅留档）
├── functions/                   # Cloudflare Pages Functions（部署时自动生效）
│   └── api/
│       └── levels.ts               # GET 公开读关卡 ／ POST 口令预校验 ／ PUT 口令写入 KV
│                                     （服务端复用 src/levels.ts 的校验）
├── tests/                        # vitest 单测：levels / progress / level_service / stamina / ghost
│                                   （setup.ts = DOM 桩；fixtures.ts = 固定 10 房布局）
└── src/
    ├── game.ts                # 主循环 / 场景组装 / UI 事件绑定 / 关卡生命周期与选关面板
    ├── player.ts              # 玩家控制、相机、碰撞、交互、手电筒、道具状态（钥匙/雷达/鞋子）
    ├── ghost.ts               # 幽灵 AI（巡逻 / 追击状态机 + A* 寻路 + Bresenham 视线）
    ├── world.ts               # 关卡驱动的豪宅生成、网格碰撞、交互物分布
    ├── minimap.ts             # 2D 小地图 Canvas 绘制 + 选关卡片缩略图（drawLevelThumbnail）
    ├── sound_generator.ts     # 基于 Web Audio API 的程序化音效
    ├── localization.ts        # 中/英 文本词典（根据 navigator.language 自动选择）
    ├── types.ts               # Room / RoomLayout / MansionOptions / Interactable / LightSwitch
    ├── utils.ts               # 共享材质 materials、像素化 Canvas 纹理、图片纹理加载
    ├── levels.ts                # LevelConfig 接口 + parseLevelsData 校验 + getLevelConfig（游戏端与 Functions 端共用同一份）
    ├── levels_data.json         # 内置兜底 6 关关卡数据（自小程序移植）
    ├── progress.ts               # 关卡进度纯函数：migrateProgress（迁移钳制）/ isLevelUnlocked（解锁判定）
    ├── stamina.ts                # 体力纯函数：tickStamina（疾跑 10s 耗尽 / 松开 60s 回满）/ canSprint
    ├── level_service.ts          # 云端关卡拉取：3 秒超时 + 校验失败 / 网络错误一律回退内置关卡
    ├── constants.ts               # 共享数值常量：LIT_AMBIENT / LIT_FOG_NEAR / LIT_FOG_FAR / DARK_FOG_NEAR
    └── static/                # 墙 / 地面贴图
```

---

## 5. 架构核心

### 5.1 运行时对象图

```
Game (game.ts)
  ├─ THREE.Scene / PerspectiveCamera / WebGLRenderer
  ├─ levels: LevelConfig[]      — 云端拉取（level_service）失败回退内置（BUILTIN_LEVELS）
  ├─ World (world.ts)           — 按当前关卡配置生成网格、墙体、家具、交互物
  │    └─ interactables[]       — cabinet / switch / key / radar / shoes / door
  ├─ Player (player.ts)         — 持有 camera + flashlight (SpotLight)；道具态 hasKey/hasRadar/hasShoes
  ├─ Ghost (ghost.ts)           — 持有 mesh + 位置音效；速度由关卡配置注入
  └─ SoundGenerator             — 心跳 / 开关 / 拾取 / 幽灵呼吸
```

### 5.2 关卡 Schema 与数据流

- **单一校验源**：`src/levels.ts` 的 `parseLevelsData`（游戏端与 `functions/api/levels.ts` 共用），
  任何一处非法整包拒绝返回 null。字段：`rooms`（必填）/ `corridorRects` / `darkAmbient` /
  `darkFogFar` / `ghostSpeed`（2.0~6.0）/ `lightsOn` / `ghostEnabled` / `minimapEnabled`
  （默认 true；false 时隐藏小地图、M 键失效、雷达不投放）/ `frozen`（冻结停用，后续关顺位前移，
  至少须保留一个未冻结关卡）/ `id`（可选唯一标识，编辑器发放形如 `lv_xxx`；
  非法/重复宽松丢弃不拒包，编辑器加载时补发）
- **数据流**：编辑器（/level，口令 PUT）→ KV → 游戏启动 `loadLevels`（3 秒超时，失败回退内置 6 关）；
  游戏端与内置数据都会过滤 `frozen` 关
- **进度**：`localStorage`（levelCleared / levelReached），`migrateProgress` 在关卡数变化时钳制

### 5.3 地图生成管线（`World.generateMansion`）

1. **网格初始化**：`MAP_WIDTH × MAP_DEPTH = 100×100`，全部置 1（墙），与编辑器/小程序坐标系对齐
2. **房间挖凿**：按关卡配置 `rooms[]` 置 0；重叠/贴边的房间自动打通拼成不规则大房间
3. **走廊挖凿**：按 `corridorRects[]` 原样挖空（手画走廊）；与 1 号房不连通的孤岛房间自动补 L 形直廊兜底
4. **可行走节点收集**：`walkableNodes[]`（仅主连通域）
5. **墙体分类**：`room` 墙 / `corridor` 墙 / `corner` 墙（多材质 BoxGeometry 按朝向贴图）
6. **构建 InstancedMesh**：地板、天花板、走廊墙、房间墙分别批量实例化
7. **物品分配**：房间洗牌后轮转分配 door / switch / key / radar / **shoes** / cabinet
   （出生房垫底；房间不够绕回复用；`minimapEnabled=false` 时跳过 radar）
8. **门与开关贴墙**：`randomOnWall` 会验证相邻格必须是墙体，保证贴墙不穿墙
9. **柜子避让出生格**：绝不压在玩家出生格上（防开局卡死）

### 5.4 幽灵 AI（`Ghost.update`）

- **状态**：`patrol` ↔ `chase`；**追击速度 = 配置巡逻速度 × 1.5**
- **发现玩家四条件**（全部满足才进入 chase）：未躲藏 + 距离 < 20 米 + 前方视野锥内
  （朝向点积 > 0.3 ≈ 145° 锥角）+ Bresenham 栅格视线无墙体/高家具遮挡
- **寻路**：A\* + 二叉小堆，500 ms 重规划一次；最多 2000 次迭代后返回最近节点
- **沿路径移动（丝滑化）**：位移预算循环（单帧位移跨路径点连续消费，路径点交接无零位移
  冻结帧、高速不过冲）+ 朝向指数平滑（`TURN_RATE=12`，最短弧插值替代 lookAt 瞬跳）+
  LOS 前瞻跳点（`PATH_LOOKAHEAD=6`，行走版直线检查 `hasWalkableLine`：家具算阻挡、
  禁斜穿墙角对角缝，与只挡高家具的视线版不同）
- **抓捕判定**：水平臂展 `CATCH_RADIUS=1.15` 且玩家脚位高出幽灵中心 < `CATCH_MAX_RISE=1.0`
  （单层箱顶摸得着、双层柜顶绝对安全），取本帧移动后位置；躲藏（isHidden）免疫
- **放弃追击**：玩家进入隐藏（`isHidden`）；追击目标到达时玩家已不在视野；
  追击路径无法推进累计超时 `CHASE_STUCK_TIMEOUT_MS = 30 s`（例如玩家站箱顶）

### 5.5 数值体系（速度与视距）

- **玩家**：步行 `baseSpeed = 4` 米/秒；Shift 疾跑 ×1.5 = 6；拾到**鞋子**再 ×1.5（步行 6 / 疾跑 9），
  死亡重开或切关重置
- **体力**（`src/stamina.ts` 纯函数，UI 为屏幕正下方长条）：0~1，进关满值；
  疾跑消耗的前提是 **Shift + 方向键同时按住**，持续疾跑 10 秒耗尽，耗尽强制回落步行；
  松开 Shift 才恢复（1 分钟回满），**按住 Shift 期间（含静止）永不恢复**——消耗/冻结/恢复
  三态互斥，无同帧进出水；躲藏中不消耗，暂停/结算时主循环停转自然冻结
- **幽灵**：巡逻 2.0~6.0 可配（**步进 0.5**，默认 3），追击 ×1.5 → 3~9；解析时对历史数据
  钳 [2,6] + 吸附 0.5 倍数（显著非法 ≤0/>6 仍整包拒收）；配置 < 2.7 追不上步行玩家（教学关），
  4.0 以上无鞋必被追上（鞋子成为生存必需）
- **雾（视距）**：开灯 `near/far = 120/200`（120 米内完全清澈，任何房间一眼到底）；
  关灯 `near = 2`、far = 关卡配置 `darkFogFar`（8~30）。相机远裁剪面 220 > 雾 far，
  改雾距时须保证这一不变量
- **出生规则**：玩家出生点 = `walkableNodes` 中位元素（确定性）；初始朝向固定 -Z；
  幽灵出生在离玩家直线最远的可走格

### 5.6 碰撞与视线模型

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

### 5.7 重开流程（`Game.buildLevel` / `restart`）

- 不刷新页面，完全走内存重建：`World.regenerate(cfg.rooms, opts)` → dispose GPU 资源 →
  `generateMansion()` → `player.reset()` + `ghost.reset()` → `spawn()` → `applyLevelConfig(cfg)`
  （幽灵速度/开关、环境光雾、小地图开关一并应用）

### 5.8 游戏 UI 与编辑器（像素风统一）

- **游戏页流程**：主菜单「开始游戏」→ 选关卡片面板（地图缩略图卡片，单击选中、
  「进入游戏」确认、双击直进、锁定关灰显）→ 游玩；小地图仅游玩中显示，M 键放大
  （`minimapEnabled=false` 的关卡整体禁用）
- **编辑器 /level**：进门口令门禁（POST /api/levels 预校验，localStorage 记住口令，
  离线可进本地草稿模式）；左右栏与全部弹框为游戏页同款像素风（`gameAlert`/`gameConfirm`
  替代原生弹框）；画布 560~1050 随视口自适应（1280×800~1920×1080 无滚动条，布局
  min-width 由 `syncCanvasSize` 显式同步——勿改回 min-content，列表 nowrap 文本会传导成页面宽）；
  重叠房间的边框段画暗虚线、重叠区同层同状态合一路径单次填充不叠色加深、房号按层级
  亮暗分层且选中置顶（只改绘制顺序不动数组）；主题弹框仅由「关闭」「使用」（及 Esc 分层）
  收起，点遮罩空白不关闭；调色为自绘拾色浮层（SV 面板+色相条+EyeDropper 吸管+HEX 手输，
  HSV 为唯一事实源，点「确定」才写入草稿）；关卡可冻结/解冻（冻结关列表行只剩「解冻」按钮、不可删除，
  参数/主题/画布全面只读，仅可平移缩放查看）；本地草稿自动保存、与云端冲突时弹框二选一
- **本地 /api**：`pnpm dev` 下由 vite 代理到线上生产（demon.dengjiabei.cn）——
  本地编辑器「保存到云端」写的就是生产数据

---

### ⚠️ 仍需关注

1. **Corner 墙放弃了 InstancedMesh**  
   `world.ts` 每个转角每层都 `new Mesh`，累计几十到上百个独立 draw call。规模不大时可忽略，后续可按"材质组合 key"聚合成 InstancedMesh 再批量实例化。

2. **`box.exe.stackdump` 偶尔残留在工作区根目录**（Cygwin bash 崩溃产物）。

3. **本机 workerd 需 VC++ 14.40+**：Windows 本地跑 `pnpm dev:cf` 依赖的 workerd 原生二进制要求
   Microsoft Visual C++ 2015-2022 Redistributable (x64) ≥ 14.40，版本过旧会在启动时崩溃（`0xc0000005`）。
   不影响 Cloudflare 云端部署与线上运行，详见 `docs/DEPLOY.md`。

4. **存量关卡难度已随速度体系变化**：玩家步行 6 → 4 之后，按旧速度调的关卡
   （ghostSpeed 2.6~2.8）体感变难（追击 3.9~4.2 > 步行 4），必要时在编辑器下调或依赖鞋子平衡。
   速度规格化（步进 0.5）后旧值在解析时自动就近归位（如 2.6→2.5）；内置 6 关已改存
   合规值（第 1 关 2、其余 2.5），云端存量数据加载时同样被吸附。

### 🧹 代码质量建议

- `World.generateMansion` 超过 400 行，可拆分：`buildGrid` / `classifyWalls` / `buildMeshes` / `placeInteractables`
- 大量 `!` 非空断言，可用更早的 guard 替代
- 剩余魔法数字（心跳阈值 15、幽灵感知半径 20、橱柜 8 方向弹出偏移）可继续集中到 `constants.ts`
  （环境光/雾距已完成集中）
- 建议引入 ESLint + Prettier（全局 CLAUDE.md 已强制要求；`public/level.html` 已经历一次
  IDE Prettier 全文格式化，风格为双引号+分号）

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
- **不要自作主张提交/上线**：完成修改后只做 typecheck / 单测 / 本地验证并汇报；
  `git commit`、`pnpm run deploy`、`git push` 三件事都必须等用户明确指令（说其一只做其一）

---

## 9. 部署（Cloudflare Pages）

`package.json` 已配置 `pnpm run deploy`（= `vite build` + `wrangler pages deploy dist`，项目名取
`wrangler.toml` 的 `name = "demon"`，生产分支 `main`）。关卡系统还依赖 KV 命名空间绑定与
`LEVEL_ADMIN_TOKEN` 环境变量等一次性配置（编辑器走主站 `/level` 路径，无独立域名分流）；
完整步骤、日常发布流程、本地联调注意事项与部署后验证清单见 [`docs/DEPLOY.md`](./docs/DEPLOY.md)。
部署后边缘节点传播约需 1 分钟，期间新旧 HTML/bundle 混合可能报 module MIME 错误，稍候强刷即可。

## 10. 调试技巧

- **卡场景问题**：浏览器 DevTools → Performance 录制一帧，看是否 InstancedMesh 没生效（如新增网格忘记 `instanceMatrix.needsUpdate = true`）
- **追击卡死**：查看控制台是否打印 `[Player] popOutOfHiding: 8 方向全部堵死`，意味着玩家退出橱柜时四周全是墙/家具
- **A\* 找不到路**：`Ghost.findPath` 限 2000 次迭代，超出后返回距离最近可达点；若幽灵持续不动，可能是 `hasFurnitureAt` 把目标格子标了家具阻塞
- **内存泄漏**：每次 `World.regenerate()` 都会走 `disposeWorldResources`；若发现 GPU 内存持续增长，检查新增的非共享材质是否被 `materials` 白名单漏掉
