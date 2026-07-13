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

export default defineConfig({
  plugins: [levelRouteRewrite()],
  build: {
    target: 'esnext'
  }
})
