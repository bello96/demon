import { describe, expect, it } from 'vitest'
import {
  STAMINA_DRAIN_SECONDS,
  STAMINA_REGEN_SECONDS,
  canSprint,
  tickStamina,
} from '../src/stamina'

/** 按固定步长把 tickStamina 跑满 seconds 秒（模拟帧循环逐帧积分） */
function simulate(
  start: number,
  seconds: number,
  sprintHeld: boolean,
  moving: boolean,
  fps = 60,
): number {
  let s = start
  const dt = 1 / fps
  for (let i = 0; i < seconds * fps; i++) {
    s = tickStamina(s, dt, sprintHeld, moving)
  }
  return s
}

describe('tickStamina 消耗（Shift + 移动）', () => {
  it('满体力疾跑 1 秒消耗 1/10', () => {
    expect(tickStamina(1, 1, true, true)).toBeCloseTo(1 - 1 / STAMINA_DRAIN_SECONDS, 10)
  })

  it('持续疾跑 10 秒恰好耗尽（60fps 逐帧积分）', () => {
    expect(simulate(1, STAMINA_DRAIN_SECONDS, true, true)).toBeCloseTo(0, 6)
  })

  it('剩余不足一帧消耗量时钳到 0，不出现负值', () => {
    expect(tickStamina(0.05, 1, true, true)).toBe(0)
  })

  it('体力已为 0 时继续按住 Shift 移动，保持 0', () => {
    expect(tickStamina(0, 1, true, true)).toBe(0)
  })
})

describe('tickStamina 冻结（Shift 按住但未移动）', () => {
  it('站立按住 Shift：不消耗也不恢复', () => {
    expect(tickStamina(0.5, 5, true, false)).toBe(0.5)
  })

  it('体力 0 时站立按住 Shift：仍为 0（按住期间永不恢复）', () => {
    expect(tickStamina(0, 5, true, false)).toBe(0)
  })
})

describe('tickStamina 恢复（松开 Shift）', () => {
  it('速率规格：疾跑 10 秒耗尽、松开 60 秒（1 分钟）回满', () => {
    expect(STAMINA_DRAIN_SECONDS).toBe(10)
    expect(STAMINA_REGEN_SECONDS).toBe(60)
  })

  it('松开 Shift 恢复 1 秒增加 1/60', () => {
    expect(tickStamina(0, 1, false, false)).toBeCloseTo(1 / STAMINA_REGEN_SECONDS, 10)
  })

  it('移动中只要松开 Shift 同样恢复', () => {
    expect(tickStamina(0, 1, false, true)).toBeCloseTo(1 / STAMINA_REGEN_SECONDS, 10)
  })

  it('从 0 恢复 60 秒恰好回满（60fps 逐帧积分）', () => {
    expect(simulate(0, STAMINA_REGEN_SECONDS, false, false)).toBeCloseTo(1, 6)
  })

  it('接近满值时封顶到 1，不超出', () => {
    expect(tickStamina(0.99, 3, false, false)).toBe(1)
  })

  it('已满时不再增加', () => {
    expect(tickStamina(1, 5, false, false)).toBe(1)
  })
})

describe('消耗/恢复速率关系（水池收支）', () => {
  it('跑 1 秒（-1/10）后歇 6 秒（+1/10）收支平衡，多轮往复不漂移', () => {
    // 从 0.5 出发全程不触及 0/1 边界，避免钳制掩盖速率误差
    let s = 0.5
    for (let round = 0; round < 5; round++) {
      s = simulate(s, 1, true, true)
      s = simulate(s, 6, false, false)
    }
    expect(s).toBeCloseTo(0.5, 6)
  })
})

describe('canSprint 疾跑门控', () => {
  it('按住 Shift 且有体力 → 可疾跑', () => {
    expect(canSprint(0.01, true)).toBe(true)
    expect(canSprint(1, true)).toBe(true)
  })

  it('体力耗尽 → 按住 Shift 也不可疾跑', () => {
    expect(canSprint(0, true)).toBe(false)
  })

  it('未按 Shift → 不可疾跑', () => {
    expect(canSprint(1, false)).toBe(false)
  })
})
