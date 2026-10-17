import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { kd } from '../api'
import { useConn } from '../store'
import { useI18n, tNow } from '../i18n'

export default function TermPage(): JSX.Element {
  const { state } = useConn()
  const { t } = useI18n()
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
      // 事件发生在语言切换后的任意时刻，用 tNow 取当前语言的文案
      term.write(`\r\n\x1b[33m${tNow('term.closed')}\x1b[0m\r\n`)
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
        {t('nav.term')}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>root shell over SSH</span>
        <span style={{ flex: 1 }} />
        {state === 'connected' && !open && (
          <button className="btn primary small" onClick={() => void openShell()}>
            {t('term.open')}
          </button>
        )}
        {open && (
          <span style={{ fontSize: 12, color: 'var(--green)' }}>
            <span className="status-dot ok" />
            {t('conn.connected')}
          </span>
        )}
      </div>
      {state !== 'connected' && <div className="empty">{t('common.deviceNotConnected')}</div>}
      {state === 'connected' && error && (
        <div className="card" style={{ borderColor: 'var(--red)', padding: '8px 14px', fontSize: 13 }}>
          {t('term.openFailed', { err: error })}
        </div>
      )}
      {state === 'connected' && (
        <div className="term-box" ref={boxRef} style={{ display: open ? 'block' : 'none' }} />
      )}
      {state === 'connected' && !open && !error && (
        <div className="empty" style={{ paddingTop: 120 }}>
          {t('term.hint')}
        </div>
      )}
    </div>
  )
}
