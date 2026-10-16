import { gunzipSync } from 'zlib'
import type { KindleSSH } from './kindle'
import type { ScreenFrame } from '../shared/types'

// Paperwhite 2: 虚拟宽 768（可见 758），8bpp 灰度，活跃帧缓冲在偏移 0，高度 1024
const FB_STRIDE = 768
const FB_WIDTH = 758
const FB_HEIGHT = 1024
const FB_BYTES = FB_STRIDE * FB_HEIGHT

export class ScreenService {
  private timer: NodeJS.Timeout | null = null
  private intervalMs = 0
  private busy = false
  private lastRaw: Buffer | null = null
  private lastFrame: ScreenFrame | null = null
  private onFrame: ((f: ScreenFrame) => void) | null = null
  private onError: ((msg: string) => void) | null = null
  private once = false

  start(intervalMs: number, onFrame: (f: ScreenFrame) => void, onError: (msg: string) => void): void {
    this.stop()
    this.onFrame = onFrame
    this.onError = onError
    this.intervalMs = intervalMs
    if (intervalMs <= 0) return
    // 立即抓一帧，然后按间隔轮询
    void this.capture()
    this.timer = setInterval(() => void this.capture(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.intervalMs = 0
  }

  get active(): boolean {
    return this.timer !== null || this.once
  }

  /** 手动刷新一帧（不影响轮询状态） */
  refresh(ssh: KindleSSH): void {
    void this.capture(ssh)
  }

  setOnFrame(onFrame: (f: ScreenFrame) => void, onError: (msg: string) => void): void {
    this.onFrame = onFrame
    this.onError = onError
  }

  private async capture(sshOverride?: KindleSSH): Promise<void> {
    const ssh = sshOverride ?? this.currentSsh
    if (!ssh || this.busy) return
    this.busy = true
    this.once = true
    try {
      const r = await ssh.exec(
        'dd if=/dev/fb0 bs=786432 count=1 2>/dev/null | gzip -1 -c',
        10000
      )
      this.once = false
      let raw: Buffer
      try {
        raw = gunzipSync(r.stdout)
      } catch {
        this.onError?.('屏幕数据解压失败')
        return
      }
      if (raw.length < FB_BYTES) {
        this.onError?.(`屏幕数据不完整 (${raw.length}/${FB_BYTES})`)
        return
      }
      const changed = !this.lastRaw || !this.lastRaw.equals(raw)
      this.lastRaw = raw
      // 裁掉每行右侧 10 像素的保留区
      const gray = Buffer.alloc(FB_WIDTH * FB_HEIGHT)
      for (let y = 0; y < FB_HEIGHT; y++) {
        raw.copy(gray, y * FB_WIDTH, y * FB_STRIDE, y * FB_STRIDE + FB_WIDTH)
      }
      const frame: ScreenFrame = { width: FB_WIDTH, height: FB_HEIGHT, gray, changed, ts: Date.now() }
      this.lastFrame = frame
      this.onFrame?.(frame)
    } catch (e) {
      this.once = false
      const msg = (e as Error).message
      if (!msg.includes('未连接')) this.onError?.(msg)
    } finally {
      this.busy = false
    }
  }

  private currentSsh: KindleSSH | null = null

  /** 绑定当前 SSH 连接（断线重连后调用） */
  bind(ssh: KindleSSH | null): void {
    this.currentSsh = ssh
    if (!ssh) {
      this.lastRaw = null
    }
  }

  get frame(): ScreenFrame | null {
    return this.lastFrame
  }
}
