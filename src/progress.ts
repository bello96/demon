/**
 * 关卡进度的存档语义（两个 localStorage 键，纯函数便于单测）：
 *  - levelReached：下次进入的默认关（全通关后回 1 开新轮）
 *  - levelCleared：历史已通过的最高关数，只增不减——全通关也不清零，
 *    专用于关卡选择界面的解锁判定
 */

/** 读档并迁移：旧档只有 levelReached 时按"已通 reached-1 关"推导；一切脏值钳回合法区间 */
export function migrateProgress(
  reachedRaw: number,
  clearedRaw: number,
  levelCount: number,
): { level: number; cleared: number } {
  const reached = Number.isFinite(reachedRaw) ? Math.floor(reachedRaw) : 1
  const clearedBase = Number.isFinite(clearedRaw) ? Math.floor(clearedRaw) : reached - 1
  const cleared = Math.min(Math.max(clearedBase, 0), levelCount)
  // level 除了落在 [1, levelCount]，还不得越过解锁边界（矛盾档以 cleared 为准）
  const level = Math.min(Math.max(reached, 1), levelCount, cleared + 1)
  return { level, cleared }
}

/**
 * 关卡 n 是否可进。
 *  - progression=true（默认，逐关解锁）：已通关的关可重玩，最多放行到"已通最高关的下一关"
 *  - progression=false（全局开关关闭）：所有存在的关卡直接开放，随便玩
 */
export function isLevelUnlocked(n: number, cleared: number, progression: boolean = true): boolean {
  if (n < 1) {
    return false
  }
  if (!progression) {
    return true
  }
  return n <= cleared + 1
}
