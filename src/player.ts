import * as THREE from 'three'
import { t } from './localization'
import { LIT_AMBIENT, LIT_FOG_FAR } from './constants'
import type { World } from './world'
import type { SoundGenerator } from './sound_generator'

// 退出躲藏点时尝试的 8 个候选方向（4 正向优先 + 4 对角线）
const EXIT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
]

export class Player {
  pos = new THREE.Vector3(0, 1, 0)
  vel = new THREE.Vector3()
  readonly speed = 6
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
  flashlightOn = true
  flashlightIntensity = 2

  // 关灯态的环境值，由关卡配置注入（默认沿用原硬编码值）
  private darkAmbient = 0.05
  private darkFogFar = 12

  hasKey = false
  hasRadar = false
  hasWon = false

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
  }

  spawn(): void {
    if (this.world.walkableNodes.length > 0) {
      const start = this.world.walkableNodes[Math.floor(this.world.walkableNodes.length / 2)]
      this.pos.copy(start)
      this.pos.y = 1
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
    this.hasWon = false
    this.keys = {}
    this.camera.rotation.set(0, 0, 0, 'YXZ')
    this.updateUI()
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
      // 退出躲藏 —— 关闭门缝遮罩
      const overlay = document.getElementById('cabinet-overlay')
      if (overlay) { overlay.style.display = 'none' }
      this.popOutOfHiding()
      return
    }

    for (let i = 0; i < this.world.interactables.length; i++) {
      const item = this.world.interactables[i]
      if (item.collected) { continue }
      if (this.pos.distanceTo(item.pos) >= 2.0) { continue }

      if (item.type === 'cabinet') {
        this.isHidden = true
        this.hidingType = item.type
        this.pos.copy(item.pos)
        // 显示橱柜门缝遮罩（index.html 的 #cabinet-overlay）——黑幕 + 中间水平缝
        const overlay = document.getElementById('cabinet-overlay')
        if (overlay) { overlay.style.display = 'block' }
      } else if (item.type === 'switch') {
        this.playSound('switch')
        const switchObj = item.obj

        if (switchObj) {
          // 状态源用 switchObj.isOn，避免多开关场景下 ambientLight 被其它因素影响导致状态漂移
          if (!switchObj.isOn) {
            this.ambientLight.intensity = LIT_AMBIENT
            ;(this.scene.fog as THREE.Fog).far = LIT_FOG_FAR
            switchObj.handle.rotation.x = Math.PI / 4
            switchObj.isOn = true
          } else {
            this.ambientLight.intensity = this.darkAmbient
            ;(this.scene.fog as THREE.Fog).far = this.darkFogFar
            switchObj.handle.rotation.x = -Math.PI / 4
            switchObj.isOn = false
          }
        }
      } else if (item.type === 'key') {
        this.playSound('pickup')
        this.hasKey = true
        item.collected = true
        if (item.mesh) { item.mesh.visible = false }
        this.updateUI()
        return
      } else if (item.type === 'radar') {
        this.playSound('pickup')
        this.hasRadar = true
        item.collected = true
        if (item.mesh) { item.mesh.visible = false }
        this.updateUI()
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

  // 退出躲藏点时，在 8 个方向中挑第一个可站立的落点，避免穿墙
  private popOutOfHiding(): void {
    for (const [dx, dz] of EXIT_OFFSETS) {
      this._exitTest.set(this.pos.x + dx, this.pos.y, this.pos.z + dz)
      if (!this.world.checkCollision(this._exitTest, this.radius, this.height, 0.5)) {
        this.pos.copy(this._exitTest)
        return
      }
    }
    console.warn('[Player] popOutOfHiding: 8 方向全部堵死，玩家留在原地', this.pos)
  }

  private updateUI(): void {
    const info = document.getElementById('info-items')
    if (info) {
      let text = ''
      if (this.hasKey) { text += t('gotKey') }
      if (this.hasRadar) { text += t('gotRadar') }
      info.innerText = text
    }
  }

  update(dt: number): void {
    if (this.isHidden) {
      this.camera.position.copy(this.pos)
      this.camera.position.y += this.hidingType === 'cabinet' ? this.height * 0.9 : 0.2
      return
    }

    const speed = this.keys['ShiftLeft'] ? this.speed * 1.5 : this.speed

    this._forward.set(0, 0, -1).applyAxisAngle(this._yAxis, this.yaw)
    this._right.set(1, 0, 0).applyAxisAngle(this._yAxis, this.yaw)
    this._dir.set(0, 0, 0)

    if (this.keys['KeyW']) { this._dir.add(this._forward) }
    if (this.keys['KeyS']) { this._dir.sub(this._forward) }
    if (this.keys['KeyA']) { this._dir.sub(this._right) }
    if (this.keys['KeyD']) { this._dir.add(this._right) }

    if (this._dir.lengthSq() > 0) { this._dir.normalize() }

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
