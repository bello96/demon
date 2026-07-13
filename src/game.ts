import * as THREE from 'three'
import { World } from './world'
import { Player } from './player'
import { Ghost } from './ghost'
import { drawMinimap } from './minimap'
import { SoundGenerator } from './sound_generator'
import { initLocalization, t } from './localization'
import { loadingManager, texturesLoaded } from './utils'
import type { RoomLayout } from './types'

const roomLayout: RoomLayout[] = [
  { x: 5, z: 5, w: 15, d: 15 },
  { x: 25, z: 5, w: 12, d: 20 },
  { x: 42, z: 10, w: 20, d: 15 },
  { x: 5, z: 25, w: 15, d: 15 },
  { x: 25, z: 30, w: 25, d: 25 },
  { x: 55, z: 30, w: 15, d: 15 },
  { x: 10, z: 45, w: 12, d: 25 },
  { x: 30, z: 60, w: 20, d: 10 },
  { x: 60, z: 5, w: 10, d: 10 },
  { x: 60, z: 55, w: 15, d: 15 }
]

class Game {
  private isPlaying = false
  private isPaused = false
  private isGameOver = false
  private shouldLockPointer = false

  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private clock: THREE.Clock
  private ambientLight: THREE.AmbientLight

  private listener: THREE.AudioListener
  private soundGen: SoundGenerator
  private heartbeat: THREE.Audio

  private world: World
  private player: Player
  private ghost: Ghost

  constructor() {
    initLocalization()
    this.setupLoader()

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x050505)
    this.scene.fog = new THREE.Fog(0x050505, 2, 12)

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100)
    this.renderer = new THREE.WebGLRenderer({ antialias: false })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.BasicShadowMap
    document.body.appendChild(this.renderer.domElement)

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.05)
    this.scene.add(this.ambientLight)

    this.listener = new THREE.AudioListener()
    this.camera.add(this.listener)
    this.soundGen = new SoundGenerator(this.listener)

    this.heartbeat = new THREE.Audio(this.listener)
    this.heartbeat.setBuffer(this.soundGen.getHeartbeatBuffer())
    this.heartbeat.setLoop(true)
    this.heartbeat.setVolume(0)

    this.world = new World(this.scene)
    this.world.generateMansion(roomLayout)

    this.player = new Player(this.camera, this.scene, this.world, this.listener, this.soundGen, this.ambientLight)
    this.player.spawn()

    this.ghost = new Ghost(this.scene, this.world, this.player, this.listener, this.soundGen)
    this.ghost.spawn()

    this.clock = new THREE.Clock()

    this.setupInput()
    requestAnimationFrame(this.animate)
  }

  /**
   * 绑定资源加载进度 UI：进度条根据 loadingManager 事件更新，
   * texturesLoaded resolve 后启用「开始游戏」按钮并隐藏进度条。
   */
  private setupLoader(): void {
    const barFill = document.getElementById('loader-bar-fill')
    const pctText = document.getElementById('loader-percent')
    const loaderArea = document.getElementById('loader-area')
    const startBtn = document.getElementById('btn-start') as HTMLButtonElement | null

    loadingManager.onProgress = (_url: string, loaded: number, total: number): void => {
      const pct = total > 0 ? Math.round((loaded / total) * 100) : 0
      if (barFill) { barFill.style.width = pct + '%' }
      if (pctText) { pctText.innerText = pct + '%' }
    }

    texturesLoaded.then(() => {
      if (barFill) { barFill.style.width = '100%' }
      if (pctText) { pctText.innerText = '100%' }
      // 100% 短暂停留后淡出，避免瞬间跳变
      setTimeout(() => {
        if (loaderArea) { loaderArea.style.display = 'none' }
        if (startBtn) { startBtn.disabled = false }
      }, 150)
    })
  }

  private setupInput(): void {
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === null && this.isPlaying && !this.isPaused) {
        this.togglePauseMenu()
      }
    })

    const checkLock = (e?: Event): void => {
      if (e && e.target) {
        const target = e.target as HTMLElement
        if (target.closest('#menu') ||
            target.closest('#pause-menu') ||
            target.closest('#game-over') ||
            target.closest('#game-win')) {
          return
        }
      }
      if (this.shouldLockPointer && !document.pointerLockElement) {
        document.body.requestPointerLock()
      }
    }
    document.addEventListener('click', checkLock)

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      this.player.handleInput(e, true)
      if (e.code === 'KeyM') {
        document.getElementById('minimap')?.classList.toggle('large')
      }
    })
    document.addEventListener('keyup', (e: KeyboardEvent) => this.player.handleInput(e, false))
    document.addEventListener('mousemove', (e: MouseEvent) => {
      checkLock(e)
      if (this.isPlaying && !this.isPaused) { this.player.handleMouseMove(e) }
    })

    document.getElementById('btn-start')?.addEventListener('click', () => {
      if (this.listener.context.state === 'suspended') {
        this.listener.context.resume()
      }
      document.body.requestPointerLock()
      document.getElementById('menu')!.classList.add('hidden')
      document.getElementById('game-info')!.style.display = 'block'

      this.updateSwitchInfo()

      this.isPlaying = true
      this.shouldLockPointer = true
      this.syncMouseSensitivityToSliders()
    })

    document.getElementById('btn-resume')?.addEventListener('click', () => this.togglePauseMenu())
    document.getElementById('btn-restart')?.addEventListener('click', () => this.restart())
    document.getElementById('respawn-btn')?.addEventListener('click', () => this.restart())
    document.getElementById('play-again-btn')?.addEventListener('click', () => this.restart())

    const bindSpeedSlider = (sliderId: string, displayId: string): void => {
      const slider = document.getElementById(sliderId) as HTMLInputElement | null
      if (slider) {
        slider.addEventListener('input', () => {
          const value = parseFloat(slider.value)
          const display = document.getElementById(displayId)
          if (display) { display.textContent = value.toFixed(1) + 'x' }
          this.player.setMouseSensitivity(value)
        })
      }
    }
    bindSpeedSlider('mouse-speed-slider', 'mouse-speed-display')
    bindSpeedSlider('pause-mouse-speed-slider', 'pause-mouse-speed-display')

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  private togglePauseMenu(): void {
    this.isPaused = !this.isPaused
    const pauseMenu = document.getElementById('pause-menu')!

    if (this.isPaused) {
      pauseMenu.classList.remove('hidden')
      document.exitPointerLock()
      this.shouldLockPointer = false
      this.syncMouseSensitivityToSliders()
    } else {
      pauseMenu.classList.add('hidden')
      document.body.requestPointerLock()
      this.shouldLockPointer = true
    }
  }

  private restart(): void {
    if (this.heartbeat.isPlaying) { this.heartbeat.stop() }
    const heartbeatUi = document.getElementById('heartbeat-ui')
    if (heartbeatUi) {
      heartbeatUi.style.opacity = '0'
      heartbeatUi.style.animation = 'none'
    }

    document.getElementById('game-over')!.classList.add('hidden')
    document.getElementById('game-win')!.classList.add('hidden')
    document.getElementById('pause-menu')!.classList.add('hidden')

    const cabinetOverlay = document.getElementById('cabinet-overlay')
    if (cabinetOverlay) { cabinetOverlay.style.display = 'none' }

    const interactionMsg = document.getElementById('interaction-msg')
    if (interactionMsg) { interactionMsg.style.display = 'none' }

    this.ambientLight.intensity = 0.05
    ;(this.scene.fog as THREE.Fog).far = 12

    this.world.regenerate(roomLayout)
    this.updateSwitchInfo()

    this.player.reset()
    this.ghost.reset()
    this.player.spawn()
    this.ghost.spawn()

    this.isGameOver = false
    this.isPaused = false
    this.isPlaying = true
    this.shouldLockPointer = true
    this.clock.getDelta()
    document.body.requestPointerLock()
  }

  private updateSwitchInfo(): void {
    const infoSwitch = document.getElementById('info-switch')
    if (infoSwitch) {
      infoSwitch.innerText = this.world.switchRoomId !== -1
        ? t('switchInRoom', { id: this.world.switchRoomId })
        : t('switchNotFound')
    }
  }

  private syncMouseSensitivityToSliders(): void {
    const v = this.player.mouseSensitivity
    const text = v.toFixed(1) + 'x'

    const mainSlider = document.getElementById('mouse-speed-slider') as HTMLInputElement | null
    const pauseSlider = document.getElementById('pause-mouse-speed-slider') as HTMLInputElement | null

    if (mainSlider) { mainSlider.value = String(v) }
    if (pauseSlider) { pauseSlider.value = String(v) }
    const mainDisplay = document.getElementById('mouse-speed-display')
    const pauseDisplay = document.getElementById('pause-mouse-speed-display')
    if (mainDisplay) { mainDisplay.textContent = text }
    if (pauseDisplay) { pauseDisplay.textContent = text }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate)

    if (!this.isPlaying || this.isPaused) {
      this.renderer.render(this.scene, this.camera)
      return
    }

    const dt = Math.min(this.clock.getDelta(), 0.1)

    this.player.update(dt)

    if (this.player.hasWon) {
      this.isPlaying = false
      this.shouldLockPointer = false
      document.exitPointerLock()
      document.getElementById('game-win')!.classList.remove('hidden')
    }

    const killed = this.ghost.update(dt)

    // Heartbeat
    const dist = this.player.pos.distanceTo(this.ghost.mesh.position)
    const threshold = 15
    const ui = document.getElementById('heartbeat-ui')

    if (dist < threshold && !this.player.hasWon && !this.isGameOver) {
      const intensity = 1 - dist / threshold

      if (!this.heartbeat.isPlaying) { this.heartbeat.play() }
      this.heartbeat.setVolume(intensity * 2)
      this.heartbeat.setPlaybackRate(1 + intensity)

      if (ui) {
        ui.style.opacity = String(intensity)
        ui.style.animation = `beat ${1.0 - intensity * 0.6}s infinite`
      }
    } else {
      if (this.heartbeat.isPlaying) { this.heartbeat.stop() }
      if (ui) {
        ui.style.opacity = '0'
        ui.style.animation = 'none'
      }
    }

    if (killed) {
      this.isPlaying = false
      this.isGameOver = true
      this.shouldLockPointer = false
      document.exitPointerLock()
      document.getElementById('game-over')!.classList.remove('hidden')
    }

    drawMinimap('minimap', this.world, this.player, this.ghost)
    this.renderer.render(this.scene, this.camera)
  }
}

new Game()
