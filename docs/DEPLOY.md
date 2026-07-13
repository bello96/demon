# 部署指引（Cloudflare Pages + KV）

## 一次性配置

1. **创建 KV 命名空间**：
   `npx wrangler kv namespace create LEVELS_KV`
   把输出的 id 填入 `wrangler.toml` 的 `kv_namespaces[0].id`。
2. **首次部署**：`pnpm run deploy`（= vite build + wrangler pages deploy dist，
   项目名取 wrangler.toml 的 `name = "demon"`）。
3. **控制台配置**（Cloudflare Dashboard → Pages → demon）：
   - Custom domains 绑定游戏域名 `demon.dengjiabei.cn`
     （关卡编辑器就在主站路径 `/level`（无 .html 后缀）——Cloudflare Pages
     原生支持无后缀 HTML 路由，`/level.html` 会自动 308 到 `/level`，
     无需任何重写配置，也无需绑定额外域名）。
   - ⚠️ 生产分支是 `main`：手动部署必须带 `--branch=main` 才会发布到正式域名
     （`pnpm run deploy` 已内置该参数），否则会成为预览版。
   - Settings → Environment variables 添加 `LEVEL_ADMIN_TOKEN=<管理口令>`
     （Production 环境；改完需重新部署一次生效）。

## 日常发布

代码更新：`pnpm typecheck && pnpm test && pnpm run deploy`
关卡更新：无需发版——打开 `https://demon.dengjiabei.cn/level`
画好后点击「☁ 保存到云端」即可（KV 全球同步最长约 1 分钟）。

## 本地联调

```bash
cp .dev.vars.example .dev.vars   # 本地口令默认 dev-token
pnpm dev:cf                      # http://localhost:8788（游戏 / /level 编辑器 / /api）
```

日常改游戏逻辑用 `pnpm dev` 即可（无 API 时自动回退内置关卡）；
dev / preview / 线上均支持无后缀的 `/level` 路径直达编辑器
（本地由 vite.config.ts 内置中间件重写，线上是 Pages 原生行为）。

> ⚠️ Windows 本地跑 `pnpm dev:cf` 依赖 workerd 原生二进制，要求
> Microsoft Visual C++ 2015-2022 Redistributable (x64) ≥ 14.40。
> 若启动时崩溃（0xc0000005），请到微软官网下载最新 vc_redist.x64.exe
> 安装后重试。此问题不影响 Cloudflare 云端部署与线上运行。

## 部署后验证清单

1. `curl -s https://<游戏域名>/api/levels` → 404（尚未保存过）或 200 JSON
2. 打开 `https://demon.dengjiabei.cn/level` → 应直接呈现关卡编辑器（地址栏无 .html）
3. 编辑器保存一版关卡（输入 LEVEL_ADMIN_TOKEN 口令）→ 提示已保存
4. 刷新游戏域名 → 控制台无"使用内置关卡"警告，选关面板显示云端关卡数
5. 错误口令保存 → 编辑器提示 401 并重新弹窗
