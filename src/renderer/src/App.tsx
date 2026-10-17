import { useEffect, useState } from 'react'
import { AppProvider, useConn } from './store'
import { I18nProvider, useI18n } from './i18n'
import Overview from './pages/Overview'
import Library from './pages/Library'
import Processes from './pages/Processes'
import Files from './pages/Files'
import Terminal from './pages/Terminal'
import SettingsModal from './components/SettingsModal'
import { kd } from './api'
import { LANGS, type Lang } from '../../shared/i18n'
import type { DeviceProfile } from '../../shared/types'

type Page = 'overview' | 'library' | 'procs' | 'files' | 'term'
type ThemePref = 'auto' | 'light' | 'dark'

const PROJECT_URL = 'https://github.com/IceThunder/kindledash'

const NAV: { id: Page; labelKey: 'nav.overview' | 'nav.library' | 'nav.procs' | 'nav.files' | 'nav.term'; icon: JSX.Element }[] = [
  {
    id: 'overview',
    labelKey: 'nav.overview',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm6.5-.25A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 100-2 1 1 0 000 2z" />
      </svg>
    )
  },
  {
    id: 'library',
    labelKey: 'nav.library',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.064-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 000 2.5v11a.5.5 0 00.707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 00.78 0c.633-.79 1.814-1.019 3.223-.877 1.377.139 2.798.62 3.68 1.02A.5.5 0 0016 13.5v-11a.5.5 0 00-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783z" />
      </svg>
    )
  },
  {
    id: 'procs',
    labelKey: 'nav.procs',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2.75A2.75 2.75 0 014.75 0h6.5A2.75 2.75 0 0114 2.75v10.5A2.75 2.75 0 0111.25 16h-6.5A2.75 2.75 0 012 13.25V2.75zm8.75 3.5a.75.75 0 00-1.5 0v5.5a.75.75 0 001.5 0v-5.5zM7.25 6a.75.75 0 00-1.5 0v5.5a.75.75 0 001.5 0V6z" />
      </svg>
    )
  },
  {
    id: 'files',
    labelKey: 'nav.files',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.75 1h4.586c.464 0 .909.184 1.237.513l.673-.673A2.75 2.75 0 006.336 0H1.75A1.75 1.75 0 000 1.75v12.5A1.75 1.75 0 001.75 16h12.5A1.75 1.75 0 0016 14.25V6.164a2.75 2.75 0 00-.805-1.946l-.673.673c.329.328.513.773.513 1.237v8.086a.25.25 0 01-.25.25H1.75a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25zM8.5 5.5a.75.75 0 01.75-.75h5.5a.75.75 0 010 1.5h-5.5a.75.75 0 01-.75-.75z" />
      </svg>
    )
  },
  {
    id: 'term',
    labelKey: 'nav.term',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm9.22 2.47a.75.75 0 000-1.06L8.22 3.16a.75.75 0 00-1.06 0L3.72 6.6a.75.75 0 000 1.06l3.44 3.44a.75.75 0 001.06 0l1-1a.75.75 0 00-1.06-1.06l-.47.47L4.78 7.13 7.69 4.22l.47.47a.75.75 0 001.06 0z" />
      </svg>
    )
  }
]

function useTheme(): { theme: ThemePref; cycle: () => void; labelKey: 'theme.auto' | 'theme.light' | 'theme.dark' } {
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
  const labelKey = theme === 'auto' ? 'theme.auto' : theme === 'light' ? 'theme.light' : 'theme.dark'
  return { theme, cycle, labelKey }
}

function AboutModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useI18n()
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
          {t('about.desc1')}
          <br />
          {t('about.desc2')}
          <br />
          Electron + React + TypeScript · MIT
        </div>
        <button
          className="btn"
          onClick={() => void kd.openExternal(PROJECT_URL)}
        >
          {t('about.github')}
        </button>
        <div className="form-actions" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
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
  const { t, lang, setLang } = useI18n()
  const { cycle, labelKey } = useTheme()

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

  const stateText =
    state === 'connected'
      ? t('conn.connected')
      : state === 'connecting'
        ? t('conn.connecting')
        : state === 'reconnecting'
          ? t('conn.reconnecting')
          : state === 'error'
            ? t('conn.connFailed')
            : t('conn.disconnected')
  const dotClass = state === 'connected' ? 'ok' : state === 'disconnected' ? 'bad' : 'pending'
  const activeDevice = devices.find((d) => d.id === activeId)

  return (
    <div className="app">
      <div className="titlebar-drag" />
      <aside className="sidebar">
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
            {n.icon}
            {t(n.labelKey)}
          </button>
        ))}

        <div className="device-section">
          <div className="device-header">
            {t('conn.myDevices')}
            <button className="device-add" title={t('conn.addDevice')} onClick={() => setModal(null)}>
              ＋
            </button>
          </div>
          {devices.map((d) => {
            const isActive = d.id === activeId
            return (
              <div
                key={d.id}
                className={`device-item ${isActive ? 'active' : ''}`}
                title={isActive ? t('conn.currentDevice') : t('conn.dblclickToConnect')}
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
                  title={t('conn.edit')}
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
              {t('conn.addFirst')}
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
              title={t('menu.themeTitle', { label: t(labelKey) })}
            >
              {labelKey === 'theme.auto' ? '◐' : labelKey === 'theme.light' ? '☀' : '☾'}
            </button>
            <button
              className="btn small footer-btn footer-disconnect"
              onClick={() => void disconnect()}
              title={t('conn.disconnectTitle')}
              aria-label={t('conn.disconnectTitle')}
              disabled={state === 'disconnected'}
            >
              ⏻
            </button>
            <button
              className="btn small footer-btn"
              onClick={() => setMenuOpen((v) => !v)}
              title={t('menu.settings')}
            >
              ⚙
            </button>
          </div>

          {menuOpen && (
            <>
              <div className="menu-mask" onClick={() => setMenuOpen(false)} />
              <div className="menu-popover">
                <div className="menu-label">{t('menu.language')}</div>
                <div className="menu-langs">
                  {LANGS.map((l) => (
                    <button
                      key={l.id}
                      className={`btn small ${lang === l.id ? 'primary' : ''}`}
                      onClick={() => setLang(l.id as Lang)}
                    >
                      {l.native}
                    </button>
                  ))}
                </div>
                <div className="menu-sep" />
                <div className="menu-item disabled" title={t('menu.notOpen')}>
                  {t('menu.logs')}
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{t('menu.notOpen')}</span>
                </div>
                <div className="menu-sep" />
                <div className="menu-item" onClick={() => { setMenuOpen(false); setAboutOpen(true) }}>
                  {t('menu.about')}
                </div>
                <div
                  className="menu-item"
                  onClick={() => { setMenuOpen(false); void kd.openExternal(PROJECT_URL) }}
                >
                  {t('menu.projectUrl')}
                  <span style={{ color: 'var(--text-faint)' }}>↗</span>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
      <main className="content">
        {page === 'overview' && <Overview />}
        {page === 'library' && <Library />}
        {page === 'procs' && <Processes />}
        {page === 'files' && <Files />}
        {page === 'term' && <Terminal />}
      </main>
      {modal !== undefined && <SettingsModal editing={modal} onClose={() => setModal(undefined)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

export default function App({ initialLang }: { initialLang: Lang }): JSX.Element {
  return (
    <AppProvider>
      <I18nProvider initialLang={initialLang}>
        <Shell />
      </I18nProvider>
    </AppProvider>
  )
}
