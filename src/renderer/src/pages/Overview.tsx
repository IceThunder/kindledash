import { useEffect, useState } from 'react'
import { kd } from '../api'
import { useConn, useStats, fmtKB, fmtUptime } from '../store'
import { ConfirmDialog, Ring } from '../components/ui'
import ScreenMirror from '../components/ScreenMirror'
import Cleanup from '../components/Cleanup'
import type { DeviceInfo } from '../../../shared/types'

/** 序列号脱敏：首 5 位 + … + 尾 4 位 */
function maskSerial(s: string): string {
  if (!s || s.length <= 10) return s
  return `${s.slice(0, 5)}…${s.slice(-4)}`
}

export default function Overview({ screenInterval }: { screenInterval: number }): JSX.Element {
  const { state } = useConn()
  const { stats } = useStats()
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [err, setErr] = useState('')
  const [storage, setStorage] = useState<import('../../../shared/types').StorageInfo[] | null>(null)
  const [storageOpen, setStorageOpen] = useState(false)
  const [storageLoading, setStorageLoading] = useState(false)
  const [confirmReboot, setConfirmReboot] = useState(false)
  const [showSerial, setShowSerial] = useState(false)

  useEffect(() => {
    if (state !== 'connected') {
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void kd
        .getDeviceInfo()
        .then((value) => active && setInfo(value))
        .catch((e) => active && setErr((e as Error).message))
    }, 800)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [state])

  if (state !== 'connected' && !stats) {
    return <div className="empty">设备未连接 — 请点击左下角「连接设置」配置 SSH 并连接</div>
  }
  const live = state === 'connected'

  const battery = stats?.battery
  const toggleStorage = () => {
    const next = !storageOpen
    setStorageOpen(next)
    if (next && storage === null && !storageLoading) {
      setStorageLoading(true)
      void kd.getStorageInfo()
        .then(setStorage)
        .catch((e) => setErr((e as Error).message))
        .finally(() => setStorageLoading(false))
    }
  }

  return (
    <div>
      <div className="page-title">
        总览
        <button className="btn small" onClick={() => void kd.getDeviceInfo().then(setInfo)}>
          刷新
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn danger small" onClick={() => setConfirmReboot(true)}>
          重启设备
        </button>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 14 }}>读取设备信息失败：{err}</div>}
      {!live && stats && (
        <div className="card" style={{ borderColor: 'var(--yellow)', marginBottom: 14, padding: '8px 16px', fontSize: 13 }}>
          连接已断开 · 显示最后的数据（{new Date(stats.ts).toLocaleTimeString('zh-CN', { hour12: false })}），重连后自动恢复
        </div>
      )}

      <div className="overview-hero">
        <div className="overview-screen">
          <ScreenMirror interval={screenInterval} />
        </div>
        <div className="overview-summary">
          <div className="card overview-stat-row">
            {(() => {
              const pct = battery?.capacity ?? null
              const color =
                pct == null ? 'var(--text-faint)' : pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--yellow)' : 'var(--red)'
              const sub =
                battery?.voltageMV != null
                  ? `${(battery.voltageMV / 1000).toFixed(2)} V${
                      battery.currentMA != null ? ` · ${battery.currentMA > 0 ? '+' : ''}${battery.currentMA} mA` : ''
                    }`
                  : '电池'
              return <Ring percent={pct ?? 0} size={92} color={color} label={sub} value={pct != null ? `${pct}%` : '—'} />
            })()}
            {(() => {
              const t = battery?.temperatureC ?? null
              const color = t == null ? 'var(--text-faint)' : t < 40 ? 'var(--green)' : t < 50 ? 'var(--yellow)' : 'var(--red)'
              return (
                <Ring
                  percent={t == null ? 0 : Math.min(100, (t / 60) * 100)}
                  size={92}
                  color={color}
                  label="电池温度"
                  value={t != null ? `${t}°C` : '—'}
                />
              )
            })()}
            <div className="stat-uptime">
              <div className="stat-uptime-label">运行时间</div>
              <div className="stat-uptime-value">{stats ? fmtUptime(stats.uptime) : '…'}</div>
              {stats && (
                <div className="stat-uptime-sub">
                  开机于{' '}
                  {new Date(Date.now() - stats.uptime * 1000).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="card overview-hardware">
            <div className="card-title">硬件信息</div>
            {info ? (
              <dl className="kv">
                <dt>设备名称</dt>
                <dd>{info.deviceName ?? info.model}</dd>
                <dt>处理器</dt>
                <dd>{info.cpuModel} · {info.cpuCores} 核</dd>
                <dt>内存</dt>
                <dd>{info.ramTotalKB ? fmtKB(info.ramTotalKB) : '—'}</dd>
                <dt>序列号</dt>
                <dd style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{showSerial ? info.serial || '—' : maskSerial(info.serial) || '—'}</span>
                  {info.serial && info.serial.length > 10 && (
                    <button className="btn small" onClick={() => setShowSerial((v) => !v)}>
                      {showSerial ? '隐藏' : '显示完整序列号'}
                    </button>
                  )}
                </dd>
                <dt>主板 ID</dt>
                <dd>{info.boardId || '—'}</dd>
                <dt>硬件平台</dt>
                <dd>{info.hardware || '—'}</dd>
                <dt>内核版本</dt>
                <dd>{info.kernel}</dd>
              </dl>
            ) : (
              <div className="empty" style={{ padding: 36 }}>读取中…</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', marginBottom: storageOpen ? 10 : 0 }}>
          <span>存储分区</span>
          <span style={{ flex: 1 }} />
          <button className="btn small" onClick={toggleStorage} disabled={storageLoading}>
            {storageLoading ? '读取中…' : storageOpen ? '收起' : '查看分区'}
          </button>
        </div>
        {storageOpen && <table className="tbl">
          <thead>
            <tr>
              <th>挂载点</th>
              <th>总容量</th>
              <th>已用</th>
              <th>可用</th>
              <th style={{ width: '40%' }}>使用率</th>
            </tr>
          </thead>
          <tbody>
            {(storage ?? []).map((s) => {
              const pct = s.totalKB ? Math.round((s.usedKB / s.totalKB) * 100) : 0
              return (
                <tr key={s.mount}>
                  <td className="mono">{s.mount}</td>
                  <td>{fmtKB(s.totalKB)}</td>
                  <td>{fmtKB(s.usedKB)}</td>
                  <td>{fmtKB(s.availKB)}</td>
                  <td>
                    <div className="progress-bar">
                      <div style={{ width: `${pct}%`, background: pct > 90 ? 'var(--red)' : pct > 70 ? 'var(--yellow)' : 'var(--green)' }} />
                    </div>
                  </td>
                </tr>
              )
            })}
            {!storage && (
              <tr>
                <td colSpan={5} className="empty">
                  等待数据…
                </td>
              </tr>
            )}
          </tbody>
        </table>}
      </div>

      <div style={{ marginBottom: 14 }} />

      <Cleanup connected={live} />

      {confirmReboot && (
        <ConfirmDialog
          title="重启 Kindle"
          body={
            <>
              确定要重启设备吗？
              <br />
              重启后 SSH 服务可能需要一两分钟才能恢复，应用会自动重连。
            </>
          }
          confirmText="重启"
          danger
          onConfirm={() => {
            setConfirmReboot(false)
            void kd.reboot()
          }}
          onCancel={() => setConfirmReboot(false)}
        />
      )}
    </div>
  )
}
