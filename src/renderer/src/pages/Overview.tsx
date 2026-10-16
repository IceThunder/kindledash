import { useEffect, useState } from 'react'
import { kd } from '../api'
import { useConn, useStats, fmtKB, fmtUptime } from '../store'
import { ConfirmDialog, StatCard, Sparkline, Ring } from '../components/ui'
import type { DeviceInfo } from '../../../shared/types'

/** 序列号脱敏：首 5 位 + … + 尾 4 位 */
function maskSerial(s: string): string {
  if (!s || s.length <= 10) return s
  return `${s.slice(0, 5)}…${s.slice(-4)}`
}

export default function Overview(): JSX.Element {
  const { state } = useConn()
  const { stats, history } = useStats()
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [err, setErr] = useState('')
  const [confirmReboot, setConfirmReboot] = useState(false)
  const [showSerial, setShowSerial] = useState(false)

  useEffect(() => {
    if (state !== 'connected') {
      return
    }
    void kd
      .getDeviceInfo()
      .then(setInfo)
      .catch((e) => setErr((e as Error).message))
  }, [state])

  if (state !== 'connected' && !stats) {
    return <div className="empty">设备未连接 — 请点击左下角「连接设置」配置 SSH 并连接</div>
  }
  const live = state === 'connected'

  const battery = stats?.battery
  const usStorage = stats?.storage.find((s) => s.mount === '/mnt/us')
  const { mem } = stats ?? { mem: null }
  const usedPct = mem && mem.totalKB ? (mem.usedKB / mem.totalKB) * 100 : 0
  const cachePct = mem && mem.totalKB ? (mem.cachedKB / mem.totalKB) * 100 : 0
  const swapUsedKB = mem ? mem.swapTotalKB - mem.swapFreeKB : 0
  const swapPct = mem && mem.swapTotalKB ? (swapUsedKB / mem.swapTotalKB) * 100 : 0

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        <StatCard label="机型" value={info?.model ?? '…'} sub={info?.hardware} />
        <StatCard label="固件版本" value={info?.firmware ?? '…'} sub={`内核 ${info?.kernel ?? ''}`} />
        <StatCard
          label="电池"
          value={battery?.capacity != null ? `${battery.capacity}%` : '—'}
          sub={battery?.voltageMV != null ? `${battery.voltageMV} mV · ${battery.temperatureC ?? '?'}°C` : undefined}
          color={battery?.capacity != null && battery.capacity < 20 ? 'var(--red)' : 'var(--green)'}
        />
        <StatCard
          label="运行时间"
          value={stats ? fmtUptime(stats.uptime) : '…'}
          sub={stats ? `负载 ${stats.load.map((l) => l.toFixed(2)).join(' / ')}` : undefined}
        />
        <StatCard
          label="用户存储 (USB)"
          value={usStorage ? `${Math.round((usStorage.usedKB / usStorage.totalKB) * 100)}%` : '…'}
          sub={usStorage ? `已用 ${fmtKB(usStorage.usedKB)} / ${fmtKB(usStorage.totalKB)}` : undefined}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginTop: 14 }}>
        <div className="card">
          <div className="card-title">CPU 使用率</div>
          {stats ? (
            <>
              <Sparkline data={history.cpu} max={100} color="#58a6ff" height={120} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>
                <span>单核 Cortex-A8 · 最近 {history.cpu.length} 秒</span>
                <span>负载 {stats.load.map((l) => l.toFixed(2)).join(' / ')}</span>
              </div>
            </>
          ) : (
            <div className="empty" style={{ padding: 36 }}>等待数据…</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">内存占用（应用使用）</div>
          {mem ? (
            <>
              <Sparkline data={history.memUsedKB} max={history.memTotalKB || 1} color="#bc8cff" height={120} unit="" />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>
                <span>
                  {fmtKB(mem.usedKB)} / {fmtKB(mem.totalKB)}
                </span>
                <span>{Math.round(usedPct)}%</span>
              </div>
            </>
          ) : (
            <div className="empty" style={{ padding: 36 }}>等待数据…</div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginTop: 14 }}>
        <div className="card">
          <div className="card-title">内存明细</div>
          {mem ? (
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-around', padding: '4px 0' }}>
              <Ring percent={usedPct} label="应用使用" value={`${Math.round(usedPct)}%`} color="#bc8cff" />
              <Ring percent={cachePct} label="缓存 Cache" value={fmtKB(mem.cachedKB)} color="#58a6ff" />
              <Ring percent={mem.totalKB ? (mem.buffersKB / mem.totalKB) * 100 : 0} label="缓冲 Buffers" value={fmtKB(mem.buffersKB)} color="#d29922" />
              <Ring percent={swapPct} label={`Swap（${fmtKB(mem.swapTotalKB)}）`} value={fmtKB(swapUsedKB)} color={swapPct > 60 ? '#f85149' : '#3fb950'} />
              <Ring percent={mem.totalKB ? (mem.freeKB / mem.totalKB) * 100 : 0} label="空闲" value={fmtKB(mem.freeKB)} color="#8b949e" />
            </div>
          ) : (
            <div className="empty" style={{ padding: 36 }}>等待数据…</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">硬件信息</div>
          {info ? (
            <dl className="kv">
              <dt>设备名称</dt>
              <dd>{info.deviceName ?? info.model}</dd>
              <dt>处理器</dt>
              <dd>
                {info.cpuModel} · {info.cpuCores} 核
              </dd>
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

      <div className="card">
        <div className="card-title">存储分区</div>
        <table className="tbl">
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
            {(stats?.storage ?? []).map((s) => {
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
            {!stats && (
              <tr>
                <td colSpan={5} className="empty">
                  等待数据…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
