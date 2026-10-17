import { useEffect, useState } from 'react'
import { kd } from '../api'
import { useConn, useStats, fmtKB, fmtUptime } from '../store'
import { useI18n, localeTag } from '../i18n'
import { ConfirmDialog, Ring } from '../components/ui'
import ScreenMirror from '../components/ScreenMirror'
import Cleanup from '../components/Cleanup'
import type { DeviceInfo } from '../../../shared/types'

/** 序列号脱敏：首 5 位 + … + 尾 4 位 */
function maskSerial(s: string): string {
  if (!s || s.length <= 10) return s
  return `${s.slice(0, 5)}…${s.slice(-4)}`
}

export default function Overview(): JSX.Element {
  const { state } = useConn()
  const { stats } = useStats()
  const { t } = useI18n()
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
    return <div className="empty">{t('overview.notConnectedHint')}</div>
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
        {t('nav.overview')}
        <button className="btn small" onClick={() => void kd.getDeviceInfo().then(setInfo)}>
          {t('common.refresh')}
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn danger small" onClick={() => setConfirmReboot(true)}>
          {t('overview.rebootBtn')}
        </button>
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 14 }}>{t('overview.readFailed', { err })}</div>}
      {!live && stats && (
        <div className="card" style={{ borderColor: 'var(--yellow)', marginBottom: 14, padding: '8px 16px', fontSize: 13 }}>
          {t('overview.staleData', {
            time: new Date(stats.ts).toLocaleTimeString(localeTag(), { hour12: false })
          })}
        </div>
      )}

      <div className="overview-hero">
        <div className="overview-screen">
          <ScreenMirror />
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
                  : t('overview.battery')
              return <Ring percent={pct ?? 0} size={92} color={color} label={sub} value={pct != null ? `${pct}%` : '—'} />
            })()}
            {(() => {
              const temp = battery?.temperatureC ?? null
              const color = temp == null ? 'var(--text-faint)' : temp < 40 ? 'var(--green)' : temp < 50 ? 'var(--yellow)' : 'var(--red)'
              return (
                <Ring
                  percent={temp == null ? 0 : Math.min(100, (temp / 60) * 100)}
                  size={92}
                  color={color}
                  label={t('overview.batteryTemp')}
                  value={temp != null ? `${temp}°C` : '—'}
                />
              )
            })()}
            <div className="stat-uptime">
              <div className="stat-uptime-label">{t('overview.uptime')}</div>
              <div className="stat-uptime-value">{stats ? fmtUptime(stats.uptime) : '…'}</div>
              {stats && (
                <div className="stat-uptime-sub">
                  {t('overview.bootAt', {
                    time: new Date(Date.now() - stats.uptime * 1000).toLocaleString(localeTag(), {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false
                    })
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="card overview-hardware">
            <div className="card-title">{t('overview.hardware')}</div>
            {info ? (
              <dl className="kv">
                <dt>{t('overview.deviceName')}</dt>
                <dd>{info.deviceName ?? info.model}</dd>
                <dt>{t('overview.cpu')}</dt>
                <dd>{info.cpuModel} · {t('overview.cores', { n: info.cpuCores })}</dd>
                <dt>{t('overview.memory')}</dt>
                <dd>{info.ramTotalKB ? fmtKB(info.ramTotalKB) : '—'}</dd>
                <dt>{t('overview.serial')}</dt>
                <dd style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{showSerial ? info.serial || '—' : maskSerial(info.serial) || '—'}</span>
                  {info.serial && info.serial.length > 10 && (
                    <button className="btn small" onClick={() => setShowSerial((v) => !v)}>
                      {showSerial ? t('overview.hideSerial') : t('overview.showSerial')}
                    </button>
                  )}
                </dd>
                <dt>{t('overview.boardId')}</dt>
                <dd>{info.boardId || '—'}</dd>
                <dt>{t('overview.platform')}</dt>
                <dd>{info.hardware || '—'}</dd>
                <dt>{t('overview.kernel')}</dt>
                <dd>{info.kernel}</dd>
              </dl>
            ) : (
              <div className="empty" style={{ padding: 36 }}>{t('common.loading')}</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', marginBottom: storageOpen ? 10 : 0 }}>
          <span>{t('overview.storage')}</span>
          <span style={{ flex: 1 }} />
          <button className="btn small" onClick={toggleStorage} disabled={storageLoading}>
            {storageLoading ? t('common.loading') : storageOpen ? t('overview.collapse') : t('overview.viewParts')}
          </button>
        </div>
        {storageOpen && <table className="tbl">
          <thead>
            <tr>
              <th>{t('overview.mount')}</th>
              <th>{t('overview.total')}</th>
              <th>{t('overview.used')}</th>
              <th>{t('overview.avail')}</th>
              <th style={{ width: '40%' }}>{t('overview.usage')}</th>
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
                  {t('common.waitingData')}
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
          title={t('overview.rebootTitle')}
          body={
            <>
              {t('overview.rebootBody1')}
              <br />
              {t('overview.rebootBody2')}
            </>
          }
          confirmText={t('overview.rebootConfirm')}
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
