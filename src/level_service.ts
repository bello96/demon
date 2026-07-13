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
        // 冻结关不参与游戏：过滤后后续关卡顺位前移（parse 已保证至少剩 1 关）
        return { levels: parsed.filter((l) => !l.frozen), source: 'remote' }
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
