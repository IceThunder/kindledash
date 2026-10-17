import React from 'react'

/** 轻量 SVG 折线/面积图 */
export function Sparkline({
  data,
  max = 100,
  color = '#58a6ff',
  height = 120,
  fill = true,
  unit = '%',
  showGrid = true
}: {
  data: number[]
  max?: number
  color?: string
  height?: number
  fill?: boolean
  unit?: string
  showGrid?: boolean
}): JSX.Element {
  const W = 600
  const H = height
  const n = data.length
  const pts = data.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * W
    const y = H - Math.min(1, Math.max(0, v / max)) * (H - 8) - 4
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const last = data[n - 1] ?? 0

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}>
        {showGrid &&
          [0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} style={{ stroke: 'var(--border)' }} strokeWidth="1" />
          ))}
        {n > 1 && (
          <>
            {fill && (
              <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill={color} opacity="0.12" />
            )}
            <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="2" />
            <circle cx={W} cy={pts[n - 1]?.split(',')[1]} r="3.5" fill={color} />
          </>
        )}
      </svg>
      <span
        style={{
          position: 'absolute',
          right: 8,
          top: 6,
          fontSize: 22,
          fontWeight: 600,
          color,
          fontFamily: 'SF Mono, Menlo, monospace'
        }}
      >
        {Math.round(last * 10) / 10}
        {unit}
      </span>
    </div>
  )
}

/** 环形占比指示 */
export function Ring({
  percent,
  size = 110,
  color = '#3fb950',
  label,
  value
}: {
  percent: number
  size?: number
  color?: string
  label: string
  value: string
}): JSX.Element {
  const r = (size - 14) / 2
  const c = 2 * Math.PI * r
  const p = Math.min(100, Math.max(0, percent))
  // 数值文字按长度自适应字号，保证长数值也不溢出圆环
  const fontSize = value.length > 9 ? 13 : value.length > 6 ? 15 : 19
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: size }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--bg-hover)' }} strokeWidth="10" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeDasharray={`${(c * p) / 100} ${c}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.4s' }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '0 12px'
          }}
        >
          <span style={{ fontSize, fontWeight: 600, lineHeight: 1.25, wordBreak: 'break-word' }}>{value}</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.35 }}>{label}</div>
    </div>
  )
}

/** 确认对话框 */
export function ConfirmDialog({
  title,
  body,
  confirmText = '确认',
  danger,
  onConfirm,
  onCancel
}: {
  title: string
  body: React.ReactNode
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ width: 400 }}>
        <h3>{title}</h3>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7 }}>{body}</div>
        <div className="form-actions">
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button className={danger ? 'btn danger' : 'btn primary'} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 顶部大数字指标卡 */
export function StatCard({
  label,
  value,
  sub,
  color
}: {
  label: string
  value: string
  sub?: string
  color?: string
}): JSX.Element {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: color ?? 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}
