import { defineConfig, type Connect, type Plugin } from 'vite'

/**
 * 让 dev/preview 服务器同样支持无后缀的 /level 路径——
 * 生产环境由 public/_redirects 的 200 重写规则负责，两端行为保持一致。
 */
function levelRouteRewrite(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url) {
      const [path, query] = req.url.split('?')
      if (path === '/level' || path === '/level/') {
        req.url = '/level.html' + (query ? `?${query}` : '')
      }
    }
    next()
  }
  return {
    name: 'level-route-rewrite',
    configureServer(server) {
      server.middlewares.use(rewrite)
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite)
    }
  }
}

/**
 * 本地 dev/preview 没有 Cloudflare Functions，/api 直接代理到线上——
 * 编辑器进门口令校验、云端关卡加载/保存在本地与线上行为完全一致。
 * 注意：本地「保存到云端」写的就是线上生产数据（与打开线上编辑器等效）。
 */
const apiProxy = {
  '/api': {
    target: 'https://demon.dengjiabei.cn',
    changeOrigin: true
  }
}

export default defineConfig({
  plugins: [levelRouteRewrite()],
  server: {
    proxy: apiProxy
  },
  preview: {
    proxy: apiProxy
  },
  build: {
    target: 'esnext'
  }
})
