import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { kd } from '../api'
import { useConn } from '../store'

export default function TermPage(): JSX.Element {
  const { state } = useConn()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!boxRef.current || termRef.current) return
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'SF Mono, Menlo, Consolas, monospace',
      cursorBlink: true,
      theme: {
        background: '#000000',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#1f6feb88'
      },
      scrollback: 5000,
      convertEol: false
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(boxRef.current)
    termRef.current = term
    fitRef.current = fit
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
        kd.termResize(term.cols, term.rows)
      } catch {
        /* ignore */
      }
    })
    ro.observe(boxRef.current)
    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const offData = kd.onTermData((d) => term.write(new Uint8Array(d)))
    const offExit = kd.onTermExit(() => {
      term.write('\r\n\x1b[33m― 连接已关闭，点击「重新打开」―\x1b[0m\r\n')
      setOpen(false)
    })
    const input = term.onData((data) => void kd.termInput(data))
    return () => {
      offData()
      offExit()
      input.dispose()
    }
  }, [])

  const openShell = async () => {
    const term = termRef.current
    const fit = fitRef.current
    if (!term || !fit) return
    setError('')
    try {
      fit.fit()
      term.reset()
      await kd.termOpen(term.cols, term.rows)
      setOpen(true)
      term.focus()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    if (state !== 'connected' && open) {
      void kd.termClose()
      setOpen(false)
    }
  }, [state, open])

  return (
    <div className="term-page">
      <div className="page-title" style={{ marginBottom: 0 }}>
        远程终端
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>root shell over SSH</span>
        <span style={{ flex: 1 }} />
        {state === 'connected' && !open && (
          <button className="btn primary small" onClick={() => void openShell()}>
            打开终端
          </button>
        )}
        {open && (
          <span style={{ fontSize: 12, color: 'var(--green)' }}>
            <span className="status-dot ok" />
            已连接
          </span>
        )}
      </div>
      {state !== 'connected' && <div className="empty">设备未连接</div>}
      {state === 'connected' && error && (
        <div className="card" style={{ borderColor: 'var(--red)', padding: '8px 14px', fontSize: 13 }}>
          打开失败：{error}
        </div>
      )}
      {state === 'connected' && (
        <div className="term-box" ref={boxRef} style={{ display: open ? 'block' : 'none' }} />
      )}
      {state === 'connected' && !open && !error && (
        <div className="empty" style={{ paddingTop: 120 }}>
          点击右上角「打开终端」在设备上启动 root shell
        </div>
      )}
    </div>
  )
}
