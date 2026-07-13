import * as THREE from 'three'
import { World } from './world'
import { Player } from './player'
import { Ghost } from './ghost'
import { drawLevelThumbnail, drawMinimap } from './minimap'
import { SoundGenerator } from './sound_generator'
import { initLocalization, t } from './localization'
import { loadingManager, texturesLoaded } from './utils'
import { BUILTIN_LEVELS, getLevelConfig, type LevelConfig } from './levels'
import { loadLevels } from './level_service'
import { isLevelUnlocked, migrateProgress } from './progress'
import { LIT_AMBIENT, LIT_FOG_FAR } from './constants'

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

  private levels: LevelConfig[] = BUILTIN_LEVELS
  private level = 1
  private levelCleared = 0

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

    this.player = new Player(this.camera, this.scene, this.world, this.listener, this.soundGen, this.ambientLight)

    this.ghost = new Ghost(this.scene, this.world, this.player, this.listener, this.soundGen)

    this.clock = new THREE.Clock()

    this.setupInput()
    void this.bootstrap()
    requestAnimationFrame(this.animate)
  }

  /** 启动引导：纹理与云端关卡都就绪后才建世界、开放开始按钮 */
  private async bootstrap(): Promise<void> {
    try {
      const [, loaded] = await Promise.all([texturesLoaded, loadLevels()])
      this.levels = loaded.levels
      if (loaded.source === 'builtin') {
        console.warn('[game] 使用内置关卡（云端不可用或暂无数据）')
      }
      const reachedRaw = Number(localStorage.getItem('levelReached') ?? NaN)
      const clearedRaw = Number(localStorage.getItem('levelCleared') ?? NaN)
      const p = migrateProgress(reachedRaw, clearedRaw, this.levels.length)
      this.level = p.level
      this.levelCleared = p.cleared
      this.buildLevel(this.level)
    } catch (e) {
      // 极端兜底：云端数据结构合法但几何异常等导致建关失败——回退内置第 1 关，
      // 与 level_service 的"关卡加载失败绝不阻塞游戏启动"原则保持一致
      console.error('[game] 启动建关失败，回退内置第 1 关：', e)
      this.levels = BUILTIN_LEVELS
      this.level = 1
      this.levelCleared = Math.min(this.levelCleared, this.levels.length)
      this.buildLevel(1)
    } finally {
      const startBtn = document.getElementById('btn-start') as HTMLButtonElement | null
      if (startBtn) {
        startBtn.disabled = false
      }
    }
  }

  /** 按关卡配置重建世界并应用环境/幽灵参数（进关、重玩、切关共用） */
  private buildLevel(n: number): void {
    const cfg = getLevelConfig(this.levels, n)
    this.world.regenerate(cfg.rooms, { doorCount: cfg.doorCount, corridorRects: cfg.corridorRects })
    this.updateSwitchInfo()
    this.player.reset()
    this.ghost.reset()
    this.player.spawn()
    this.ghost.spawn()
    this.applyLevelConfig(cfg)
  }

  private applyLevelConfig(cfg: LevelConfig): void {
    this.ghost.setSpeed(cfg.ghostSpeed)
    this.ghost.setEnabled(cfg.ghostEnabled)
    this.player.setEnvDark(cfg.darkAmbient, cfg.darkFogFar)

    const fog = this.scene.fog as THREE.Fog
    if (cfg.lightsOn && this.world.lightSwitch) {
      // 开局灯已亮：开关拨到 ON，环境用统一亮值
      this.world.lightSwitch.isOn = true
      this.world.lightSwitch.handle.rotation.x = Math.PI / 4
      this.ambientLight.intensity = LIT_AMBIENT
      fog.far = LIT_FOG_FAR
    } else {
      this.ambientLight.intensity = cfg.darkAmbient
      fog.far = cfg.darkFogFar
    }

    const infoLevel = document.getElementById('info-level')
    if (infoLevel) {
      infoLevel.innerText = t('levelLabel', { n: this.level })
    }
  }

  /** 渲染选关卡片：每关一张地图缩略图卡片，已解锁可点、未解锁灰显加锁、当前关橙框 */
  private renderLevelGrid(): void {
    const grid = document.getElementById('level-grid')
    if (!grid) {
      return
    }
    grid.innerHTML = ''
    for (let n = 1; n <= this.levels.length; n++) {
      const btn = document.createElement('button')
      btn.className = 'level-card'

      const thumb = document.createElement('canvas')
      thumb.width = 100
      thumb.height = 100
      drawLevelThumbnail(thumb, this.levels[n - 1])
      btn.appendChild(thumb)

      const no = document.createElement('span')
      no.className = 'level-card-no'
      no.textContent = String(n)
      btn.appendChild(no)

      const unlocked = isLevelUnlocked(n, this.levelCleared)
      if (!unlocked) {
        btn.classList.add('locked')
        btn.disabled = true
        btn.title = t('lockedTip')
        const lock = document.createElement('span')
        lock.className = 'level-card-lock'
        lock.textContent = '🔒'
        btn.appendChild(lock)
      }
      if (n === this.level) {
        btn.classList.add('current')
      }
      btn.addEventListener('click', () => this.startGame(n))
      grid.appendChild(btn)
    }
  }

  /** 打开选关面板：主菜单「开始游戏」与游戏内「返回选关」的共同入口 */
  private showLevelSelect(): void {
    this.renderLevelGrid()
    document.getElementById('menu')!.classList.add('hidden')
    document.getElementById('level-panel')!.classList.remove('hidden')
  }

  /** 选关面板「返回主菜单」：回到首屏（标题 / 说明 / 鼠标速度设置） */
  private backToMainMenu(): void {
    document.getElementById('level-panel')!.classList.add('hidden')
    document.getElementById('menu')!.classList.remove('hidden')
  }

  /** 从选关面板进入第 n 关 */
  private startGame(n: number): void {
    if (!isLevelUnlocked(n, this.levelCleared)) {
      return
    }
    if (this.listener.context.state === 'suspended') {
      void this.listener.context.resume()
    }
    this.level = n
    localStorage.setItem('levelReached', String(n))
    this.buildLevel(n)
    document.getElementById('menu')!.classList.add('hidden')
    document.getElementById('level-panel')!.classList.add('hidden')
    this.enterPlay()
  }

  /** 通用"进入游玩态"：隐藏结算层、锁指针、复位时钟 */
  private enterPlay(): void {
    document.getElementById('game-over')!.classList.add('hidden')
    document.getElementById('game-win')!.classList.add('hidden')
    document.getElementById('pause-menu')!.classList.add('hidden')
    document.getElementById('game-info')!.style.display = 'block'
    const minimap = document.getElementById('minimap')
    if (minimap) {
      minimap.style.display = 'block'
    }

    const cabinetOverlay = document.getElementById('cabinet-overlay')
    if (cabinetOverlay) {
      cabinetOverlay.style.display = 'none'
    }
    const interactionMsg = document.getElementById('interaction-msg')
    if (interactionMsg) {
      interactionMsg.style.display = 'none'
    }
    this.stopHeartbeatUI()

    this.isGameOver = false
    this.isPaused = false
    this.isPlaying = true
    this.shouldLockPointer = true
    this.clock.getDelta()
    document.body.requestPointerLock()
    this.syncMouseSensitivityToSliders()
  }

  /** 游戏内退出回选关面板：胜利/死亡/暂停三处「返回选关」共用 */
  private showMenu(): void {
    this.isPlaying = false
    this.isPaused = false
    this.isGameOver = false
    this.shouldLockPointer = false
    document.exitPointerLock()
    this.stopHeartbeatUI()
    document.getElementById('game-over')!.classList.add('hidden')
    document.getElementById('game-win')!.classList.add('hidden')
    document.getElementById('pause-menu')!.classList.add('hidden')
    document.getElementById('game-info')!.style.display = 'none'
    const minimap = document.getElementById('minimap')
    if (minimap) {
      minimap.style.display = 'none'
    }
    this.showLevelSelect()
  }

  /** 停心跳音效与 UI（多处复用） */
  private stopHeartbeatUI(): void {
    if (this.heartbeat.isPlaying) {
      this.heartbeat.stop()
    }
    const heartbeatUi = document.getElementById('heartbeat-ui')
    if (heartbeatUi) {
      heartbeatUi.style.opacity = '0'
      heartbeatUi.style.animation = 'none'
    }
  }

  /**
   * 绑定资源加载进度 UI：进度条根据 loadingManager 事件更新，
   * texturesLoaded resolve 后隐藏进度条（「开始游戏」按钮的启用由 bootstrap 统一负责）。
   */
  private setupLoader(): void {
    const barFill = document.getElementById('loader-bar-fill')
    const pctText = document.getElementById('loader-percent')
    const loaderArea = document.getElementById('loader-area')

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
            target.closest('#level-panel') ||
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

    document.getElementById('btn-start')?.addEventListener('click', () => this.showLevelSelect())
    document.getElementById('level-back-btn')?.addEventListener('click', () => this.backToMainMenu())

    document.getElementById('btn-resume')?.addEventListener('click', () => this.togglePauseMenu())
    document.getElementById('btn-restart')?.addEventListener('click', () => this.restart())
    document.getElementById('respawn-btn')?.addEventListener('click', () => this.restart())
    document.getElementById('next-level-btn')?.addEventListener('click', () => {
      this.level = Math.min(this.level + 1, this.levels.length)
      localStorage.setItem('levelReached', String(this.level))
      this.buildLevel(this.level)
      this.enterPlay()
    })
    document.getElementById('win-menu-btn')?.addEventListener('click', () => this.showMenu())
    document.getElementById('dead-menu-btn')?.addEventListener('click', () => this.showMenu())
    document.getElementById('btn-menu')?.addEventListener('click', () => this.showMenu())

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
    this.buildLevel(this.level)
    this.enterPlay()
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

      this.levelCleared = Math.max(this.levelCleared, this.level)
      localStorage.setItem('levelCleared', String(this.levelCleared))
      const wonAll = this.level >= this.levels.length
      localStorage.setItem('levelReached', String(wonAll ? 1 : this.level + 1))
      if (wonAll) {
        // 全通关：内存关卡同步回 1，与 levelReached 一致（返回选关后从头开新轮）
        this.level = 1
      }

      const escapedText = document.getElementById('escaped-text')
      if (escapedText) {
        escapedText.innerText = wonAll ? t('allCleared') : t('escaped')
      }
      const nextBtn = document.getElementById('next-level-btn') as HTMLButtonElement | null
      if (nextBtn) {
        nextBtn.style.display = wonAll ? 'none' : 'inline-block'
      }
      document.getElementById('game-win')!.classList.remove('hidden')
    }

    const killed = this.ghost.update(dt)

    // Heartbeat
    const dist = this.player.pos.distanceTo(this.ghost.mesh.position)
    const threshold = 15
    const ui = document.getElementById('heartbeat-ui')

    if (this.ghost.isEnabled && dist < threshold && !this.player.hasWon && !this.isGameOver) {
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
