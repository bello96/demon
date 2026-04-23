import type * as THREE from 'three'

export interface RoomLayout {
  x: number
  z: number
  w: number
  d: number
  features: string[]
}

export interface Room extends RoomLayout {
  id: number
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
