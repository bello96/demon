import { describe, expect, it } from 'vitest'
import {
  BUILTIN_LEVELS,
  getLevelConfig,
  parseLevelsData,
  parseThemePresets,
  sanitizeTheme,
} from '../src/levels'

// 一个各字段全部合法的最小单关样例，逐用例在它基础上改坏一处
const validLevel = {
  rooms: [{ x: 10, z: 10, w: 30, d: 30 }],
  doorCount: 1,
  darkAmbient: 0.2,
  darkFogFar: 20,
  ghostSpeed: 2.6,
  lightsOn: false,
  ghostEnabled: true,
}

describe('parseLevelsData', () => {
  it('合法数据解析成功，字段原样保留', () => {
    const out = parseLevelsData({ levels: [validLevel] })
    expect(out).not.toBeNull()
    expect(out!).toHaveLength(1)
    expect(out![0].rooms).toEqual([{ x: 10, z: 10, w: 30, d: 30 }])
    expect(out![0].ghostSpeed).toBe(2.6)
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
})

describe('parseThemePresets 方案库校验', () => {
  const surfaces = { roomFloor: { type: 'color', value: '#aabbcc' } }

  it('合法条目保留，名称去空白截 12 字', () => {
    const out = parseThemePresets([{ name: '  白色病院超长名字超过十二个字了  ', surfaces }])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('白色病院超长名字超过十二')
    expect(out[0].surfaces).toEqual(surfaces)
  })

  it('非法条目（缺名 / surfaces 全非法 / 非对象）静默丢弃', () => {
    const out = parseThemePresets([
      null,
      { surfaces },
      { name: 'ok', surfaces: { roomFloor: { type: 'color', value: 'bad' } } },
      { name: 'good', surfaces },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('good')
  })

  it('非数组 → 空数组；超过 24 套截断', () => {
    expect(parseThemePresets(undefined)).toEqual([])
    expect(parseThemePresets('x')).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `t${i}`, surfaces }))
    expect(parseThemePresets(many)).toHaveLength(24)
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
