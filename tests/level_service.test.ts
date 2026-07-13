import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_LEVELS } from '../src/levels'
import { loadLevels } from '../src/level_service'

const remoteData = {
  levels: [
    {
      rooms: [{ x: 20, z: 20, w: 40, d: 40 }],
      doorCount: 1,
      darkAmbient: 0.15,
      darkFogFar: 18,
      ghostSpeed: 3,
      lightsOn: true,
      ghostEnabled: false,
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadLevels', () => {
  it('云端 200 且数据合法 → source=remote', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(remoteData))))
    const out = await loadLevels()
    expect(out.source).toBe('remote')
    expect(out.levels).toHaveLength(1)
    expect(out.levels[0].lightsOn).toBe(true)
    expect(out.levels[0].ghostEnabled).toBe(false)
  })

  it('云端 404 → 回退内置', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_found"}', { status: 404 })))
    const out = await loadLevels()
    expect(out.source).toBe('builtin')
    expect(out.levels).toBe(BUILTIN_LEVELS)
  })

  it('云端 200 但数据非法 → 回退内置', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"levels":[{"rooms":[]}]}')))
    const out = await loadLevels()
    expect(out.source).toBe('builtin')
  })

  it('网络异常 → 回退内置且不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down')
    }))
    const out = await loadLevels()
    expect(out.source).toBe('builtin')
  })

  it('超时 → 回退内置', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
    ))
    const out = await loadLevels(50)
    expect(out.source).toBe('builtin')
  })
})
