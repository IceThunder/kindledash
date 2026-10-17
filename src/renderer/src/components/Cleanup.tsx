import { useEffect, useMemo, useState } from 'react'
import { kd } from '../api'
import { ConfirmDialog } from './ui'
import type { CleanupDeleteResult, CleanupProgress, CleanupScanResult, JunkCategory, JunkItem } from '../../../shared/types'

/** 各类别展示信息与默认勾选策略：只有「确认无价值」的类别默认勾选，其余由用户自己决定 */
const CATEGORY_META: Record<JunkCategory, { label: string; desc: string; defaultChecked: boolean }> = {
  'orphan-sidecar': {
    label: '标注 / 书签残留',
    desc: '书已从设备删除，但残留的 .sdr / .dir 伴生目录（进度、标注、书签）',
    defaultChecked: true
  },
  'sys-junk': {
    label: '系统残留文件',
    desc: '.fuse_hidden*、.DS_Store、._*（macOS 资源叉）、Thumbs.db 等跨系统残留',
    defaultChecked: true
  },
  temp: {
    label: '系统临时目录',
    desc: 'system/tmp、system/temp 内的陈旧临时文件（清空内容、保留目录）',
    defaultChecked: false
  },
  clippings: {
    label: '剪贴汇总文件',
    desc: 'My Clippings.txt — 所有标注/剪贴的汇总，随使用增长；删除会丢失剪贴历史',
    defaultChecked: false
  },
  'empty-dir': {
    label: '空目录',
    desc: 'documents 下无任何内容的目录',
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
    setInfo('正在删除所选条目…')
    let r: CleanupDeleteResult
    try {
      r = await kd.cleanupDelete([...checked])
    } catch (e) {
      setDeleting(false)
      setError(`删除失败：${(e as Error).message}`)
      return
    }
    setDeleting(false)
    // 从列表里移除已处理的条目，展示结果摘要后自动重新扫描校准
    setChecked(new Set())
    setResult((prev) => (prev ? { ...prev, items: prev.items.filter((it) => !checked.has(it.id)) } : prev))
    const parts = [`已清理 ${r.ok} 项 · 释放 ${fmtBytes(r.freedBytes)}`]
    if (r.skipped) parts.push(`跳过 ${r.skipped} 项（设备状态已变化，删除前复核未通过）`)
    if (r.failed) parts.push(`失败 ${r.failed} 项`)
    setInfo(parts.join(' · '))
    if (r.errors.length) setError(r.errors.join('\n'))
    void scan()
  }

  if (!connected) return null

  const header = (
    <div className="card-title" style={{ display: 'flex', alignItems: 'center', marginBottom: result ? 10 : 0 }}>
      <span>垃圾清理</span>
      {result && (
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>
          发现 {items.length} 项 · 共 {fmtBytes(totalBytes)}
          {result.scannedDirs ? ` · 已扫描 ${result.scannedDirs} 个目录` : ''}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <button className="btn small" onClick={() => void scan()} disabled={scanning || deleting}>
        {scanning ? '扫描中…' : result ? '重新扫描' : '扫描垃圾'}
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
              正在扫描 {progress.current || '设备目录…'}
              {progress.found ? ` · 已发现 ${progress.found} 项` : ''}
            </span>
            <span>{progress.scannedDirs} 个目录</span>
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
          扫描设备上的标注残留、孤儿伴生目录、系统临时文件等垃圾 —— 只扫描和标记，<b>删除始终需要手动确认</b>
        </div>
      )}

      {result && !scanning && items.length === 0 && !error && (
        <div className="empty" style={{ padding: '20px 0', fontSize: 12.5 }}>设备很干净，没有发现可清理的垃圾 ✨</div>
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
                    <b>{meta.label}</b>
                    <span style={{ color: 'var(--text-dim)' }}>
                      {list.length} 项 · {fmtBytes(list.reduce((s, it) => s + it.size, 0))}
                    </span>
                    <span className="cat-desc" style={{ flex: 1 }}>{meta.desc}</span>
                  </div>
                  {list.map((it) => (
                    <label className="cleanup-row" key={it.id} title={`${it.path}\n${it.reason}`}>
                      <input type="checkbox" checked={checked.has(it.id)} onChange={() => toggle(it.id)} />
                      <span className="name" style={{ maxWidth: '42%' }}>{it.name}</span>
                      <span className="reason">{it.reason}</span>
                      <span style={{ color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                        {it.isDir ? `${it.fileCount} 个文件` : '文件'}
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
              {checked.size < items.length ? '全选' : '全不选'}
            </button>
            <span style={{ color: 'var(--text-dim)' }}>
              已选 <b style={{ color: 'var(--text)' }}>{selected.length}</b> 项 · {fmtBytes(selectedBytes)}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>删除不会自动执行，全部需要手动确认</span>
            <button className="btn danger small" disabled={!selected.length || deleting} onClick={() => setConfirming(true)}>
              {deleting ? '删除中…' : `🗑 删除所选${selected.length ? `（${selected.length}）` : ''}`}
            </button>
          </div>
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title="删除所选垃圾"
          body={
            <>
              即将从设备删除 <b>{selected.length}</b> 项，共 <b>{fmtBytes(selectedBytes)}</b>：
              <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
                {grouped
                  .map(([cat, list]) => {
                    const n = list.filter((it) => checked.has(it.id)).length
                    return n ? (
                      <li key={cat}>
                        {CATEGORY_META[cat].label}：{n} 项
                      </li>
                    ) : null
                  })
                  .filter(Boolean)}
              </ul>
              删除后<b>不可恢复</b>。其中标注/书签残留一旦删除，对应书籍即使重新拷回也无法找回旧标注。
            </>
          }
          confirmText={`删除 ${selected.length} 项`}
          danger
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
