import { useEffect, useRef, useState } from 'react'
import { kd } from '../api'
import { useConn, fmtTime } from '../store'
import type { ScreenFrame } from '../../../shared/types'

const NATIVE_W = 758
const NATIVE_H = 1024
const MAX_BOX_H = 560
const BOX_PADDING = 24

/** 屏幕镜像卡片（嵌入总览页；刷新间隔由设置菜单控制） */
export default function ScreenMirror({ interval }: { interval: number }): JSX.Element {
  const { state } = useConn()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [lastTs, setLastTs] = useState(0)
  const [lastChangeTs, setLastChangeTs] = useState(0)
  const [error, setError] = useState('')
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 })
  const canvasDirty = useRef<ScreenFrame | null>(null)
  const changeCount = useRef(0)

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

  // 挂载时重绘主进程缓存的最后一帧
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
    const timer = window.setTimeout(() => {
      void kd.startScreen(interval)
    }, 1800)
    return () => {
      window.clearTimeout(timer)
      void kd.stopScreen()
    }
  }, [state, interval])

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
  const fit =
    boxSize.w > 0 && boxSize.h > 0
      ? Math.min((boxSize.w - BOX_PADDING) / NATIVE_W, (boxSize.h - BOX_PADDING) / NATIVE_H)
      : 1
  const dispW = Math.max(80, Math.floor(NATIVE_W * fit))
  const dispH = Math.max(80, Math.floor(NATIVE_H * fit))

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>屏幕镜像</span>
        <span style={{ fontWeight: 400, color: 'var(--text-faint)', fontSize: 12 }}>
          {lastChangeTs ? `更新于 ${fmtTime(lastChangeTs)}` : '等待画面…'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => void kd.refreshScreen()} disabled={!connected}>
          ⟳ 刷新
        </button>
        <button className="btn small" onClick={() => void savePng()} disabled={!lastTs}>
          ⬇ 截图
        </button>
      </div>
          <div
        className="screen-canvas-box"
        ref={boxRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
          maxHeight: MAX_BOX_H,
          background: '#000',
          borderRadius: 8
        }}
      >
        <canvas ref={canvasRef} style={{ width: dispW, height: dispH, display: 'block' }} />
        {!lastTs && connected && interval > 0 && (
          <div className="empty" style={{ position: 'absolute', color: '#8b949e', background: '#000', width: '100%', height: '100%' }}>
            正在获取屏幕…
          </div>
        )}
        {interval <= 0 && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              background: 'rgba(210,153,34,0.92)',
              color: '#fff',
              borderRadius: 12,
              padding: '3px 12px',
              fontSize: 12
            }}
          >
            自动刷新已关闭（在左下角 ⚙ 设置中开启）
          </div>
        )}
        {!connected && lastTs > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(218,54,51,0.92)',
              color: '#fff',
              borderRadius: 14,
              padding: '4px 14px',
              fontSize: 12,
              whiteSpace: 'nowrap',
              zIndex: 2
            }}
          >
            连接已断开 · 显示最后画面（{fmtTime(lastChangeTs || lastTs)}）
          </div>
        )}
      </div>
      {connected && error && (
        <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{error}</div>
      )}
    </div>
  )
}
