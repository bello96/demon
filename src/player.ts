import * as THREE from 'three'
import { t } from './localization'
import { DARK_FOG_NEAR, LIT_AMBIENT, LIT_FOG_FAR, LIT_FOG_NEAR } from './constants'
import { canSprint, tickStamina } from './stamina'
import type { World } from './world'
import type { SoundGenerator } from './sound_generator'

export class Player {
  pos = new THREE.Vector3(0, 1, 0)
  vel = new THREE.Vector3()
  /** 基础步行速度（米/秒）：Shift 疾跑 ×1.5；拾到鞋子再 ×1.5，两者可叠乘（4 → 6 → 9） */
  readonly baseSpeed = 4
  readonly jumpForce = 10
  readonly gravity = 25
  readonly height = 1.75
  readonly radius = 0.25
  onGround = false
  pitch = 0
  yaw = 0

  mouseSensitivity: number

  isHidden = false
  hidingType: string | null = null
  // 进箱前的落脚点：出箱时原地放回（不弹开、无位移落差）
  private readonly preHidePos = new THREE.Vector3()
  // 躲藏时罩住玩家的"箱内壁"盒：破洞固定开在箱壁上（构造时生成，终身复用）
  private readonly hideBox: THREE.Mesh
  // 躲入时被临时隐藏的柜块（视点比柜体高，不隐藏会看到柜顶面贴眼/挡住洞外视线）
  private hidingCabinetMeshes: THREE.Mesh[] | null = null
  flashlightOn = true
  flashlightIntensity = 2
  /** 拾取完整说明收成徽章的定时器（updateUI 管理） */
  private itemToastTimer: number | null = null

  // 关灯态的环境值，由关卡配置注入（默认沿用原硬编码值）
  private darkAmbient = 0.05
  private darkFogFar = 12

  hasKey = false
  hasRadar = false
  hasShoes = false
  hasWon = false

  /** 体力 0~1：Shift 疾跑消耗（10 秒耗尽），松开恢复（1 分钟回满），耗尽强制回落步行 */
  stamina = 1

  keys: Record<string, boolean> = {}
  flashlight: THREE.SpotLight

  // Pre-allocated vectors — eliminates per-frame allocations
  private readonly _dir = new THREE.Vector3()
  private readonly _forward = new THREE.Vector3()
  private readonly _right = new THREE.Vector3()
  private readonly _nextPos = new THREE.Vector3()
  private readonly _yAxis = new THREE.Vector3(0, 1, 0)
  private readonly _exitTest = new THREE.Vector3()

  constructor(
    private camera: THREE.PerspectiveCamera,
    private scene: THREE.Scene,
    private world: World,
    private listener: THREE.AudioListener,
    private soundGen: SoundGenerator,
    private ambientLight: THREE.AmbientLight
  ) {
    this.mouseSensitivity = this.loadMouseSensitivity()

    this.flashlight = new THREE.SpotLight(0xffaa88, this.flashlightIntensity, 40, Math.PI / 6, 0.5, 1)
    this.flashlight.position.set(0.2, -0.2, 0)
    this.camera.add(this.flashlight)
    this.camera.add(this.flashlight.target)
    this.flashlight.target.position.set(0, 0, -1)
    this.scene.add(this.camera)

    // 箱内壁挂在 scene（不进 worldGroup），不被 World.regenerate 的资源回收清掉
    this.hideBox = this.buildHideBox()
    this.scene.add(this.hideBox)
  }

  /**
   * 生成一面箱内壁纹理（512×1024 ≈ 1m×2.6m）：深色木质底 + 横板缝 + 木纹，
   * 毛边多边形擦出透明破洞，洞缘再描一圈更深的板茬。
   * 固定 seed 的线性同余伪随机——洞形每次加载都一致（孔属于箱子，不该变来变去）。
   * 必须标记 SRGBColorSpace：否则渲染时被伽马提亮，深棕黑木板会变成土黄色。
   */
  private makeHideFaceTexture(
    seed: number,
    holes: Array<{ cx: number; cy: number; rx: number; ry: number }>,
  ): THREE.CanvasTexture {
    const W = 512
    const H = 1024
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!
    let s = seed
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s / 2147483648
    }
    ctx.fillStyle = '#241708'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    for (let y = 128; y < H; y += 128) {
      ctx.fillRect(0, y - 3, W, 5)
    }
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(${60 + Math.floor(rnd() * 30)}, ${40 + Math.floor(rnd() * 18)}, 18, 0.25)`
      ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 3, 40 + Math.floor(rnd() * 120))
    }
    for (const h of holes) {
      const n = 11
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.35
        const k = 0.78 + rnd() * 0.34
        const px = h.cx + Math.cos(a) * h.rx * k
        const py = h.cy + Math.sin(a) * h.ry * k
        if (i === 0) { ctx.moveTo(px, py) } else { ctx.lineTo(px, py) }
      }
      ctx.closePath()
      // 先擦出透明洞，再沿同一路径骑线描边：内半圈落回洞内，形成深色板茬缩边。
      // destination-out 的擦除力度 = 源色 alpha，必须用不透明色，
      // 否则会沿用上面木纹残留的 rgba(...,0.25)——洞只被擦淡 25%，看起来"没挖穿"
      ctx.fillStyle = '#000'
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = '#140b04'
      ctx.lineWidth = 7
      ctx.stroke()
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    return tex
  }

  /**
   * 躲藏时罩住玩家的"箱内壁"盒（1×2.6×1，BackSide 从内看）：
   * 四壁各开不同的固定破洞——孔在箱子上，转头看到的是不同壁面上不同的孔；
   * 顶/底为实板，抬头只见箱顶板，绝无柜顶上方的天花板。
   * 破洞条带以站立视平线（y≈2.575，canvas y≈207）为中心开在正前方，
   * 直径约 0.15~0.2 米——贴眼 0.5 米处呈"透过小孔窥视"的视野占比；
   * 躲入时柜块本体被临时隐藏，视线穿洞直达房间，不会被柜体几何挡住。
   */
  private buildHideBox(): THREE.Mesh {
    const faceHoles: Array<Array<{ cx: number; cy: number; rx: number; ry: number }> | null> = [
      [{ cx: 190, cy: 200, rx: 48, ry: 40 }, { cx: 352, cy: 246, rx: 22, ry: 18 }], // +x 东壁：主洞+小洞
      [{ cx: 330, cy: 206, rx: 44, ry: 38 }], // -x 西壁：单洞偏右
      null, // +y 顶板：实心
      null, // -y 底板：实心
      [{ cx: 256, cy: 212, rx: 50, ry: 42 }], // +z 南壁：主洞居中
      [{ cx: 165, cy: 196, rx: 30, ry: 26 }, { cx: 358, cy: 226, rx: 26, ry: 22 }], // -z 北壁：双中洞
    ]
    const seeds = [7, 23, 0, 0, 41, 59]
    const solid = new THREE.MeshBasicMaterial({ color: 0x1c1006, side: THREE.BackSide })
    const mats = faceHoles.map((holes, i) =>
      holes
        ? new THREE.MeshBasicMaterial({
            map: this.makeHideFaceTexture(seeds[i], holes),
            alphaTest: 0.5,
            side: THREE.BackSide,
          })
        : solid,
    )
    // 尺寸刻意比柜格（1×1）小一圈、底面抬离地板：盒底 y=0.6、顶 3.1、壁 ±0.47——
    // 若与地板顶面（0.5）或贴墙面（±0.5）共面会 z-fighting，低头/贴壁时闪出外面的贴图
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.94, 2.5, 0.94), mats)
    box.visible = false
    return box
  }

  spawn(): void {
    if (this.world.walkableNodes.length > 0) {
      const start = this.world.walkableNodes[Math.floor(this.world.walkableNodes.length / 2)]
      this.pos.copy(start)
      this.pos.y = 1
      // 出生朝向随机化：四个正方向洗牌后优先挑「前方一格可走」的，避免开局贴脸怼墙；
      // 注意须在 reset()（yaw 归零）之后调用，Game.buildLevel 已保证该顺序
      const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2]
      for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[dirs[i], dirs[j]] = [dirs[j], dirs[i]]
      }
      let facing = dirs[0]
      for (const yaw of dirs) {
        // 前进向量与 update() 一致：(0,0,-1) 绕 Y 轴转 yaw → (-sin, 0, -cos)
        this._exitTest.set(this.pos.x - Math.sin(yaw), this.pos.y, this.pos.z - Math.cos(yaw))
        if (!this.world.checkCollision(this._exitTest, this.radius, this.height, 0.5)) {
          facing = yaw
          break
        }
      }
      this.yaw = facing
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
    }
  }

  reset(): void {
    this.vel.set(0, 0, 0)
    this.pitch = 0
    this.yaw = 0
    this.onGround = false
    this.isHidden = false
    this.hidingType = null
    this.flashlightOn = true
    this.flashlight.intensity = this.flashlightIntensity
    this.hasKey = false
    this.hasRadar = false
    this.hasShoes = false
    this.hasWon = false
    this.stamina = 1
    this.keys = {}
    this.hideBox.visible = false
    // 躲藏中切关/重开的兜底：恢复柜块可见性（旧世界随 regenerate 销毁时无害）
    if (this.hidingCabinetMeshes) {
      for (const m of this.hidingCabinetMeshes) { m.visible = true }
      this.hidingCabinetMeshes = null
    }
    this.camera.rotation.set(0, 0, 0, 'YXZ')
    this.updateUI()
    this.updateStaminaBar()
  }

  private loadMouseSensitivity(): number {
    const saved = localStorage.getItem('mouseSensitivity')
    return saved ? parseFloat(saved) : 1.0
  }

  setMouseSensitivity(value: number): void {
    this.mouseSensitivity = value
    localStorage.setItem('mouseSensitivity', String(value))
  }

  /** 注入本关关灯态的环境光/雾距（进关时由 Game 调用） */
  setEnvDark(ambient: number, fogFar: number): void {
    this.darkAmbient = ambient
    this.darkFogFar = fogFar
  }

  handleInput(e: KeyboardEvent, isDown: boolean): void {
    this.keys[e.code] = isDown
    if (isDown) {
      if (e.code === 'KeyE') { this.interact() }
      if (e.code === 'KeyF') { this.toggleFlashlight() }
    }
  }

  handleMouseMove(e: MouseEvent): void {
    // 箱内 360° 自由环视：破洞固定在箱壁上，转头看到不同壁面的孔；
    // 抬头/低头看到的是箱体顶板/底板（实心），天然看不到柜外天花板
    if (this.isHidden && this.hidingType !== 'cabinet') { return }

    this.yaw -= e.movementX * 0.002 * this.mouseSensitivity
    this.pitch -= e.movementY * 0.002 * this.mouseSensitivity
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch))

    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
  }

  private toggleFlashlight(): void {
    this.flashlightOn = !this.flashlightOn
    this.flashlight.intensity = this.flashlightOn ? this.flashlightIntensity : 0
  }

  private playSound(name: string): void {
    const sound = new THREE.Audio(this.listener)
    let buffer: AudioBuffer | null = null
    if (name === 'switch') { buffer = this.soundGen.getSwitchBuffer() }
    else if (name === 'pickup') { buffer = this.soundGen.getPickupBuffer() }
    if (buffer) {
      sound.setBuffer(buffer)
      sound.setVolume(0.5)
      sound.play()
    }
  }

  private interact(): void {
    if (this.isHidden) {
      this.isHidden = false
      // 退出躲藏：藏起箱内壁、柜子本体复原，人原地回到进箱前的落脚点，视角保持箱内朝向
      this.hideBox.visible = false
      if (this.hidingCabinetMeshes) {
        for (const m of this.hidingCabinetMeshes) { m.visible = true }
        this.hidingCabinetMeshes = null
      }
      this.pos.copy(this.preHidePos)
      return
    }

    for (let i = 0; i < this.world.interactables.length; i++) {
      const item = this.world.interactables[i]
      if (item.collected) { continue }
      if (this.pos.distanceTo(item.pos) >= 2.0) { continue }

      if (item.type === 'cabinet') {
        this.isHidden = true
        this.hidingType = item.type
        // 记住进箱前的落脚点：出箱原地放回，不再四处弹出（无位移、无落差感）
        this.preHidePos.copy(this.pos)
        this.pos.copy(item.pos)
        // 视角完全保持进入时的朝向（不转身、不置平）——出箱时视角也与箱内一致；
        // 箱内壁盒罩到柜位上，破洞固定在箱壁上。柜块本体临时隐藏：
        // 站立眼高（2.575）比柜体（2.5）高，不隐藏会看到柜顶面贴眼、洞外视线也被挡
        this.hideBox.position.set(item.pos.x, 1.85, item.pos.z)
        this.hideBox.visible = true
        if (item.meshes) {
          for (const m of item.meshes) { m.visible = false }
          this.hidingCabinetMeshes = item.meshes
        }
      } else if (item.type === 'switch') {
        this.playSound('switch')
        const switchObj = item.obj

        if (switchObj) {
          // 状态源用 switchObj.isOn，避免多开关场景下 ambientLight 被其它因素影响导致状态漂移
          if (!switchObj.isOn) {
            this.ambientLight.intensity = LIT_AMBIENT
            ;(this.scene.fog as THREE.Fog).near = LIT_FOG_NEAR
            ;(this.scene.fog as THREE.Fog).far = LIT_FOG_FAR
            switchObj.handle.rotation.x = Math.PI / 4
            switchObj.isOn = true
          } else {
            this.ambientLight.intensity = this.darkAmbient
            ;(this.scene.fog as THREE.Fog).near = DARK_FOG_NEAR
            ;(this.scene.fog as THREE.Fog).far = this.darkFogFar
            switchObj.handle.rotation.x = -Math.PI / 4
            switchObj.isOn = false
          }
          // 开关行只在灯灭时显示：开灯即藏、关灯恢复（进关初始态由 Game.applyLevelConfig 决定）
          const infoSwitch = document.getElementById('info-switch')
          if (infoSwitch) { infoSwitch.style.display = switchObj.isOn ? 'none' : '' }
        }
      } else if (item.type === 'key') {
        this.playSound('pickup')
        this.hasKey = true
        item.collected = true
        if (item.mesh) { item.mesh.visible = false }
        this.updateUI('gotKey')
        return
      } else if (item.type === 'radar') {
        this.playSound('pickup')
        this.hasRadar = true
        item.collected = true
        if (item.mesh) { item.mesh.visible = false }
        this.updateUI('gotRadar')
        return
      } else if (item.type === 'shoes') {
        this.playSound('pickup')
        this.hasShoes = true
        item.collected = true
        if (item.mesh) { item.mesh.visible = false }
        this.updateUI('gotShoes')
        return
      } else if (item.type === 'door') {
        if (this.hasKey) {
          this.hasWon = true
        } else {
          const msg = document.getElementById('interaction-msg')
          if (msg) {
            msg.innerText = t('doorLocked')
            setTimeout(() => { msg.innerText = t('interact') }, 2000)
          }
        }
      }
      return
    }
  }

  /** 道具行：拾取瞬间先显示完整说明，5 秒后收成短徽章；无参调用（如 reset）直接渲染徽章 */
  private updateUI(justPickedKey?: string): void {
    const info = document.getElementById('info-items')
    if (!info) { return }
    const renderBadges = (): void => {
      // 徽章颜色与道具本体一致：钥匙金 / 雷达绿 / 鞋子蓝（配色在 index.html 的 .badge-* 规则）
      const badges: { text: string; cls: string }[] = []
      if (this.hasKey) { badges.push({ text: t('badgeKey'), cls: 'badge-key' }) }
      if (this.hasRadar) { badges.push({ text: t('badgeRadar'), cls: 'badge-radar' }) }
      if (this.hasShoes) { badges.push({ text: t('badgeShoes'), cls: 'badge-shoes' }) }
      info.innerHTML = badges
        .map(b => `<span class="item-badge ${b.cls}">${b.text}</span>`)
        .join('')
    }
    if (this.itemToastTimer !== null) {
      clearTimeout(this.itemToastTimer)
      this.itemToastTimer = null
    }
    if (justPickedKey) {
      info.innerText = t(justPickedKey)
      this.itemToastTimer = window.setTimeout(() => {
        this.itemToastTimer = null
        renderBadges()
      }, 5000)
    } else {
      renderBadges()
    }
  }

  /** 体力条渲染：宽度按百分比，颜色随余量分档（≥60% 绿 / ≥30% 黄 / 不足 30% 红） */
  private updateStaminaBar(): void {
    const fill = document.getElementById('stamina-fill')
    if (!fill) { return }
    fill.style.width = (this.stamina * 100).toFixed(1) + '%'
    fill.style.background =
      this.stamina >= 0.6 ? '#2fbf3f' : this.stamina >= 0.3 ? '#e0b428' : '#d23c2a'
  }

  update(dt: number): void {
    const sprintHeld = !!this.keys['ShiftLeft']

    if (this.isHidden) {
      // 躲藏中视为无移动输入（不消耗体力）；按住 Shift 期间照旧不恢复
      this.stamina = tickStamina(this.stamina, dt, sprintHeld, false)
      this.updateStaminaBar()
      // 箱内相机与站立完全同高（pos.y + height*0.9 ≈ 2.575）：进出箱视线高度零跳变。
      // 视点高于柜体（2.5）没关系——观察通道是箱内壁盒开在 y>2.5 条带上的破洞，
      // 视线经洞口水平掠过柜块顶面，不依赖旧的"视点藏进柜块内隐形透视"技巧
      this.camera.position.copy(this.pos)
      this.camera.position.y += this.height * 0.9
      return
    }

    this._forward.set(0, 0, -1).applyAxisAngle(this._yAxis, this.yaw)
    this._right.set(1, 0, 0).applyAxisAngle(this._yAxis, this.yaw)
    this._dir.set(0, 0, 0)

    if (this.keys['KeyW']) { this._dir.add(this._forward) }
    if (this.keys['KeyS']) { this._dir.sub(this._forward) }
    if (this.keys['KeyA']) { this._dir.sub(this._right) }
    if (this.keys['KeyD']) { this._dir.add(this._right) }

    const moving = this._dir.lengthSq() > 0
    if (moving) { this._dir.normalize() }

    // 体力先于速度结算：消耗（Shift+移动）/冻结（Shift+静止）/恢复（松开）三态互斥
    this.stamina = tickStamina(this.stamina, dt, sprintHeld, moving)
    this.updateStaminaBar()

    const speed =
      this.baseSpeed *
      (this.hasShoes ? 1.5 : 1) *
      (canSprint(this.stamina, sprintHeld) ? 1.5 : 1)

    this.vel.x = this._dir.x * speed
    this.vel.z = this._dir.z * speed
    this.vel.y -= this.gravity * dt

    if (this.onGround && this.keys['Space']) {
      this.vel.y = this.jumpForce
      this.onGround = false
    }

    // Collision X
    this._nextPos.copy(this.pos)
    this._nextPos.x += this.vel.x * dt
    if (!this.world.checkCollision(this._nextPos, this.radius, this.height, 0.5)) {
      this.pos.x = this._nextPos.x
    } else {
      this.vel.x = 0
    }

    // Collision Z
    this._nextPos.copy(this.pos)
    this._nextPos.z += this.vel.z * dt
    if (!this.world.checkCollision(this._nextPos, this.radius, this.height, 0.5)) {
      this.pos.z = this._nextPos.z
    } else {
      this.vel.z = 0
    }

    // Collision Y
    this._nextPos.copy(this.pos)
    this._nextPos.y += this.vel.y * dt
    if (!this.world.checkCollision(this._nextPos, this.radius, this.height, 0)) {
      this.pos.y = this._nextPos.y
      this.onGround = false
    } else {
      if (this.vel.y < 0) { this.onGround = true }
      this.vel.y = 0
      if (this.onGround) {
        this.pos.y = Math.round(this.pos.y - 0.5) + 0.5
      }
    }

    if (this.pos.y < -10) {
      this.pos.y = 10
      this.vel.y = 0
    }

    this.camera.position.copy(this.pos)
    this.camera.position.y += this.height * 0.9

    // Interaction UI
    let canInteract = false
    for (const item of this.world.interactables) {
      if (item.collected) { continue }
      if (this.pos.distanceTo(item.pos) < 2.0) {
        canInteract = true
        break
      }
    }
    const msg = document.getElementById('interaction-msg')
    if (msg) { msg.style.display = canInteract ? 'block' : 'none' }
  }
}
