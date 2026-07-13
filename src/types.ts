import type * as THREE from 'three'

export interface RoomLayout {
  x: number
  z: number
  w: number
  d: number
}

export interface Room extends RoomLayout {
  id: number
}

/** 世界生成的关卡选项（关卡编辑器产物） */
export interface MansionOptions {
  /** 逃生门数量：当前产品恒为 1，保留扩展位 */
  doorCount?: number
  /**
   * 手画走廊矩形：按矩形原样挖空，宽度任意；与房间/彼此重叠或贴边即打通。
   * 房间贴边/重叠本身就算连通，绝不自动生成走廊；唯一例外是防死局兜底——
   * 与 1 号房不连通的房间补一条 L 形直廊。
   */
  corridorRects?: RoomLayout[]
}

export interface LightSwitch {
  pos: THREE.Vector3
  box: THREE.Box3
  handle: THREE.Mesh
  isOn: boolean
}

export interface Interactable {
  type: 'cabinet' | 'switch' | 'key' | 'radar' | 'door'
  pos: THREE.Vector3
  // box 仅 switch 会用到精确 AABB 判定（目前也只是预留，未被读取），其它交互物靠 pos 距离即可
  box?: THREE.Box3
  obj?: LightSwitch
  mesh?: THREE.Mesh
  collected?: boolean
}
