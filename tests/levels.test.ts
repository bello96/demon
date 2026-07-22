import { describe, expect, it } from 'vitest'
import {
  BUILTIN_LEVELS,
  getLevelConfig,
  parseLevelsData,
  parseUnlockProgression,
  sanitizeTheme,
} from '../src/levels'

// 一个各字段全部合法的最小单关样例，逐用例在它基础上改坏一处
const validLevel = {
  rooms: [{ x: 10, z: 10, w: 30, d: 30 }],
  doorCount: 1,
  darkAmbient: 0.2,
  darkFogFar: 20,
  ghostSpeed: 2.5,
  lightsOn: false,
  ghostEnabled: true,
}

describe('parseLevelsData', () => {
  it('合法数据解析成功，字段原样保留', () => {
    const out = parseLevelsData({ levels: [validLevel] })
    expect(out).not.toBeNull()
    expect(out!).toHaveLength(1)
    expect(out![0].rooms).toEqual([{ x: 10, z: 10, w: 30, d: 30 }])
    expect(out![0].ghostSpeed).toBe(2.5)
  })

  it('doorCount 恒为 1（JSON 里写多少都忽略）', () => {
    const out = parseLevelsData({ levels: [{ ...validLevel, doorCount: 3 }] })
    expect(out![0].doorCount).toBe(1)
  })

  it('lightsOn 缺省 false、ghostEnabled 缺省 true', () => {
    const { lightsOn: _a, ghostEnabled: _b, ...rest } = validLevel
    const out = parseLevelsData({ levels: [rest] })
    expect(out![0].lightsOn).toBe(false)
    expect(out![0].ghostEnabled).toBe(true)
  })

  it('corridorRects 可选，给了就校验坐标', () => {
    const ok = parseLevelsData({
      levels: [{ ...validLevel, corridorRects: [{ x: 40, z: 23, w: 30, d: 1 }] }],
    })
    expect(ok![0].corridorRects).toEqual([{ x: 40, z: 23, w: 30, d: 1 }])
    const bad = parseLevelsData({
      levels: [{ ...validLevel, corridorRects: [{ x: 0, z: 23, w: 30, d: 1 }] }],
    })
    expect(bad).toBeNull()
  })

  it.each([
    ['rooms 为空', { ...validLevel, rooms: [] }],
    ['房间越界 x+w>=100', { ...validLevel, rooms: [{ x: 20, z: 10, w: 80, d: 30 }] }],
    ['darkAmbient<=0', { ...validLevel, darkAmbient: 0 }],
    ['darkFogFar<5', { ...validLevel, darkFogFar: 4 }],
    ['ghostSpeed>6', { ...validLevel, ghostSpeed: 6.1 }],
    ['ghostSpeed<=0', { ...validLevel, ghostSpeed: 0 }],
    ['lightsOn 非布尔', { ...validLevel, lightsOn: 1 }],
    ['ghostEnabled 非布尔', { ...validLevel, ghostEnabled: 'yes' }],
    ['minimapEnabled 非布尔', { ...validLevel, minimapEnabled: 'no' }],
    ['frozen 非布尔', { ...validLevel, frozen: 1 }],
  ])('%s → 整包拒绝返回 null', (_name, lv) => {
    expect(parseLevelsData({ levels: [lv] })).toBeNull()
  })

  it('ghostSpeed 吸附到 0.5 步进并钳到 [2,6]（速度规格：巡逻 2~6、最小变动 0.5）', () => {
    const snap = (v: number): number =>
      parseLevelsData({ levels: [{ ...validLevel, ghostSpeed: v }] })![0].ghostSpeed
    // 旧编辑器 0.05 步进的历史产物宽容归位（不拒包）
    expect(snap(3.75)).toBe(4)
    expect(snap(4.2)).toBe(4)
    expect(snap(4.7)).toBe(4.5)
    expect(snap(2.6)).toBe(2.5)
    // 低于下限吸到 2（结构合法不拒包）；合规值原样保留
    expect(snap(1.5)).toBe(2)
    expect(snap(2.5)).toBe(2.5)
    expect(snap(6)).toBe(6)
  })

  it('顶层结构非法 → null', () => {
    expect(parseLevelsData(null)).toBeNull()
    expect(parseLevelsData({})).toBeNull()
    expect(parseLevelsData({ levels: [] })).toBeNull()
  })

  it('frozen 缺省 false、写 true 保留', () => {
    const out = parseLevelsData({ levels: [validLevel, { ...validLevel, frozen: true }] })
    expect(out![0].frozen).toBe(false)
    expect(out![1].frozen).toBe(true)
  })

  it('id 合法透传；非法 / 非字符串 / 重复只丢弃 id 本身，不拒包', () => {
    const out = parseLevelsData({
      levels: [
        { ...validLevel, id: 'lv_abc-123' },
        { ...validLevel, id: '带空格 非法!' },
        { ...validLevel, id: 'lv_abc-123' },
        { ...validLevel, id: 42 },
        { ...validLevel, id: 'x'.repeat(33) },
        { ...validLevel },
      ],
    })
    expect(out).not.toBeNull()
    expect(out!).toHaveLength(6)
    expect(out![0].id).toBe('lv_abc-123')
    expect(out![1].id).toBeUndefined()
    expect(out![2].id).toBeUndefined()
    expect(out![3].id).toBeUndefined()
    expect(out![4].id).toBeUndefined()
    expect(out![5].id).toBeUndefined()
  })

  it('id 边界：32 字符恰好合法、空串非法', () => {
    const id32 = 'a'.repeat(32)
    const out = parseLevelsData({
      levels: [{ ...validLevel, id: id32 }, { ...validLevel, id: '' }],
    })
    expect(out![0].id).toBe(id32)
    expect(out![1].id).toBeUndefined()
  })

  it('minimapEnabled 缺省 true、写 false 保留', () => {
    const out = parseLevelsData({
      levels: [validLevel, { ...validLevel, minimapEnabled: false }],
    })
    expect(out![0].minimapEnabled).toBe(true)
    expect(out![1].minimapEnabled).toBe(false)
  })

  it('全部关卡都冻结 → 整包拒绝返回 null', () => {
    expect(parseLevelsData({ levels: [{ ...validLevel, frozen: true }] })).toBeNull()
    expect(
      parseLevelsData({
        levels: [
          { ...validLevel, frozen: true },
          { ...validLevel, frozen: true },
        ],
      }),
    ).toBeNull()
  })

  it('数组元素为 null → 返回 null 而不是抛异常', () => {
    expect(parseLevelsData({ levels: [null] })).toBeNull()
    expect(parseLevelsData({ levels: [{ ...validLevel, rooms: [null] }] })).toBeNull()
    expect(parseLevelsData({ levels: [{ ...validLevel, corridorRects: [null] }] })).toBeNull()
  })
})

describe('theme 主题校验（宽松：非法面丢弃，不拒整包）', () => {
  it('合法 color / preset 面原样保留（color 统一小写）', () => {
    const out = parseLevelsData({
      levels: [
        {
          ...validLevel,
          theme: {
            roomFloor: { type: 'color', value: '#D8D8D2' },
            corridorWall: { type: 'preset', value: 'stone' },
          },
        },
      ],
    })
    expect(out![0].theme).toEqual({
      roomFloor: { type: 'color', value: '#d8d8d2' },
      corridorWall: { type: 'preset', value: 'stone' },
    })
  })

  it('非法面丢弃、合法面保留，关卡本身不被拒', () => {
    const out = parseLevelsData({
      levels: [
        {
          ...validLevel,
          theme: {
            roomFloor: { type: 'color', value: 'red' },
            roomWall: { type: 'preset', value: 'not-exist' },
            ceiling: { type: 'color', value: '#112233' },
            corridorFloor: { type: 'image', value: 'data:...' },
          },
        },
      ],
    })
    expect(out).not.toBeNull()
    expect(out![0].theme).toEqual({ ceiling: { type: 'color', value: '#112233' } })
  })

  it('theme 非对象 / 全部面非法 → undefined（等同未配置）', () => {
    expect(sanitizeTheme('x')).toBeUndefined()
    expect(sanitizeTheme(null)).toBeUndefined()
    expect(sanitizeTheme({ roomFloor: { type: 'color', value: '#12' } })).toBeUndefined()
    const out = parseLevelsData({ levels: [{ ...validLevel, theme: 42 }] })
    expect(out![0].theme).toBeUndefined()
  })

  it('image 面：合法 data:image base64 保留；坏前缀 / 超长丢弃', () => {
    const okUrl = 'data:image/png;base64,' + 'A'.repeat(1000)
    const out = parseLevelsData({
      levels: [
        {
          ...validLevel,
          theme: {
            roomFloor: { type: 'image', value: okUrl },
            roomWall: { type: 'image', value: 'data:text/html;base64,PGI+' },
            ceiling: { type: 'image', value: 'data:image/png;base64,' + 'A'.repeat(800_000) },
          },
        },
      ],
    })
    expect(out).not.toBeNull()
    expect(out![0].theme).toEqual({ roomFloor: { type: 'image', value: okUrl } })
  })

  it('image 边界：总长恰好 720000 合法、720001 丢弃', () => {
    const head = 'data:image/png;base64,'
    const atLimit = head + 'A'.repeat(720_000 - head.length)
    const overLimit = head + 'A'.repeat(720_001 - head.length)
    const out = parseLevelsData({
      levels: [
        {
          ...validLevel,
          theme: {
            roomFloor: { type: 'image', value: atLimit },
            ceiling: { type: 'image', value: overLimit },
          },
        },
      ],
    })
    expect(out![0].theme).toEqual({ roomFloor: { type: 'image', value: atLimit } })
  })
})

describe('BUILTIN_LEVELS / getLevelConfig', () => {
  it('内置 levels_data.json 是合法的 6 关', () => {
    expect(BUILTIN_LEVELS).toHaveLength(6)
  })

  it('getLevelConfig 越界钳制到 [1, N]', () => {
    expect(getLevelConfig(BUILTIN_LEVELS, 0)).toBe(BUILTIN_LEVELS[0])
    expect(getLevelConfig(BUILTIN_LEVELS, 999)).toBe(BUILTIN_LEVELS[5])
    expect(getLevelConfig(BUILTIN_LEVELS, 3)).toBe(BUILTIN_LEVELS[2])
  })
})

describe('parseUnlockProgression', () => {
  it('缺省字段 → true（默认逐关解锁）', () => {
    expect(parseUnlockProgression({ levels: [validLevel] })).toBe(true)
  })

  it('显式 false → false（全部关卡开放）', () => {
    expect(parseUnlockProgression({ levels: [validLevel], unlockProgression: false })).toBe(false)
  })

  it('显式 true → true', () => {
    expect(parseUnlockProgression({ unlockProgression: true })).toBe(true)
  })

  it('非布尔脏值 → true（宽松回退，绝不因它改变默认行为）', () => {
    expect(parseUnlockProgression({ unlockProgression: 'no' })).toBe(true)
    expect(parseUnlockProgression({ unlockProgression: 0 })).toBe(true)
    expect(parseUnlockProgression({ unlockProgression: null })).toBe(true)
  })

  it('非对象入参 → true（null / 原始值兜底不抛错）', () => {
    expect(parseUnlockProgression(null)).toBe(true)
    expect(parseUnlockProgression(undefined)).toBe(true)
    expect(parseUnlockProgression(42)).toBe(true)
  })
})
