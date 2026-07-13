# 方块噩梦 (Blocky Horror)

一款基于 **Three.js + TypeScript** 的第一人称恐怖迷宫逃脱游戏。你在一座程序生成的豪宅中寻找钥匙并从大门逃脱，同时躲避会沿 A\* 路径追击你的幽灵。

![tech](https://img.shields.io/badge/Three.js-0.168-blue) ![tech](https://img.shields.io/badge/Vite-6-purple) ![tech](https://img.shields.io/badge/TypeScript-5.7-informational)

---

## ✨ 游戏特性

- 🏚️ **关卡驱动的豪宅生成** —— 房间矩形与手绘走廊由关卡配置决定（1~N 个房间，云端可改），孤岛房间自动补 L 形走廊防死局
- 🧱 **分区墙体材质** —— 房间墙 / 走廊墙 / 转角墙三套材质，拐角处多材质 BoxGeometry 实现视觉切换
- 👻 **幽灵 AI** —— `patrol ↔ chase` 状态机，Bresenham 栅格视线 + A\* 二叉小堆寻路
- 🔦 **手电筒系统** —— SpotLight 光锥，可切换开关，小地图上以扇形显示
- 🗝️ **交互系统** —— 钥匙、雷达、灯光开关、橱柜躲藏、出口门
- 🗺️ **实时小地图** —— 可切换小/大尺寸，带雷达后可见幽灵位置
- 💓 **动态心跳** —— 按距离实时调整音量与频率
- 🎵 **程序化音效** —— 全部用 Web Audio API 合成，零音频资源
- 🌐 **中/英自动切换** —— 根据 `navigator.language` 自动选择
- ⚡ **零重载重开** —— 死亡/胜利后内存级重建地图，不刷新页面
- 🗺️ **云端可配置关卡** —— 选关菜单 + 顺序解锁，编辑器保存即全网生效

---

## 🎮 操作

| 按键         | 功能                       |
| ------------ | -------------------------- |
| **WASD**     | 移动                       |
| **Space**    | 跳跃                       |
| **Shift**    | 奔跑                       |
| **E**        | 交互 / 进入或退出橱柜      |
| **F**        | 切换手电筒                 |
| **M**        | 切换小地图大小             |
| **鼠标移动** | 观察（灵敏度可在菜单调整） |
| **Esc**      | 暂停 / 弹出菜单            |

## 🎯 目标

1. 在豪宅中找到 **逃脱门钥匙**（金色方块）
2. 到达 **出口门** 安全逃脱
3. 全程躲避幽灵——被触碰即死亡

## 💡 玩法提示

- 灯光开关会切换环境光强度与雾距，影响视野
- 橱柜可以躲藏；幽灵会在玩家进入隐藏后放弃追击
- 拾取雷达装置后，小地图上会显示幽灵位置

---

## 🛠️ 技术栈

| 层     | 选择                                   |
| ------ | -------------------------------------- |
| 渲染   | [Three.js](https://threejs.org/) 0.168 |
| 构建   | [Vite](https://vitejs.dev/) 6          |
| 语言   | TypeScript 5.7（strict 模式）          |
| 包管理 | pnpm                                   |
| 音频   | Web Audio API（程序化合成）            |
| 部署   | Cloudflare Pages（`wrangler`）         |

---

## 🚀 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务器（默认 http://localhost:5173）
pnpm dev

# 本地联调 Cloudflare Functions + KV（关卡云端 API + 编辑器，默认 http://localhost:8788）
pnpm dev:cf

# 构建生产版本到 dist/
pnpm build

# 预览生产构建
pnpm preview

# 类型检查（无产物输出，含 functions/ 子项目）
pnpm typecheck

# 运行单元测试（关卡 Schema / 进度 / 云端加载）
pnpm test

# 构建并部署到 Cloudflare Pages
pnpm deploy
```

> 使用 `npm` / `yarn` 亦可，把 `pnpm` 替换即可。

---

## 📁 项目结构

```
horror-maze-adventure/
├── index.html                # 入口 HTML + 所有 UI 层 + 内联样式
├── vite.config.ts
├── tsconfig.json
├── package.json
├── CLAUDE.md                 # AI / 新人协作指引
├── public/
│   └── level.html            # 关卡编辑器页（自包含单文件，云端加载/保存）
├── functions/                 # Cloudflare Pages Functions（部署时自动生效）
│   ├── _middleware.ts         # 编辑器域名根路径分流到 /level.html
│   └── api/levels.ts          # GET 公开读关卡 / PUT 口令写入 KV
└── src/
    ├── game.ts               # 主循环、场景组装、UI 事件、关卡生命周期
    ├── player.ts             # 玩家控制、相机、碰撞、手电筒
    ├── ghost.ts              # 幽灵 AI、A* 寻路、视线判定
    ├── world.ts              # 程序化地图生成 + 栅格碰撞
    ├── minimap.ts            # 2D 小地图渲染
    ├── sound_generator.ts    # 程序化音效
    ├── localization.ts       # 中/英词典
    ├── utils.ts              # 共享材质（像素化 Canvas 纹理 + 图片纹理）
    ├── types.ts              # 共享接口
    ├── levels.ts              # 关卡 Schema + 校验（游戏端与 Functions 端共用）
    ├── levels_data.json       # 内置兜底 6 关数据
    ├── progress.ts            # 关卡进度纯函数（迁移钳制 + 解锁判定）
    ├── level_service.ts       # 云端关卡拉取（超时/失败回退内置）
    └── static/                # 墙/地面贴图
```

---

## 🏗️ 核心架构

### 地图生成管线（`World.generateMansion`）

1. `100×100` 栅格全部置为墙（与小程序版关卡坐标系对齐）
2. 按当前关卡配置的 `rooms[]` 挖出房间（数量由关卡决定）
3. 按关卡配置的 `corridorRects[]` 挖出手绘走廊；与 1 号房不连通的孤岛房间自动补 L 形直廊兜底
4. 把每面墙分类为 **房间墙 / 走廊墙 / 转角墙**
5. 房间墙 / 走廊墙用 `InstancedMesh` 批量渲染
6. 转角墙用多材质 `BoxGeometry`，每面朝向不同区域时贴不同贴图
7. 房间轮转分配（不足时同房复用）**门 / 开关 / 钥匙 / 雷达 / 橱柜**
8. 门和开关必须"贴墙"，生成前会校验相邻格为墙体

### 幽灵 AI（`Ghost.update`）

```
patrol ─── 看到玩家 ──→ chase
   ↑                     │
   └── 玩家躲藏/追丢 ─────┘
```

- **视线**：Bresenham 栅格遍历，O(距离) 零分配
- **寻路**：A\* + 二叉小堆，500 ms 重规划一次
- **失败安全**：追击无法推进超过 30 秒，自动放弃转巡逻

### 碰撞模型

- 墙 / 地板 / 天花板：直接查栅格，邻 3×3 范围 AABB 检测
- 家具：`Set<string>("x,y,z")` 线性扫描（小集合即可）

---

## 🌐 本地化

游戏根据浏览器语言自动选择中/英两套文案：

- `zh-*` → 中文
- 其他 → 英文

词典位于 `src/localization.ts`，添加新语言只需扩展 `translations` 映射。

---

## ☁️ 部署（Cloudflare Pages）

项目已内置 `pnpm deploy` 脚本（= `vite build` + `wrangler pages deploy dist`，
`wrangler` 已是 devDependency，无需额外安装）：

```bash
pnpm deploy
```

关卡系统还依赖 KV 命名空间绑定、`LEVEL_ADMIN_TOKEN` 环境变量、编辑器域名的 Pages
Functions 分流等一次性配置，完整步骤、日常发布流程与部署后验证清单见
[docs/DEPLOY.md](./docs/DEPLOY.md)。

## 🤖 协作指引

若你使用 Claude Code / Cursor / 其他 AI Agent 协作开发，请先阅读 [CLAUDE.md](./CLAUDE.md)——其中列出了架构要点、已知坑位和代码约定。

---

## 📜 许可证

MIT
