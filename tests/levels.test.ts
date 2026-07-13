import { describe, expect, it } from 'vitest'
import { BUILTIN_LEVELS, getLevelConfig, parseLevelsData } from '../src/levels'

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
    ['ghostSpeed>5.9', { ...validLevel, ghostSpeed: 6 }],
    ['ghostSpeed<=0', { ...validLevel, ghostSpeed: 0 }],
    ['lightsOn 非布尔', { ...validLevel, lightsOn: 1 }],
    ['ghostEnabled 非布尔', { ...validLevel, ghostEnabled: 'yes' }],
  ])('%s → 整包拒绝返回 null', (_name, lv) => {
    expect(parseLevelsData({ levels: [lv] })).toBeNull()
  })

  it('顶层结构非法 → null', () => {
    expect(parseLevelsData(null)).toBeNull()
    expect(parseLevelsData({})).toBeNull()
    expect(parseLevelsData({ levels: [] })).toBeNull()
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
