import type { AudioListener } from 'three'

export class SoundGenerator {
  private context: BaseAudioContext

  constructor(listener: AudioListener) {
    this.context = listener.context
  }

  private createBuffer(duration: number, fill: (data: Float32Array, sr: number) => void): AudioBuffer {
    const sr = this.context.sampleRate
    const buffer = this.context.createBuffer(1, Math.ceil(duration * sr), sr)
    fill(buffer.getChannelData(0), sr)
    return buffer
  }

  getHeartbeatBuffer(): AudioBuffer {
    return this.createBuffer(0.2, (data, sr) => {
      for (let i = 0; i < data.length; i++) {
        const t = i / sr
        const freq = 60 * Math.exp(-15 * t)
        data[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-10 * t)
      }
    })
  }

  getSwitchBuffer(): AudioBuffer {
    return this.createBuffer(0.1, (data, sr) => {
      for (let i = 0; i < data.length; i++) {
        const t = i / sr
        data[i] = (Math.sin(2 * Math.PI * 400 * t) > 0 ? 0.5 : -0.5) * Math.exp(-50 * t)
      }
    })
  }

  getPickupBuffer(): AudioBuffer {
    return this.createBuffer(0.4, (data, sr) => {
      for (let i = 0; i < data.length; i++) {
        const t = i / sr
        let freq = t < 0.1 ? 900 : 1400
        if (t > 0.1 && t < 0.12) { freq = 0 }
        const val = Math.sin(2 * Math.PI * freq * t)
        data[i] = (val > 0 ? 0.3 : -0.3) * (1 - t / 0.4)
      }
    })
  }

  /** 逃脱成功：C 大调上行琶音（C5-E5-G5-C6 方波），末音拖长收尾 */
  getWinBuffer(): AudioBuffer {
    return this.createBuffer(1.0, (data, sr) => {
      const notes = [523.25, 659.25, 783.99, 1046.5]
      const step = 0.16
      for (let i = 0; i < data.length; i++) {
        const t = i / sr
        const idx = Math.min(Math.floor(t / step), 3)
        const lt = t - idx * step
        const dur = idx === 3 ? 1.0 - 3 * step : step - 0.02
        if (lt > dur) { continue }
        const decay = idx === 3 ? 6 : 14
        const sq = Math.sin(2 * Math.PI * notes[idx] * lt) > 0 ? 1 : -1
        data[i] = sq * 0.4 * Math.exp(-decay * lt)
      }
    })
  }

  /** 被幽灵抓住：开头噪声惊吓瞬态 + 低频下滑呜鸣（180→45Hz，带 5Hz 颤音） */
  getCaughtBuffer(): AudioBuffer {
    return this.createBuffer(1.2, (data, sr) => {
      // 下滑音用相位累积生成：直接按 sin(2πf(t)·t) 计算会产生扫频失真爆音
      let phase = 0
      for (let i = 0; i < data.length; i++) {
        const t = i / sr
        const freq = 180 * Math.exp(-1.15 * t)
        phase += (2 * Math.PI * freq) / sr
        const tremolo = 1 + 0.35 * Math.sin(2 * Math.PI * 5 * t)
        let v = Math.sin(phase) * 0.55 * tremolo * Math.exp(-1.2 * t)
        if (t < 0.09) {
          // 噪声振幅 0.35：与正弦最坏叠加 ≈0.9，留余量避免超 1 削波
          v += (Math.random() * 2 - 1) * 0.35 * (1 - t / 0.09)
        }
        data[i] = v
      }
    })
  }

  getGhostBuffer(): AudioBuffer {
    return this.createBuffer(2.0, (data, sr) => {
      for (let i = 0; i < data.length; i++) {
        const t = i / sr
        const mod = Math.sin(2 * Math.PI * 5 * t) * 20
        const carrier = Math.sin(2 * Math.PI * (150 + mod) * t)
        const diss = Math.sin(2 * Math.PI * (157 + mod) * t) * 0.5
        data[i] = (carrier + diss) * 0.3
      }
    })
  }
}
