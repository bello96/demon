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
