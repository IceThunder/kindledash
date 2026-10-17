import { useEffect, useState } from 'react'
import { AppProvider, useConn } from './store'
import Overview from './pages/Overview'
import Processes from './pages/Processes'
import Files from './pages/Files'
import Terminal from './pages/Terminal'
import SettingsModal from './components/SettingsModal'
import { kd } from './api'
import type { DeviceProfile } from '../../shared/types'

type Page = 'overview' | 'procs' | 'files' | 'term'
type ThemePref = 'auto' | 'light' | 'dark'

const PROJECT_URL = 'https://github.com/IceThunder/kindledash'
const REFRESH_OPTIONS = [
  { label: '关闭', ms: 0 },
  { label: '0.5 秒', ms: 500 },
  { label: '1 秒', ms: 1000 },
  { label: '2 秒', ms: 2000 },
  { label: '5 秒', ms: 5000 }
]

const NAV: { id: Page; label: string; icon: JSX.Element }[] = [
  {
    id: 'overview',
    label: '总览',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm6.5-.25A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 100-2 1 1 0 000 2z" />
      </svg>
    )
  },
  {
    id: 'procs',
    label: '进程 / 线程',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2.75A2.75 2.75 0 014.75 0h6.5A2.75 2.75 0 0114 2.75v10.5A2.75 2.75 0 0111.25 16h-6.5A2.75 2.75 0 012 13.25V2.75zm8.75 3.5a.75.75 0 00-1.5 0v5.5a.75.75 0 001.5 0v-5.5zM7.25 6a.75.75 0 00-1.5 0v5.5a.75.75 0 001.5 0V6z" />
      </svg>
    )
  },
  {
    id: 'files',
    label: '文件管理',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.75 1h4.586c.464 0 .909.184 1.237.513l.673-.673A2.75 2.75 0 006.336 0H1.75A1.75 1.75 0 000 1.75v12.5A1.75 1.75 0 001.75 16h12.5A1.75 1.75 0 0016 14.25V6.164a2.75 2.75 0 00-.805-1.946l-.673.673c.329.328.513.773.513 1.237v8.086a.25.25 0 01-.25.25H1.75a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25zM8.5 5.5a.75.75 0 01.75-.75h5.5a.75.75 0 010 1.5h-5.5a.75.75 0 01-.75-.75z" />
      </svg>
    )
  },
  {
    id: 'term',
    label: '远程终端',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm9.22 2.47a.75.75 0 000-1.06L8.22 3.16a.75.75 0 00-1.06 0L3.72 6.6a.75.75 0 000 1.06l3.44 3.44a.75.75 0 001.06 0l1-1a.75.75 0 00-1.06-1.06l-.47.47L4.78 7.13 7.69 4.22l.47.47a.75.75 0 001.06 0z" />
      </svg>
    )
  }
]

function useTheme(): { theme: ThemePref; cycle: () => void; label: string } {
  const [theme, setTheme] = useState<ThemePref>(() => {
    const saved = localStorage.getItem('kd.theme')
    return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto'
  })
  useEffect(() => {
    localStorage.setItem('kd.theme', theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const resolved =
        theme === 'auto' ? (mq.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    const onChange = () => theme === 'auto' && apply()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
  const cycle = () => setTheme((t) => (t === 'auto' ? 'light' : t === 'light' ? 'dark' : 'auto'))
  const label = theme === 'auto' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'
  return { theme, cycle, label }
}

function AboutModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void kd.appVersion().then(setVersion)
  }, [])
  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 400, textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 6 }}>📖</div>
        <h3 style={{ marginBottom: 2 }}>KindleDash</h3>
        <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 14 }}>v{version || '…'}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 16 }}>
          越狱 Kindle 管理工具 — 屏幕镜像 / 性能监控
          <br />
          进程线程 / 文件管理 / 远程终端
          <br />
          Electron + React + TypeScript · MIT
        </div>
        <button
          className="btn"
          onClick={() => void kd.openExternal(PROJECT_URL)}
        >
          GitHub 项目地址 ↗
        </button>
        <div className="form-actions" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

function Shell(): JSX.Element {
  const [page, setPage] = useState<Page>('overview')
  const { state, err, devices, activeId, connectDevice, disconnect } = useConn()
  // undefined = 关闭设备编辑弹窗；null = 新增；DeviceProfile = 编辑
  const [modal, setModal] = useState<DeviceProfile | null | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const { cycle, label } = useTheme()
  const [screenInterval, setScreenInterval] = useState(() =>
    parseInt(localStorage.getItem('kd.screen.interval') ?? '5000', 10)
  )

  // Kindle 端性能脚本会扫描整个 /proc，只有总览和进程页可见时才轮询。
  // 3 秒一拍足够观察趋势，也避免文件/终端页面在后台持续占用 SSH 通道。
  useEffect(() => {
    if (state !== 'connected' || (page !== 'overview' && page !== 'procs')) {
      void kd.stopStats()
      return
    }
    const timer = window.setTimeout(() => {
      void kd.startStats(3000, page === 'procs')
    }, 1200)
    return () => {
      window.clearTimeout(timer)
      void kd.stopStats()
    }
  }, [state, page])

  const changeInterval = (ms: number) => {
    setScreenInterval(ms)
    localStorage.setItem('kd.screen.interval', String(ms))
  }

  const stateText =
    state === 'connected' ? '已连接' : state === 'connecting' ? '连接中…' : state === 'reconnecting' ? '重连中…' : state === 'error' ? '连接失败' : '未连接'
  const dotClass = state === 'connected' ? 'ok' : state === 'disconnected' ? 'bad' : 'pending'
  const activeDevice = devices.find((d) => d.id === activeId)

  return (
    <div className="app">
      <div className="titlebar-drag" />
      <aside className="sidebar">
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            {n.icon}
            {n.label}
          </button>
        ))}

        <div className="device-section">
          <div className="device-header">
            我的设备
            <button className="device-add" title="添加设备" onClick={() => setModal(null)}>
              ＋
            </button>
          </div>
          {devices.map((d) => {
            const isActive = d.id === activeId
            return (
              <div
                key={d.id}
                className={`device-item ${isActive ? 'active' : ''}`}
                title={isActive ? '当前设备' : '双击设备名称连接'}
              >
                <span className={`status-dot ${isActive ? dotClass : 'bad'}`} />
                <span
                  className="device-name"
                  title={d.deviceName ? d.deviceName : d.name || d.host}
                  onDoubleClick={() => !isActive && void connectDevice(d)}
                >
                  {d.name || d.host}
                </span>
                <button
                  className="device-edit"
                  title="编辑"
                  onClick={(e) => {
                    e.stopPropagation()
                    setModal(d)
                  }}
                >
                  ✎
                </button>
              </div>
            )
          })}
          {!devices.length && (
            <div className="device-empty" onClick={() => setModal(null)}>
              ＋ 添加第一台设备
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <div>
            <span className={`status-dot ${dotClass}`} />
            {stateText}
            {activeDevice ? ` · ${activeDevice.host}` : ''}
          </div>
          {err && <div style={{ color: 'var(--red)', marginTop: 4, fontSize: 11 }}>{err}</div>}
          <div className="footer-btns">
            <button
              className="btn small footer-btn"
              onClick={cycle}
              title={`主题：${label}（点击切换）`}
            >
              {label === '跟随系统' ? '◐' : label === '浅色' ? '☀' : '☾'}
            </button>
            <button
              className="btn small footer-btn footer-disconnect"
              onClick={() => void disconnect()}
              title="快速断开连接"
              aria-label="快速断开连接"
              disabled={state === 'disconnected'}
            >
              ⏻
            </button>
            <button
              className="btn small footer-btn"
              onClick={() => setMenuOpen((v) => !v)}
              title="设置"
            >
              ⚙
            </button>
          </div>

          {menuOpen && (
            <>
              <div className="menu-mask" onClick={() => setMenuOpen(false)} />
              <div className="menu-popover">
                <div className="menu-label">屏幕刷新间隔</div>
                <div className="menu-intervals">
                  {REFRESH_OPTIONS.map((o) => (
                    <button
                      key={o.ms}
                      className={`btn small ${screenInterval === o.ms ? 'primary' : ''}`}
                      onClick={() => changeInterval(o.ms)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="menu-sep" />
                <div className="menu-item disabled" title="下一阶段开发">
                  日志
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>未开放</span>
                </div>
                <div className="menu-sep" />
                <div className="menu-item" onClick={() => { setMenuOpen(false); setAboutOpen(true) }}>
                  关于 KindleDash
                </div>
                <div
                  className="menu-item"
                  onClick={() => { setMenuOpen(false); void kd.openExternal(PROJECT_URL) }}
                >
                  项目地址
                  <span style={{ color: 'var(--text-faint)' }}>↗</span>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
      <main className="content">
        {page === 'overview' && <Overview screenInterval={screenInterval} />}
        {page === 'procs' && <Processes />}
        {page === 'files' && <Files />}
        {page === 'term' && <Terminal />}
      </main>
      {modal !== undefined && <SettingsModal editing={modal} onClose={() => setModal(undefined)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

export default function App(): JSX.Element {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
