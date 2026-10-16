import { useState } from 'react'
import { AppProvider, useConn } from './store'
import Overview from './pages/Overview'
import ScreenPage from './pages/ScreenPage'
import Processes from './pages/Processes'
import Files from './pages/Files'
import Terminal from './pages/Terminal'
import SettingsModal from './components/SettingsModal'

type Page = 'overview' | 'screen' | 'procs' | 'files' | 'term'

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
    id: 'screen',
    label: '屏幕镜像',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.75 2.5h12.5a.75.75 0 01.75.75v7.5a.75.75 0 01-.75.75H1.75a.75.75 0 01-.75-.75v-7.5a.75.75 0 01.75-.75zM1.5 1A1.5 1.5 0 000 2.5v7.5A1.5 1.5 0 001.5 11.5H6v1H4.75a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5H10v-1h4.5a1.5 1.5 0 001.5-1.5v-7.5A1.5 1.5 0 0014.5 1h-13z" />
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

function Shell(): JSX.Element {
  const [page, setPage] = useState<Page>('overview')
  const { state, err, settings } = useConn()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const stateText =
    state === 'connected'
      ? `已连接 ${settings?.host ?? ''}`
      : state === 'connecting'
        ? '连接中…'
        : state === 'reconnecting'
          ? '重连中…'
          : state === 'error'
            ? '连接失败'
            : '未连接'
  const dotClass =
    state === 'connected' ? 'ok' : state === 'disconnected' ? 'bad' : 'pending'

  return (
    <div className="app">
      <div className="titlebar-drag" />
      <aside className="sidebar">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-item ${page === n.id ? 'active' : ''}`}
            onClick={() => setPage(n.id)}
          >
            {n.icon}
            {n.label}
          </button>
        ))}
        <div className="sidebar-footer">
          <div>
            <span className={`status-dot ${dotClass}`} />
            {stateText}
          </div>
          {err && <div style={{ color: 'var(--red)', marginTop: 4, fontSize: 11 }}>{err}</div>}
          <button className="btn small" style={{ marginTop: 8, width: '100%' }} onClick={() => setSettingsOpen(true)}>
            ⚙ 连接设置
          </button>
        </div>
      </aside>
      <main className="content">
        {page === 'overview' && <Overview />}
        {page === 'screen' && <ScreenPage />}
        {page === 'procs' && <Processes />}
        {page === 'files' && <Files />}
        {page === 'term' && <Terminal />}
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
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
