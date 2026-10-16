import { useEffect, useRef, useState } from 'react'
import { kd } from '../api'
import { useConn, fmtTime } from '../store'
import type { ScreenFrame } from '../../../shared/types'

const INTERVALS = [
  { label: '关闭', ms: 0 },
  { label: '0.5 秒', ms: 500 },
  { label: '1 秒', ms: 1000 },
  { label: '2 秒', ms: 2000 },
  { label: '5 秒', ms: 5000 }
]

const NATIVE_W = 758
const NATIVE_H = 1024
const BOX_PADDING = 30 // 屏幕外框的内边距（左右/上下）

export default function ScreenPage(): JSX.Element {
  const { state } = useConn()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [intervalMs, setIntervalMs] = useState(1000)
  const [lastTs, setLastTs] = useState(0)
  const [lastChangeTs, setLastChangeTs] = useState(0)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 })
  const changeCount = useRef(0)
  const [changes, setChanges] = useState(0)
  const canvasDirty = useRef<ScreenFrame | null>(null)

  // 绘制一帧到 canvas
  const draw = (f: ScreenFrame) => {
    canvasDirty.current = f
    const canvas = canvasRef.current
    if (!canvas) return
    if (canvas.width !== f.width || canvas.height !== f.height) {
      canvas.width = f.width
      canvas.height = f.height
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(f.width, f.height)
    const px = img.data
    for (let i = 0, j = 0; i < f.gray.length; i++, j += 4) {
      const v = f.gray[i]
      px[j] = v
      px[j + 1] = v
      px[j + 2] = v
      px[j + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    setLastTs(f.ts)
    if (f.changed) {
      changeCount.current++
      setChanges(changeCount.current)
      setLastChangeTs(f.ts)
    }
  }

  useEffect(() => {
    const off = kd.onScreenFrame(draw)
    const offErr = kd.onScreenError((msg) => setError(msg))
    return () => {
      off()
      offErr()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 页面重新挂载时（如切页返回/断线），重绘主进程缓存的最后一帧
  useEffect(() => {
    if (canvasDirty.current) {
      draw(canvasDirty.current)
      return
    }
    void kd.getScreenLast().then((f) => {
      if (f) draw(f)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (state !== 'connected') return
    setError('')
    void kd.startScreen(intervalMs)
    return () => {
      void kd.stopScreen()
    }
  }, [state, intervalMs])

  // 监听画布容器尺寸 → 自适应缩放（保持 758:1024 宽高比）
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const update = () => setBoxSize({ w: box.clientWidth, h: box.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const savePng = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    await kd.saveScreenshot(canvas.toDataURL('image/png'))
  }

  const connected = state === 'connected'
  // 适应容器的缩放比，再乘用户缩放系数
  const fit =
    boxSize.w > 0 && boxSize.h > 0
      ? Math.min((boxSize.w - BOX_PADDING) / NATIVE_W, (boxSize.h - BOX_PADDING) / NATIVE_H)
      : 1
  const dispW = Math.max(80, Math.floor(NATIVE_W * fit * scale))
  const dispH = Math.max(80, Math.floor(NATIVE_H * fit * scale))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-title">
        屏幕镜像
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>
          {lastChangeTs
            ? `画面更新于 ${fmtTime(lastChangeTs)} · 已捕获 ${changes} 次变化`
            : '等待画面…'}
        </span>
      </div>

      {connected && error && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 14, padding: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 18, flex: 1, minHeight: 0 }}>
        <div
          className="screen-canvas-box"
          ref={boxRef}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto'
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ width: dispW, height: dispH, maxWidth: 'none', flexShrink: 0 }}
          />
          {!lastTs && connected && (
            <div className="empty" style={{ position: 'absolute' }}>正在获取屏幕…</div>
          )}
          {!connected && lastTs > 0 && (
            <div
              style={{
                position: 'absolute',
                bottom: 18,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(218,54,51,0.92)',
                color: '#fff',
                borderRadius: 14,
                padding: '5px 16px',
                fontSize: 12,
                whiteSpace: 'nowrap',
                zIndex: 2
              }}
            >
              连接已断开 · 显示最后画面（{fmtTime(lastChangeTs || lastTs)}），重连后自动恢复
            </div>
          )}
        </div>

        <div className="screen-side" style={{ width: 250, flexShrink: 0, overflowY: 'auto' }}>
          <div className="card">
            <div className="card-title">刷新设置</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {INTERVALS.map((it) => (
                <button
                  key={it.ms}
                  className={`btn small ${intervalMs === it.ms ? 'primary' : ''}`}
                  onClick={() => setIntervalMs(it.ms)}
                >
                  {it.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => void kd.refreshScreen()} disabled={!connected}>
                ⟳ 立即刷新
              </button>
              <button className="btn" onClick={() => void savePng()} disabled={!lastTs}>
                ⬇ 保存截图
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-title">缩放</div>
            <input
              type="range"
              min={40}
              max={180}
              value={Math.round(scale * 100)}
              onChange={(e) => setScale(parseInt(e.target.value, 10) / 100)}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>
              {Math.round(scale * 100)}%（100% = 适应窗口，原生 758 × 1024 灰度）
            </div>
          </div>

          <div className="card">
            <div className="card-title">说明</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
              通过 SSH 读取 e-ink 帧缓冲（/dev/fb0）获得当前屏幕画面。
              <br />
              墨水屏只有在内容变化时更新，静止时画面不会变化属正常现象。
              <br />
              画面随窗口大小自动缩放；断线时保留最后画面。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
