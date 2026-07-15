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

/** 主题单面取值：preset=内置材质名（THEME_PRESETS 白名单）/ color=#rrggbb（程序化像素噪点纹理） */
export interface ThemeSurface {
  type: 'preset' | 'color'
  value: string
}

/** 关卡五个表面的主题配置（每面可选，缺省=游戏默认材质）；存于 LevelConfig.theme */
export interface LevelTheme {
  roomFloor?: ThemeSurface
  corridorFloor?: ThemeSurface
  roomWall?: ThemeSurface
  corridorWall?: ThemeSurface
  ceiling?: ThemeSurface
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
  /** 是否投放雷达（默认 true）：关卡关闭小地图时雷达无处显示，同步不投放 */
  radarEnabled?: boolean
  /** 关卡表面主题（可选）：五个表面各自的预设/颜色取值，见 LevelTheme */
  theme?: LevelTheme
}

export interface LightSwitch {
  pos: THREE.Vector3
  box: THREE.Box3
  handle: THREE.Mesh
  isOn: boolean
}

export interface Interactable {
  type: 'cabinet' | 'switch' | 'key' | 'radar' | 'shoes' | 'door'
  pos: THREE.Vector3
  // box 仅 switch 会用到精确 AABB 判定（目前也只是预留，未被读取），其它交互物靠 pos 距离即可
  box?: THREE.Box3
  obj?: LightSwitch
  // 拾取后隐藏的展示物：鞋子是一双两只（Group），故放宽到 Object3D
  mesh?: THREE.Object3D
  // 可躲双层柜的两个方块 mesh：玩家躲入时临时隐藏（箱内视觉由 Player.hideBox 全权承担），
  // 出箱恢复；幽灵视线/碰撞走的是栅格集合，不受渲染层隐藏影响
  meshes?: THREE.Mesh[]
  collected?: boolean
}
