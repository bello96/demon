import type { RoomLayout } from '../src/types'

/** 10 房间固定布局（与小程序侧测试同源的固定副本，保证断言确定性） */
export const ROOM_LAYOUT: RoomLayout[] = [
  { x: 5, z: 5, w: 15, d: 15 },
  { x: 25, z: 5, w: 12, d: 20 },
  { x: 42, z: 10, w: 20, d: 15 },
  { x: 5, z: 25, w: 15, d: 15 },
  { x: 25, z: 30, w: 25, d: 25 },
  { x: 55, z: 30, w: 15, d: 15 },
  { x: 10, z: 45, w: 12, d: 25 },
  { x: 30, z: 60, w: 20, d: 10 },
  { x: 60, z: 5, w: 10, d: 10 },
  { x: 60, z: 55, w: 15, d: 15 },
]
