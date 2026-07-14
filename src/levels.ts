import type { RoomLayout } from './types'
import rawLevelsData from './levels_data.json'

/** 单个关卡的完整难度配置：地图布局 + 环境氛围 + 幽灵参数（与小程序版格式一致） */
export interface LevelConfig {
  /** 房间布局（100×100 网格内；重叠/贴边 = 拼接成不规则大房间） */
  rooms: RoomLayout[]
  /** 手画走廊矩形（关卡编辑器产物）：原样挖空、宽度任意；房间贴边/重叠即连通，无需走廊 */
  corridorRects?: RoomLayout[]
  /** 逃生门数量：当前产品设计恒为 1——唯一的门，每局随机分到某个房间的随机墙面 */
  doorCount: number
  /** 关灯时环境光强度：可逐关变暗（开灯后各关一样亮） */
  darkAmbient: number
  /** 关灯时可视距离（米）：雾可逐关变浓 */
  darkFogFar: number
  /** 幽灵巡逻速度：追击时 ×1.5；玩家步行 6 / 疾跑 9，上限须留出逃生余地 */
  ghostSpeed: number
  /** 开局房间灯是否已打开（默认 false=摸黑找开关；开着时玩家仍可去把它关掉） */
  lightsOn: boolean
  /** 本关是否出现幽灵（默认 true；false=无追逐的纯逃脱关） */
  ghostEnabled: boolean
  /** 是否显示小地图（默认 true）：false=隐藏右上角缩略图，M 键放大也失效 */
  minimapEnabled: boolean
  /** 是否冻结（默认 false）：true=暂时停用，游戏端跳过此关、后续关卡顺位前移；数据保留可随时解冻 */
  frozen: boolean
}

// 内置 JSON 被改坏（数值非法）时的应急单关：保证游戏能开、不黑屏，控制台有报错提示
const FALLBACK_LEVELS: LevelConfig[] = [
  {
    rooms: [{ x: 30, z: 30, w: 20, d: 20 }],
    doorCount: 1,
    darkAmbient: 0.2,
    darkFogFar: 20,
    ghostSpeed: 2.6,
    lightsOn: false,
    ghostEnabled: true,
    minimapEnabled: true,
    frozen: false,
  },
]

/**
 * 解析并校验关卡 JSON（关卡编辑器导出的格式，顶层 { levels: [...] }）；
 * 任何一处非法都整体拒绝返回 null——宁可回退，也不能拿半坏的数据生成世界。
 * 游戏端与 Cloudflare Functions 端共用本函数，保持校验单一来源。
 */
export function parseLevelsData(data: unknown): LevelConfig[] | null {
  const arr = (data as { levels?: unknown })?.levels
  if (!Array.isArray(arr) || arr.length === 0) {
    return null
  }
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const rectOk = (r: unknown): boolean => {
    // 元素可能是 null / 原始值：先确认是对象再读属性，避免抛 TypeError
    if (typeof r !== 'object' || r === null) {
      return false
    }
    const q = r as { x?: unknown; z?: unknown; w?: unknown; d?: unknown }
    return (
      num(q.x) &&
      num(q.z) &&
      num(q.w) &&
      num(q.d) &&
      q.x >= 1 &&
      q.z >= 1 &&
      q.w >= 1 &&
      q.d >= 1 &&
      q.x + q.w < 100 &&
      q.z + q.d < 100
    )
  }
  const out: LevelConfig[] = []
  for (const lv of arr) {
    // 关卡元素可能是 null / 原始值：先确认是对象再读属性，整包拒绝而不是抛异常
    if (typeof lv !== 'object' || lv === null) {
      return null
    }
    const l = lv as {
      rooms?: unknown[]
      corridorRects?: unknown[]
      darkAmbient?: unknown
      darkFogFar?: unknown
      ghostSpeed?: unknown
      lightsOn?: unknown
      ghostEnabled?: unknown
      minimapEnabled?: unknown
      frozen?: unknown
    }
    if (!Array.isArray(l.rooms) || l.rooms.length === 0 || !l.rooms.every(rectOk)) {
      return null
    }
    if (
      l.corridorRects !== undefined &&
      (!Array.isArray(l.corridorRects) || !l.corridorRects.every(rectOk))
    ) {
      return null
    }
    if (!num(l.darkAmbient) || !num(l.darkFogFar) || !num(l.ghostSpeed)) {
      return null
    }
    if (l.darkAmbient <= 0 || l.darkFogFar < 5 || l.ghostSpeed <= 0 || l.ghostSpeed > 5.9) {
      return null
    }
    // 四个开关都是可选布尔：缺省用默认值，写了就必须是 true/false
    if (l.lightsOn !== undefined && typeof l.lightsOn !== 'boolean') {
      return null
    }
    if (l.ghostEnabled !== undefined && typeof l.ghostEnabled !== 'boolean') {
      return null
    }
    if (l.minimapEnabled !== undefined && typeof l.minimapEnabled !== 'boolean') {
      return null
    }
    if (l.frozen !== undefined && typeof l.frozen !== 'boolean') {
      return null
    }
    out.push({
      rooms: (l.rooms as RoomLayout[]).map((r) => ({ x: r.x, z: r.z, w: r.w, d: r.d })),
      corridorRects: l.corridorRects
        ? (l.corridorRects as RoomLayout[]).map((r) => ({ x: r.x, z: r.z, w: r.w, d: r.d }))
        : undefined,
      doorCount: 1,
      darkAmbient: l.darkAmbient,
      darkFogFar: l.darkFogFar,
      ghostSpeed: l.ghostSpeed,
      lightsOn: l.lightsOn === true,
      ghostEnabled: l.ghostEnabled !== false,
      minimapEnabled: l.minimapEnabled !== false,
      frozen: l.frozen === true,
    })
  }
  // 全部冻结 = 游戏无关可玩：与空数组同罪，整体拒绝（保证过滤冻结关后必有存货）
  if (!out.some((l) => !l.frozen)) {
    return null
  }
  return out
}

/** 内置兜底关卡（src/levels_data.json）；构建期数据非法时回退应急单关 */
export const BUILTIN_LEVELS: LevelConfig[] = (() => {
  const parsed = parseLevelsData(rawLevelsData)
  if (!parsed) {
    console.error('[levels] src/levels_data.json 数据非法，已启用应急关卡（请检查 JSON）')
    return FALLBACK_LEVELS
  }
  // 与云端加载同规则：冻结关不参与游戏（parse 已保证过滤后至少剩 1 关）
  return parsed.filter((l) => !l.frozen)
})()

/** 从给定关卡数组取第 level 关；越界钳制到 [1, levels.length]（存档损坏兜底） */
export function getLevelConfig(levels: LevelConfig[], level: number): LevelConfig {
  if (levels.length === 0) {
    // 防御：空数组时退回应急关卡，避免返回 undefined 违背签名
    return FALLBACK_LEVELS[0]
  }
  const idx = Math.min(Math.max(Math.round(level), 1), levels.length) - 1
  return levels[idx]
}
