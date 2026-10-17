import { useEffect, useMemo, useState } from 'react'
import { kd } from '../api'
import { useConn, useStats, fmtKB, stateLabel, STATE_COLOR } from '../store'
import { useI18n } from '../i18n'
import { ConfirmDialog, Sparkline, Ring } from '../components/ui'
import type { ProcInfo, ThreadInfo } from '../../../shared/types'

type SortKey = 'cpu' | 'mem' | 'pid' | 'name' | 'threads'

export default function Processes(): JSX.Element {
  const { state } = useConn()
  const { stats, history } = useStats()
  const { t } = useI18n()
  const [filter, setFilter] = useState('')
  const [hideKernel, setHideKernel] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('cpu')
  const [sortAsc, setSortAsc] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [threads, setThreads] = useState<ThreadInfo[] | null>(null)
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [killTarget, setKillTarget] = useState<ProcInfo | null>(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (selected == null) {
      setThreads(null)
      return
    }
    let alive = true
    setThreadsLoading(true)
    void kd
      .listThreads(selected)
      .then((th) => alive && setThreads(th))
      .catch(() => alive && setThreads(null))
      .finally(() => alive && setThreadsLoading(false))
    return () => {
      alive = false
    }
  }, [selected])

  const refreshThreads = () => {
    if (selected == null) return
    setThreadsLoading(true)
    void kd
      .listThreads(selected)
      .then(setThreads)
      .catch(() => setThreads(null))
      .finally(() => setThreadsLoading(false))
  }

  const procs = useMemo(() => {
    let list = stats?.procs ?? []
    if (hideKernel) list = list.filter((p) => !p.kernelThread)
    if (filter.trim()) {
      const q = filter.trim().toLowerCase()
      list = list.filter((p) => p.comm.toLowerCase().includes(q) || String(p.pid).includes(q))
    }
    const dir = sortAsc ? 1 : -1
    const sorted = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'cpu':
          return (a.cpuPercent - b.cpuPercent) * dir
        case 'mem':
          return (a.rssKB - b.rssKB) * dir
        case 'pid':
          return (a.pid - b.pid) * dir
        case 'threads':
          return (a.threads - b.threads) * dir
        case 'name':
          return a.comm.localeCompare(b.comm) * dir
      }
    })
    return sorted
  }, [stats, filter, hideKernel, sortKey, sortAsc])

  const selectedProc = procs.find((p) => p.pid === selected) ?? stats?.procs.find((p) => p.pid === selected) ?? null

  const th = (key: SortKey, label: string) => (
    <th
      onClick={() => {
        if (sortKey === key) setSortAsc(!sortAsc)
        else {
          setSortKey(key)
          setSortAsc(false)
        }
      }}
    >
      {label}
      {sortKey === key && (sortAsc ? ' ↑' : ' ↓')}
    </th>
  )

  if (state !== 'connected') {
    return <div className="empty">{t('common.deviceNotConnected')}</div>
  }

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', flexDirection: 'column' }}>
      <div className="page-title" style={{ marginBottom: 0 }}>
        {t('nav.procs')}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>
          {stats ? t('procs.count', { n: stats.procs.length }) : t('common.waitingData')}
        </span>
      </div>

      <div className="process-telemetry">
        <div className="card">
          <div className="card-title">{t('procs.cpuTitle')}</div>
          {stats ? (
            <>
              <Sparkline data={history.cpu} max={100} color="#58a6ff" height={105} />
              <div className="process-telemetry-caption">
                <span>{t('procs.recentSeconds', { n: history.cpu.length })}</span>
                <span>{t('procs.load', { v: stats.load.map((l) => l.toFixed(2)).join(' / ') })}</span>
              </div>
            </>
          ) : <div className="empty" style={{ padding: 30 }}>{t('common.waitingData')}</div>}
        </div>
        <div className="card">
          <div className="card-title">{t('procs.memTitle')}</div>
          {stats?.mem ? (() => {
            const mem = stats.mem
            const usedPct = mem.totalKB ? (mem.usedKB / mem.totalKB) * 100 : 0
            const cachePct = mem.totalKB ? (mem.cachedKB / mem.totalKB) * 100 : 0
            const swapUsedKB = mem.swapTotalKB - mem.swapFreeKB
            const swapPct = mem.swapTotalKB ? (swapUsedKB / mem.swapTotalKB) * 100 : 0
            return <div className="process-memory-rings">
              <Ring percent={usedPct} label={t('procs.memApp')} value={`${Math.round(usedPct)}%`} color="#bc8cff" size={88} />
              <Ring percent={cachePct} label={t('procs.memCache')} value={fmtKB(mem.cachedKB)} color="#58a6ff" size={88} />
              <Ring percent={mem.totalKB ? (mem.buffersKB / mem.totalKB) * 100 : 0} label="Buffers" value={fmtKB(mem.buffersKB)} color="#d29922" size={88} />
              <Ring percent={swapPct} label="Swap" value={fmtKB(swapUsedKB)} color={swapPct > 60 ? '#f85149' : '#3fb950'} size={88} />
              <Ring percent={mem.totalKB ? (mem.freeKB / mem.totalKB) * 100 : 0} label={t('procs.memFree')} value={fmtKB(mem.freeKB)} color="#8b949e" size={88} />
            </div>
          })() : <div className="empty" style={{ padding: 30 }}>{t('common.waitingData')}</div>}
        </div>
      </div>

      <div className="file-toolbar">
        <input
          className="input"
          style={{ width: 260 }}
          placeholder={t('procs.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label style={{ fontSize: 13, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={hideKernel} onChange={(e) => setHideKernel(e.target.checked)} />
          {t('procs.hideKernel')}
        </label>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16 }}>
        <div className="card" style={{ flex: 2, minHeight: 0, overflow: 'auto', padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                {th('pid', 'PID')}
                {th('name', t('files.colName'))}
                <th>{t('procs.colState')}</th>
                <th>CPU%</th>
                {th('mem', t('procs.colRss'))}
                <th>{t('procs.colVsize')}</th>
                {th('threads', t('procs.colThreads'))}
              </tr>
            </thead>
            <tbody>
              {procs.map((p) => (
                <tr
                  key={p.pid}
                  className={selected === p.pid ? 'selected' : ''}
                  onClick={() => setSelected(p.pid)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="mono">{p.pid}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.kernelThread && <span style={{ color: 'var(--text-faint)' }}>[{p.comm}]</span>}
                    {!p.kernelThread && p.comm}
                  </td>
                  <td>
                    <span className="badge" style={{ background: (STATE_COLOR[p.state] ?? '#8b949e') + '26', color: STATE_COLOR[p.state] ?? 'var(--text-dim)' }}>
                      {stateLabel(p.state)}
                    </span>
                  </td>
                  <td style={{ color: p.cpuPercent > 30 ? 'var(--yellow)' : p.cpuPercent > 0 ? 'var(--green)' : 'var(--text-faint)' }}>
                    {p.cpuPercent.toFixed(1)}
                  </td>
                  <td>{fmtKB(p.rssKB)}</td>
                  <td style={{ color: 'var(--text-faint)' }}>{fmtKB(p.vsizeKB)}</td>
                  <td>{p.threads}</td>
                </tr>
              ))}
              {!procs.length && (
                <tr>
                  <td colSpan={7} className="empty">
                    {stats ? t('procs.noMatch') : t('common.waitingData')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ width: 380, flexShrink: 0, overflow: 'auto' }}>
          {selectedProc ? (
            <>
              <div className="card-title">
                {t('procs.detail')}
                <button className="btn small" style={{ float: 'right', marginRight: 6 }} onClick={refreshThreads} disabled={threadsLoading}>
                  {threadsLoading ? t('common.loading') : t('procs.refreshThreads')}
                </button>
                <button className="btn small" style={{ float: 'right' }} onClick={() => setSelected(null)}>
                  {t('common.close')}
                </button>
              </div>
              <dl className="kv" style={{ marginBottom: 12 }}>
                <dt>{t('files.colName')}</dt>
                <dd>{selectedProc.comm}</dd>
                <dt>PID</dt>
                <dd>{selectedProc.pid}</dd>
                <dt>{t('procs.ppid')}</dt>
                <dd>{selectedProc.ppid}</dd>
                <dt>{t('procs.colState')}</dt>
                <dd>{stateLabel(selectedProc.state)}</dd>
                <dt>CPU</dt>
                <dd>{selectedProc.cpuPercent.toFixed(1)}%</dd>
                <dt>{t('procs.colRss')}</dt>
                <dd>{fmtKB(selectedProc.rssKB)}</dd>
                <dt>{t('procs.colVsize')}</dt>
                <dd>{fmtKB(selectedProc.vsizeKB)}</dd>
                <dt>{t('procs.threadsCount')}</dt>
                <dd>{selectedProc.threads}</dd>
              </dl>
              <button className="btn danger small" onClick={() => setKillTarget(selectedProc)}>
                {t('procs.kill')}
              </button>

              <div className="card-title" style={{ marginTop: 16 }}>
                {t('procs.threadsOf', { n: threads?.length ?? selectedProc.threads })}
              </div>
              {threadsLoading && !threads && <div className="empty" style={{ padding: 16 }}>{t('procs.loadingThreads')}</div>}
              <table className="tbl">
                <thead>
                  <tr>
                    <th>TID</th>
                    <th>{t('files.colName')}</th>
                    <th>{t('procs.colState')}</th>
                    <th>CPU%</th>
                  </tr>
                </thead>
                <tbody>
                  {(threads ?? []).map((tr) => (
                    <tr key={tr.tid}>
                      <td className="mono">{tr.tid}</td>
                      <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tr.comm}</td>
                      <td>
                        <span style={{ color: STATE_COLOR[tr.state] ?? 'var(--text-dim)' }}>
                          {stateLabel(tr.state)}
                        </span>
                      </td>
                      <td>{tr.cpuPercent.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="empty" style={{ paddingTop: 120 }}>
              {t('procs.detailHint')}
              <br />
              <span style={{ fontSize: 12 }}>{t('procs.threadCpuHint')}</span>
            </div>
          )}
        </div>
      </div>

      {killTarget && (
        <ConfirmDialog
          title={t('procs.killTitle', { name: killTarget.comm })}
          body={
            <>
              {t('procs.killBodyA', { pid: killTarget.pid, name: killTarget.comm })}
              <br />
              {t('procs.killBody2')}
            </>
          }
          confirmText={t('procs.killConfirm')}
          danger
          onConfirm={async () => {
            const pid = killTarget.pid
            setKillTarget(null)
            const r = await kd.kill(pid, 'TERM')
            setToast(r.includes('EXIT:0') ? t('procs.killSent', { pid }) : t('procs.killFailed', { r }))
            setTimeout(() => setToast(''), 3000)
          }}
          onCancel={() => setKillTarget(null)}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-panel-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 18px', fontSize: 13, zIndex: 200 }}>
          {toast}
        </div>
      )}
    </div>
  )
}
