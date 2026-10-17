import { useEffect, useMemo, useState } from 'react'
import { kd } from '../api'
import { useI18n } from '../i18n'
import { ConfirmDialog } from './ui'
import type { I18nKey } from '../../../shared/i18n'
import type { CleanupDeleteResult, CleanupProgress, CleanupScanResult, JunkCategory, JunkItem } from '../../../shared/types'

/** 各类别展示信息与默认勾选策略：只有「确认无价值」的类别默认勾选，其余由用户自己决定 */
type CatMeta = { labelKey: I18nKey; descKey: I18nKey; defaultChecked: boolean }

const CATEGORY_META: Record<JunkCategory, CatMeta> = {
  'orphan-sidecar': {
    labelKey: 'cleanup.catOrphanLabel',
    descKey: 'cleanup.catOrphanDesc',
    defaultChecked: true
  },
  'sys-junk': {
    labelKey: 'cleanup.catSysLabel',
    descKey: 'cleanup.catSysDesc',
    defaultChecked: true
  },
  temp: {
    labelKey: 'cleanup.catTempLabel',
    descKey: 'cleanup.catTempDesc',
    defaultChecked: false
  },
  clippings: {
    labelKey: 'cleanup.catClippingsLabel',
    descKey: 'cleanup.catClippingsDesc',
    defaultChecked: false
  },
  'empty-dir': {
    labelKey: 'cleanup.catEmptyLabel',
    descKey: 'cleanup.catEmptyDesc',
    defaultChecked: false
  }
}

const CATEGORY_ORDER: JunkCategory[] = ['orphan-sidecar', 'sys-junk', 'temp', 'clippings', 'empty-dir']

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function Cleanup({ connected }: { connected: boolean }): JSX.Element | null {
  const { t } = useI18n()
  const [result, setResult] = useState<CleanupScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<CleanupProgress | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    const off = kd.onCleanupProgress(setProgress)
    return () => {
      off()
    }
  }, [])

  // 断开连接后清空状态，避免下次连接显示旧设备的数据
  useEffect(() => {
    if (!connected) {
      setResult(null)
      setChecked(new Set())
      setProgress(null)
      setInfo('')
      setError('')
    }
  }, [connected])

  const scan = async (): Promise<void> => {
    setScanning(true)
    setError('')
    setInfo('')
    setProgress({ current: '', found: 0, scannedDirs: 0 })
    const r = await kd.cleanupScan()
    setResult(r)
    setError(r.error ?? '')
    // 默认勾选策略：标注残留 / 系统残留文件；其余类别由用户自行勾选
    const init = new Set<string>()
    for (const it of r.items) {
      if (CATEGORY_META[it.category].defaultChecked) init.add(it.id)
    }
    setChecked(r.error ? new Set() : init)
    setScanning(false)
    setProgress(null)
  }

  const items = result?.items ?? []
  const grouped = useMemo(() => {
    const m = new Map<JunkCategory, JunkItem[]>()
    for (const c of CATEGORY_ORDER) m.set(c, [])
    for (const it of items) m.get(it.category)?.push(it)
    return [...m.entries()].filter(([, list]) => list.length > 0)
  }, [items])

  const selected = items.filter((it) => checked.has(it.id))
  const selectedBytes = selected.reduce((s, it) => s + it.size, 0)
  const totalBytes = items.reduce((s, it) => s + it.size, 0)

  const toggle = (id: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCategory = (cat: JunkCategory): void => {
    const list = items.filter((it) => it.category === cat)
    const allOn = list.every((it) => checked.has(it.id))
    setChecked((prev) => {
      const next = new Set(prev)
      for (const it of list) {
        if (allOn) next.delete(it.id)
        else next.add(it.id)
      }
      return next
    })
  }

  const selectAll = (on: boolean): void => {
    setChecked(on ? new Set(items.map((it) => it.id)) : new Set())
  }

  const doDelete = async (): Promise<void> => {
    setConfirming(false)
    setDeleting(true)
    setError('')
    setInfo(t('cleanup.deletingInfo'))
    let r: CleanupDeleteResult
    try {
      r = await kd.cleanupDelete([...checked])
    } catch (e) {
      setDeleting(false)
      setError(t('common.deleteFailed', { err: (e as Error).message }))
      return
    }
    setDeleting(false)
    // 从列表里移除已处理的条目，展示结果摘要后自动重新扫描校准
    setChecked(new Set())
    setResult((prev) => (prev ? { ...prev, items: prev.items.filter((it) => !checked.has(it.id)) } : prev))
    const parts = [t('cleanup.resultCleaned', { n: r.ok, size: fmtBytes(r.freedBytes) })]
    if (r.skipped) parts.push(t('cleanup.resultSkipped', { n: r.skipped }))
    if (r.failed) parts.push(t('cleanup.resultFailed', { n: r.failed }))
    setInfo(parts.join(' · '))
    if (r.errors.length) setError(r.errors.join('\n'))
    void scan()
  }

  if (!connected) return null

  const header = (
    <div className="card-title" style={{ display: 'flex', alignItems: 'center', marginBottom: result ? 10 : 0 }}>
      <span>{t('cleanup.title')}</span>
      {result && (
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>
          {[
            t('cleanup.found', { n: items.length }),
            t('cleanup.totalSize', { size: fmtBytes(totalBytes) }),
            result.scannedDirs ? t('cleanup.scannedDirs', { n: result.scannedDirs }) : ''
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <button className="btn small cleanup-scan-btn" onClick={() => void scan()} disabled={scanning || deleting}>
        {scanning ? t('cleanup.scanning') : result ? t('cleanup.rescan') : t('cleanup.scanBtn')}
      </button>
    </div>
  )

  return (
    <div className="card">
      {header}

      {scanning && progress && (
        <div className="card" style={{ marginBottom: 10, padding: '8px 14px', borderColor: 'var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
            <span>
              {t('cleanup.scanningPath', { dir: progress.current || t('cleanup.deviceDirs') })}
              {progress.found ? ` · ${t('cleanup.foundSoFar', { n: progress.found })}` : ''}
            </span>
            <span>{t('cleanup.dirsCount', { n: progress.scannedDirs })}</span>
          </div>
          <div className="progress-bar">
            <div style={{ width: '22%' }} />
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 10, padding: '8px 14px', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}
      {!error && info && !scanning && !deleting && (
        <div className="card" style={{ marginBottom: 10, padding: '8px 14px', fontSize: 12.5, color: 'var(--text-dim)' }}>{info}</div>
      )}

      {!scanning && !result && !error && (
        <div className="empty" style={{ padding: '20px 0', fontSize: 12.5 }}>
          {t('cleanup.introA')}<b>{t('cleanup.introB')}</b>
        </div>
      )}

      {result && !scanning && items.length === 0 && !error && (
        <div className="empty" style={{ padding: '20px 0', fontSize: 12.5 }}>{t('cleanup.clean')}</div>
      )}

      {result && !scanning && grouped.length > 0 && (
        <>
          <div className="cleanup-scroll">
            {grouped.map(([cat, list]) => {
              const meta = CATEGORY_META[cat]
              const onCount = list.filter((it) => checked.has(it.id)).length
              return (
                <div key={cat}>
                  <div className="cleanup-cat">
                    <input
                      type="checkbox"
                      checked={onCount === list.length}
                      ref={(el) => {
                        if (el) el.indeterminate = onCount > 0 && onCount < list.length
                      }}
                      onChange={() => toggleCategory(cat)}
                    />
                    <b>{t(meta.labelKey)}</b>
                    <span style={{ color: 'var(--text-dim)' }}>
                      {t('cleanup.itemsSize', { n: list.length, size: fmtBytes(list.reduce((s, it) => s + it.size, 0)) })}
                    </span>
                    <span className="cat-desc" style={{ flex: 1 }}>{t(meta.descKey)}</span>
                  </div>
                  {list.map((it) => (
                    <label className="cleanup-row" key={it.id} title={`${it.path}\n${it.reason}`}>
                      <input type="checkbox" checked={checked.has(it.id)} onChange={() => toggle(it.id)} />
                      <span className="name" style={{ maxWidth: '42%' }}>{it.name}</span>
                      <span className="reason">{it.reason}</span>
                      <span style={{ color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        {it.isDir ? t('cleanup.filesCount', { n: it.fileCount }) : t('cleanup.fileItem')}
                      </span>
                      <span style={{ whiteSpace: 'nowrap', width: 70, textAlign: 'right' }}>{fmtBytes(it.size)}</span>
                    </label>
                  ))}
                </div>
              )
            })}
          </div>

          <div className="cleanup-toolbar">
            <button className="btn small" onClick={() => selectAll(checked.size < items.length)}>
              {checked.size < items.length ? t('cleanup.selectAll') : t('cleanup.selectNone')}
            </button>
            <span style={{ color: 'var(--text-dim)' }}>
              {t('cleanup.selected')} <b style={{ color: 'var(--text)' }}>{selected.length}</b> {t('common.itemsUnit')} · {fmtBytes(selectedBytes)}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>{t('cleanup.manualConfirmHint')}</span>
            <button className="btn danger small" disabled={!selected.length || deleting} onClick={() => setConfirming(true)}>
              {deleting
                ? t('cleanup.deleting')
                : `${t('cleanup.deleteSelected')}${selected.length ? `（${selected.length}）` : ''}`}
            </button>
          </div>
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title={t('cleanup.confirmTitle')}
          body={
            <>
              {t('cleanup.confirmBodyA')} <b>{selected.length}</b> {t('cleanup.confirmBodyB')} <b>{fmtBytes(selectedBytes)}</b>{t('cleanup.confirmColon')}
              <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
                {grouped
                  .map(([cat, list]) => {
                    const n = list.filter((it) => checked.has(it.id)).length
                    return n ? (
                      <li key={cat}>
                        {t(CATEGORY_META[cat].labelKey)} · {n} {t('common.itemsUnit')}
                      </li>
                    ) : null
                  })
                  .filter(Boolean)}
              </ul>
              {t('cleanup.confirmWarnA')}<b>{t('cleanup.confirmWarnBold')}</b>{t('cleanup.confirmWarnB')}
            </>
          }
          confirmText={t('cleanup.deleteNItems', { n: selected.length })}
          danger
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
