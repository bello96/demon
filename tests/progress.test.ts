import { describe, expect, it } from 'vitest'
import { isLevelUnlocked, migrateProgress } from '../src/progress'

describe('migrateProgress', () => {
  it('新玩家（两键都是 NaN）→ 第 1 关、已通 0 关', () => {
    expect(migrateProgress(NaN, NaN, 6)).toEqual({ level: 1, cleared: 0 })
  })

  it('正常档：reached=3 cleared=2 → 原样', () => {
    expect(migrateProgress(3, 2, 6)).toEqual({ level: 3, cleared: 2 })
  })

  it('旧档只有 reached：按已通 reached-1 关推导', () => {
    expect(migrateProgress(4, NaN, 6)).toEqual({ level: 4, cleared: 3 })
  })

  it('矛盾档以 cleared 为准：reached=5 cleared=1 → level 钳到 2', () => {
    expect(migrateProgress(5, 1, 6)).toEqual({ level: 2, cleared: 1 })
  })

  it('关卡数变少：reached=9 cleared=9 levelCount=6 → 全部钳到 6', () => {
    expect(migrateProgress(9, 9, 6)).toEqual({ level: 6, cleared: 6 })
  })

  it('脏值（负数/小数）钳制', () => {
    expect(migrateProgress(-3, -1, 6)).toEqual({ level: 1, cleared: 0 })
    expect(migrateProgress(2.9, 1.9, 6)).toEqual({ level: 2, cleared: 1 })
  })
})

describe('isLevelUnlocked', () => {
  it('已通 2 关：1/2/3 可进，4 不可进，0 不可进', () => {
    expect(isLevelUnlocked(1, 2)).toBe(true)
    expect(isLevelUnlocked(2, 2)).toBe(true)
    expect(isLevelUnlocked(3, 2)).toBe(true)
    expect(isLevelUnlocked(4, 2)).toBe(false)
    expect(isLevelUnlocked(0, 2)).toBe(false)
  })

  it('默认 progression 省略即逐关解锁（向后兼容两参调用）', () => {
    expect(isLevelUnlocked(3, 2, true)).toBe(true)
    expect(isLevelUnlocked(4, 2, true)).toBe(false)
  })

  it('全局开关关闭（progression=false）：任意正数关卡都开放，与已通关数无关', () => {
    expect(isLevelUnlocked(1, 0, false)).toBe(true)
    expect(isLevelUnlocked(6, 0, false)).toBe(true)
    expect(isLevelUnlocked(99, 0, false)).toBe(true)
  })

  it('全局开关关闭也不放行非法关号（n<1）', () => {
    expect(isLevelUnlocked(0, 5, false)).toBe(false)
    expect(isLevelUnlocked(-1, 5, false)).toBe(false)
  })
})
