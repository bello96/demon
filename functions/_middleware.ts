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
