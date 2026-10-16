import { useEffect, useMemo, useState } from 'react'
import { kd } from '../api'
import { useConn, useStats, fmtKB, STATE_LABEL, STATE_COLOR } from '../store'
import { ConfirmDialog } from '../components/ui'
import type { ProcInfo, ThreadInfo } from '../../../shared/types'

type SortKey = 'cpu' | 'mem' | 'pid' | 'name' | 'threads'

export default function Processes(): JSX.Element {
  const { state } = useConn()
  const { stats } = useStats()
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
      .then((t) => alive && setThreads(t))
      .catch(() => alive && setThreads(null))
      .finally(() => alive && setThreadsLoading(false))
    return () => {
      alive = false
    }
  }, [selected, stats?.ts])

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
  }, [stats, filter, hideKernel, sortKey, sortAsc, hideKernel])

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
    return <div className="empty">设备未连接</div>
  }

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', flexDirection: 'column' }}>
      <div className="page-title" style={{ marginBottom: 0 }}>
        进程 / 线程
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>
          {stats ? `${stats.procs.length} 个进程` : '等待数据…'}
        </span>
      </div>

      <div className="file-toolbar">
        <input
          className="input"
          style={{ width: 260 }}
          placeholder="按名称或 PID 过滤…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label style={{ fontSize: 13, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={hideKernel} onChange={(e) => setHideKernel(e.target.checked)} />
          隐藏内核线程
        </label>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16 }}>
        <div className="card" style={{ flex: 2, minHeight: 0, overflow: 'auto', padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                {th('pid', 'PID')}
                {th('name', '名称')}
                <th>状态</th>
                <th>CPU%</th>
                {th('mem', '内存 RSS')}
                <th>虚拟内存</th>
                {th('threads', '线程')}
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
                      {STATE_LABEL[p.state] ?? p.state}
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
                    {stats ? '没有匹配的进程' : '等待数据…'}
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
                进程详情
                <button className="btn small" style={{ float: 'right' }} onClick={() => setSelected(null)}>
                  关闭
                </button>
              </div>
              <dl className="kv" style={{ marginBottom: 12 }}>
                <dt>名称</dt>
                <dd>{selectedProc.comm}</dd>
                <dt>PID</dt>
                <dd>{selectedProc.pid}</dd>
                <dt>父进程</dt>
                <dd>{selectedProc.ppid}</dd>
                <dt>状态</dt>
                <dd>{STATE_LABEL[selectedProc.state] ?? selectedProc.state}</dd>
                <dt>CPU</dt>
                <dd>{selectedProc.cpuPercent.toFixed(1)}%</dd>
                <dt>内存 RSS</dt>
                <dd>{fmtKB(selectedProc.rssKB)}</dd>
                <dt>虚拟内存</dt>
                <dd>{fmtKB(selectedProc.vsizeKB)}</dd>
                <dt>线程数</dt>
                <dd>{selectedProc.threads}</dd>
              </dl>
              <button className="btn danger small" onClick={() => setKillTarget(selectedProc)}>
                结束进程 (kill)
              </button>

              <div className="card-title" style={{ marginTop: 16 }}>
                线程（{threads?.length ?? selectedProc.threads}）
              </div>
              {threadsLoading && !threads && <div className="empty" style={{ padding: 16 }}>读取线程…</div>}
              <table className="tbl">
                <thead>
                  <tr>
                    <th>TID</th>
                    <th>名称</th>
                    <th>状态</th>
                    <th>CPU%</th>
                  </tr>
                </thead>
                <tbody>
                  {(threads ?? []).map((t) => (
                    <tr key={t.tid}>
                      <td className="mono">{t.tid}</td>
                      <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.comm}</td>
                      <td>
                        <span style={{ color: STATE_COLOR[t.state] ?? 'var(--text-dim)' }}>
                          {STATE_LABEL[t.state] ?? t.state}
                        </span>
                      </td>
                      <td>{t.cpuPercent.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="empty" style={{ paddingTop: 120 }}>
              点击左侧进程查看详情与线程
              <br />
              <span style={{ fontSize: 12 }}>线程 CPU% 通过两次采样（间隔 0.4 秒）计算</span>
            </div>
          )}
        </div>
      </div>

      {killTarget && (
        <ConfirmDialog
          title={`结束进程 ${killTarget.comm}`}
          body={
            <>
              将向 PID {killTarget.pid}（{killTarget.comm}）发送 SIGTERM。
              <br />
              结束系统关键进程可能导致设备不稳定，需要重启恢复。确定继续吗？
            </>
          }
          confirmText="结束进程"
          danger
          onConfirm={async () => {
            const pid = killTarget.pid
            setKillTarget(null)
            const r = await kd.kill(pid, 'TERM')
            setToast(r.includes('EXIT:0') ? `已发送 SIGTERM 到 ${pid}` : `失败: ${r}`)
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
