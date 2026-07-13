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

/** 校验请求头里的管理口令；未配置环境变量时一律拒绝，避免"忘配 = 裸奔" */
function isAuthorized(ctx: EventContext<Env, string, unknown>): boolean {
  const token = ctx.env.LEVEL_ADMIN_TOKEN
  const auth = ctx.request.headers.get('Authorization') ?? ''
  return Boolean(token) && auth === `Bearer ${token}`
}

/** POST = 口令预校验（编辑器进门用）：只验 Authorization，不读不写任何数据 */
function handleVerify(ctx: EventContext<Env, string, unknown>): Response {
  if (!isAuthorized(ctx)) {
    return json({ error: 'unauthorized' }, 401)
  }
  return json({ ok: true }, 200)
}

async function handlePut(ctx: EventContext<Env, string, unknown>): Promise<Response> {
  if (!isAuthorized(ctx)) {
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
    case 'POST':
      return handleVerify(ctx)
    case 'PUT':
      return handlePut(ctx)
    default:
      return json({ error: 'method_not_allowed' }, 405)
  }
}
