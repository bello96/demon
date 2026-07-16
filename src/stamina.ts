/**
 * 体力值纯函数模型（0~1）：Shift 疾跑消耗、松开恢复。
 * 消耗与恢复互斥（由 sprintHeld 一刀切），不存在同帧"一边进水一边出水"。
 */

/** 满体力持续疾跑到耗尽所需秒数 */
export const STAMINA_DRAIN_SECONDS = 10
/** 从 0 恢复到满体力所需秒数 */
export const STAMINA_REGEN_SECONDS = 60

/**
 * 体力推进一帧：
 * - 按住 Shift 且有移动输入 → 消耗（速率 1/10 每秒），钳到 0
 * - 按住 Shift 但静止 → 冻结（按住期间永不恢复）
 * - 松开 Shift → 恢复（速率 1/60 每秒），封顶 1
 */
export function tickStamina(
  current: number,
  dt: number,
  sprintHeld: boolean,
  moving: boolean,
): number {
  if (sprintHeld) {
    if (moving) {
      return Math.max(0, current - dt / STAMINA_DRAIN_SECONDS)
    }
    return current
  }
  return Math.min(1, current + dt / STAMINA_REGEN_SECONDS)
}

/** 疾跑加成是否生效：按住 Shift 且体力未耗尽（耗尽即回落步行速度） */
export function canSprint(stamina: number, sprintHeld: boolean): boolean {
  return sprintHeld && stamina > 0
}
