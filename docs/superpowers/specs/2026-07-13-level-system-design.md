# 关卡系统设计文档（level 分支）

> 日期：2026-07-13
> 状态：已与需求方逐节确认通过
> 分支：`level`（所有改动仅在此分支）

---

## 1. 背景与目标

「方块噩梦」网页版（本仓库）当前地图由 `game.ts` 顶部硬编码的 `roomLayout[]` 驱动，无法配置、只有一张图。衍生的微信小程序版（`nightmare-cube-mini-program`，**只读参考，不做任何修改**）已实现一套关卡系统：关卡 JSON 数据 + 可视化编辑器 + 顺序解锁进度。

本设计把关卡概念反向移植回网页版，并升级数据流为**云端配置**：

1. 地图从硬编码改为**关卡配置驱动**，与小程序共用同一套关卡 JSON 格式。
2. 游戏增加**选关菜单 + 顺序解锁**（通过第 N 关解锁第 N+1 关，进度存浏览器）。
3. 增加网页版**关卡编辑器**，访问 `https://demon.dengjiabei.cn/level` 直达（无 .html 后缀）；点击「保存到云端」后**全网所有玩家生效**。
4. 写操作用**管理口令**保护；读操作公开。

## 2. 已确认的关键决策

| 决策点 | 结论 | 说明 |
|---|---|---|
| 生效范围 | 全网所有玩家 | 引入 Cloudflare Pages Functions + KV 云端存储 |
| 关卡结构 | 选关菜单 + 顺序解锁 | 通过第 N 关解锁第 N+1 关，进度存 localStorage |
| 编辑鉴权 | 管理口令 | 口令存 Pages 环境变量 `LEVEL_ADMIN_TOKEN`，读公开、写需口令 |
| 总体方案 | 单仓库一体化 | 游戏 + 编辑器 + API + KV 配置全在本仓库，单 Pages 项目部署 |
| 网格尺寸 | demon 从 80×80 改为 **100×100** | 与小程序对齐，编辑器与现成 6 关数据可原样复用 |
| Schema | 与小程序 100% 一致 | 编辑器导出 JSON 两边通用；`doorCount` 保留但恒为 1；删除网页版死字段 `RoomLayout.features` |

## 3. 总体架构

```
demon 仓库（level 分支，单个 Cloudflare Pages 项目）
├── index.html             游戏页（现有）
├── public/
│   └── level.html         ★关卡编辑器页（自小程序编辑器复制改造，自包含单文件，
│                            放 public/ 由 Vite 原样拷贝，线上路径 /level——Pages 原生无后缀路由）
├── functions/             ★Cloudflare Pages Functions（部署时自动生效）
│   └── api/
│       └── levels.ts        GET 公开读关卡 ／ PUT 口令写入 KV
├── src/
│   ├── levels.ts           ★LevelConfig 接口 + parseLevelsData 校验 + getLevelConfig
│   │                         （自小程序移植；游戏端与 Functions 端共用同一份）
│   ├── levels_data.json    ★内置兜底 6 关（自小程序移植，坐标基于 100×100）
│   ├── progress.ts         ★migrateProgress / isLevelUnlocked 纯函数（自小程序移植，零改动）
│   ├── level_service.ts    ★云端拉取 + 超时 + 回退内置
│   ├── world.ts            改造：100×100、corridorRects、孤岛房间防死局兜底
│   ├── game.ts             改造：关卡生命周期、选关面板、通关推进
│   ├── ghost.ts            小改：setSpeed / setEnabled
│   ├── player.ts           小改：灯光开关使用关卡明暗参数
│   ├── localization.ts     增补选关/通关等中英文案
│   └── types.ts            RoomLayout 删除 features；新增 MansionOptions
├── wrangler.toml           ★Pages 配置 + KV 绑定（LEVELS_KV）
└── docs/DEPLOY.md          ★部署与 CF 控制台一次性配置指引
```

### 部署拓扑

一个 Cloudflare Pages 项目绑定游戏域名 `demon.dengjiabei.cn`：

- `/` 即游戏；`/level`（无 .html 后缀）即关卡编辑器——Cloudflare Pages 原生支持
  无后缀 HTML 路由（`/level.html` 自动 308 → `/level`），无需任何重写配置。
- 同域同源：编辑器与游戏共享同一套 Functions 与 KV，保存即生效，无 CORS。
- 本地 dev/preview 由 vite.config.ts 内置中间件做同样的 `/level` 重写，行为与生产一致。

CF 控制台一次性配置清单（写入 `docs/DEPLOY.md`）：

1. 创建 Pages 项目并绑定游戏域名。
2. `wrangler kv namespace create LEVELS_KV`，把生成的 id 填入 `wrangler.toml`（或控制台绑定，binding 名 `LEVELS_KV`）。
3. Pages 环境变量设置 `LEVEL_ADMIN_TOKEN=<管理口令>`。

## 4. 关卡 Schema 与校验

### 4.1 数据格式（与小程序完全一致）

顶层 `{ "levels": LevelConfig[] }`，每关：

```jsonc
{
  "rooms":         [{ "x": 10, "z": 10, "w": 30, "d": 30 }],  // 必填非空；房间矩形（格坐标），重叠/贴边即拼合成不规则大房间
  "corridorRects": [{ "x": 40, "z": 23, "w": 30, "d": 1 }],   // 可选；手画走廊矩形，原样挖空
  "doorCount": 1,        // 保留字段，运行时忽略并恒取 1（与小程序行为一致，保证编辑器导出兼容）
  "darkAmbient": 0.2,    // 关灯时环境光强度，必须 > 0
  "darkFogFar": 20,      // 关灯时可视距离（雾远平面），必须 ≥ 5
  "ghostSpeed": 2.6,     // 幽灵巡逻速度，0 < x ≤ 5.9（追击自动 ×1.5；玩家步行 6/疾跑 9）
  "lightsOn": false,     // 可选，缺省 false；开局房间灯是否已亮
  "ghostEnabled": true   // 可选，缺省 true；false = 无幽灵纯逃脱关
}
```

坐标约束：`x,z,w,d ≥ 1` 且 `x+w < 100`、`z+d < 100`（四周留 1 格外墙）。

### 4.2 校验分层

| 层 | 校验内容 | 失败行为 |
|---|---|---|
| 编辑器（最严） | 连通性 BFS（孤岛房间/走廊标红）、房间 ≥6×6、房间数 <6 警告、坐标范围 | 有错误禁止保存/导出 |
| API 服务端 | `parseLevelsData`（坐标范围 + 数值区间 + 结构） | 400 + 错误明细 |
| 游戏端 | 同一份 `parseLevelsData` | 整包拒绝 → 回退内置 6 关，绝不黑屏 |

游戏端与 Functions 端 **import 同一个 `src/levels.ts`**，避免两份校验逻辑漂移。`levels.ts` 保持纯逻辑（无 DOM/Three 依赖），可被 wrangler 的 esbuild 直接打包。

## 5. 数据流

### 5.1 保存（编辑器 → 云端）

```
编辑器「☁ 保存到云端」
  → 先跑本地校验（连通性等），有错弹窗拦截
  → 无口令则 prompt 输入，成功后记 localStorage['nc-admin-token']
  → PUT /api/levels  Body: {levels:[...]}  Header: Authorization: Bearer <口令>
  → Functions：验口令 → parseLevelsData 严校验 → KV.put('levels', json)
  → 200 后提示「已保存，全网生效」；401 清除记忆口令并重新弹窗；400 展示错误明细
```

### 5.2 加载（云端 → 游戏 / 编辑器）

```
游戏启动
  → GET /api/levels（Cache-Control: no-store，3 秒超时）
  → 200：parseLevelsData 通过 → 使用云端关卡
  → 404 / 超时 / 网络错误 / 校验失败：回退内置 levels_data.json（6 关），console.warn 记录原因
编辑器打开
  → 同上 GET；有云端数据则回填编辑器；无则回退 localStorage 草稿（'nc-editor-draft'）
```

注意：Cloudflare KV 为最终一致性存储，保存后本区域立即可读，全球边缘节点最长约 60 秒同步完成。此延迟对本场景可接受。

## 6. 游戏侧改造明细

### 6.1 world.ts

- `MAP_WIDTH` / `MAP_DEPTH`：80 → **100**（其余逻辑均引用常量，自动适配；小地图缓存、碰撞、A* 边界不需要单独改）。
- 签名改为 `generateMansion(roomLayout: RoomLayout[], opts?: MansionOptions)`；`regenerate` 同步。
- **走廊逻辑替换**：删除现有"按数组顺序连接相邻房间中心"的 L 形走廊；改为小程序方案——
  1. 按 `opts.corridorRects` 原样挖空（裁剪到 `[1, MAP-2]`）；
  2. 防死局兜底：与 1 号房间不连通的孤岛房间，自动沿前一房间中心补一条 L 形走廊；
  3. `walkableNodes` 只收集与 1 号房连通的主区域（防止幽灵出生/巡逻在孤立走廊）。
- 物品随机分配逻辑（门/开关/钥匙/雷达/柜子）**保持现状不动**。

### 6.2 game.ts（关卡生命周期）

- 启动序列：`initLocalization` → 并行等待「纹理加载完成」与「关卡数据加载完成（loadLevels）」→ 按存档 `level` 生成世界 → 启用开始按钮。
- 开始菜单新增**选关面板**（DOM 网格按钮）：
  - 第 n 关可点条件：`isLevelUnlocked(n, levelCleared)`（即 `n ≤ levelCleared + 1`）；
  - 未解锁灰显 + 锁图标；点击已解锁关卡 → 重建世界进入该关。
- 进入关卡时应用配置：`fog.far = darkFogFar`、`ambient = darkAmbient`、`lightsOn` 为 true 时开局即亮灯（开关置已开状态）、`ghost.setSpeed(ghostSpeed)`、`ghost.setEnabled(ghostEnabled)`。
- **通关（胜利）**：`levelCleared = max(levelCleared, level)` 存档；非末关 → 结算界面提供「进入下一关」「返回选关」；末关 → 显示「全部通关」，`levelReached` 回 1。
- **死亡**：重玩本关（不推进）。
- 现有 `restart()` 语义改为"重玩当前关"。

### 6.3 进度存档

- localStorage 两键：`levelReached`（下次默认进入关）、`levelCleared`（历史最高通过关，只增不减）。
- 读档经 `migrateProgress(reached, cleared, levelCount)` 钳制脏值（移植自小程序，纯函数零改动）。

### 6.4 ghost.ts

- `speed` 从写死 2.8 改为 `setSpeed(n)` 注入。
- 新增 `setEnabled(b)`：false 时隐藏 mesh、停止位置音效、`update()` 短路返回 false。

### 6.5 player.ts

- 灯开关交互的明暗数值不再写死（现为 0.05/12 与 0.8/100）：暗态取本关 `darkAmbient` / `darkFogFar`，亮态取全局常量 `LIT_AMBIENT` / `LIT_FOG_FAR`（与小程序一致）。
- 新增 `setEnvDark(ambient, fogFar)` 由 game.ts 在进关时注入。

### 6.6 types.ts / localization.ts / minimap.ts

- `RoomLayout` 删除 `features` 字段（当前为死代码）；新增 `MansionOptions { doorCount?, corridorRects? }`。
- localization 增补：选关标题、第 N 关、已锁定、进入下一关、返回选关、全部通关、使用内置关卡提示等（中/英）。
- minimap 无需改动（尺寸引用 world 常量）。

## 7. 编辑器（public/level.html）

以小程序 `tools/level-editor.html` 为基础复制改造（**不改动小程序原文件**）：

- **保留**：画房间/走廊、参数滑杆、多关管理、连通性校验、本地草稿（`nc-editor-draft`）、导入/导出 JSON。
- **新增**：
  - 「☁ 保存到云端」按钮：本地校验通过才发 PUT；首次弹窗输入口令并记住（`nc-admin-token`）；401 清口令重弹；400 展示服务端错误；成功提示「已保存，全网生效」。
  - 打开时自动 `GET /api/levels` 回填云端数据（失败回退本地草稿）。
- **形态**：保持自包含单文件（内联 JS/CSS），放 `public/` 目录由 Vite 原样拷贝，无需构建处理；`pnpm dev` 时可直接访问 `http://localhost:5173/level.html` 调试。

## 8. 后端 API 契约（functions/api/levels.ts）

| 方法 | 鉴权 | 请求 | 响应 |
|---|---|---|---|
| GET `/api/levels` | 无 | - | 200 `{levels:[...]}`；404 `{error:"not_found"}`（KV 尚无数据）。`Cache-Control: no-store` |
| PUT `/api/levels` | `Authorization: Bearer <LEVEL_ADMIN_TOKEN>` | `{levels:[...]}` | 200 `{ok:true,count:N}`；401 `{error:"unauthorized"}`；400 `{error:"invalid",detail:"..."}` |
| 其它方法 | - | - | 405 |

- KV：binding 名 `LEVELS_KV`，key `levels`，value 为完整 JSON 字符串。
- 服务端校验复用 `src/levels.ts` 的 `parseLevelsData`。

编辑器入口路由不走 Functions：Cloudflare Pages 原生对 HTML 资产做无后缀路由（`/level` 直接服务 `level.html`，`/level.html` 308 到 `/level`）；本地 dev/preview 由 vite.config.ts 的中间件保证一致行为。注意不要在 `_redirects` 里叠加 `/level → /level.html` 的 200 重写——会与原生机制形成 308 循环（实测踩坑）。

## 9. 本地开发与部署

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 日常游戏开发；`/api/levels` 拉不到自动回退内置关卡，不阻塞 |
| `pnpm dev:cf` | 全链路联调：`vite build` 后 `wrangler pages dev dist`（本地模拟 Functions + KV + 口令，口令经 `.dev.vars` 提供） |
| `pnpm typecheck` | tsc --noEmit（含 functions/ 目录） |
| `pnpm test` | vitest 运行纯函数单测 |
| `pnpm run deploy` | `vite build` + `wrangler pages deploy dist` |

新增 devDependencies：`wrangler`、`vitest`、`@cloudflare/workers-types`（供 functions/ 通过 typecheck）。`.dev.vars`（含本地口令）加入 `.gitignore`。

## 10. 错误处理矩阵

| 场景 | 行为 |
|---|---|
| 云端拉取超时（>3s）/ 网络错误 / 404 | 回退内置 6 关，console.warn 原因，游戏正常进行 |
| 云端数据结构非法 | `parseLevelsData` 整包拒绝 → 回退内置 |
| PUT 口令错误 | 401 → 编辑器清除记忆口令并重新弹窗 |
| PUT 数据非法 | 400 → 编辑器弹窗展示 detail |
| 进度存档脏数据 | `migrateProgress` 钳回合法区间 |
| 选关越界（关卡数变少后旧存档指向不存在关卡） | `getLevelConfig` 钳到 `[1, LEVEL_COUNT]`；`migrateProgress` 同步钳制 |

## 11. 测试与验收标准

**自动化**：
- `pnpm typecheck` 全绿（含 functions/）。
- vitest 单测覆盖 `levels.ts`（合法/非法样例、缺省字段语义 `lightsOn===true`、`ghostEnabled!==false`、越界坐标拒绝）与 `progress.ts`（迁移钳制、解锁边界）。

**实机验收（浏览器驱动逐项确认）**：
1. `pnpm dev`：内置 6 关可选关进入；未解锁关灰显不可点；通关后解锁下一关且进度刷新后仍在。
2. 第 1 关（100×100 单大房间）渲染、碰撞、小地图、幽灵寻路正常。
3. `ghostEnabled:false` 关卡无幽灵且不报错；`lightsOn:true` 关卡开局即亮。
4. `pnpm dev:cf`：编辑器画一关 → 保存（口令流程）→ 刷新游戏页加载到新关卡；错误口令 401 流程正确。
5. 编辑器孤岛房间被拦截无法保存。

## 12. 范围外（本期不做）

- 物品（门/钥匙/雷达/开关/柜子）位置编辑——沿用每局随机分配（与小程序一致）。
- 真正的多门支持（`doorCount` 恒 1）。
- 关卡分享链接、关卡名称/作者等元数据字段。
- 账号系统、多人编辑、编辑历史/回滚（KV 只存最新一版）。
- 小程序仓库的任何改动。

## 13. 变更记录

- 2026-07-13（初版获批实施完成后调整）：编辑器入口由独立域名 `demon-level.dengjiabei.cn` 改为主站路径 `https://demon.dengjiabei.cn/level`（无 .html 后缀）。实现由 `functions/_middleware.ts` Host 分流改为 Vite dev/preview 中间件 + Pages 原生无后缀路由；只需绑定一个域名。本文档相关小节已同步更新。
- 2026-07-13（首次部署实测修正）：曾用 `public/_redirects` 做 `/level → /level.html` 200 重写，实测与 Pages 原生 pretty URL 机制冲突产生 308 自我重定向循环，已删除；线上完全依赖原生路由。另确认既有 `demon` Pages 项目生产分支为 `main`，`pnpm run deploy` 已固化 `--branch=main`。
