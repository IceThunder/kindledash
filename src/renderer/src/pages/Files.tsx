import { useCallback, useEffect, useRef, useState } from 'react'
import { kd } from '../api'
import { useConn } from '../store'
import { useI18n, localeTag } from '../i18n'
import { ConfirmDialog } from '../components/ui'
import type { FileEntry, TransferProgress } from '../../../shared/types'

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function modeString(mode: number): string {
  const fmt = (mode >> 12) & 0xf
  const type = fmt === 4 ? 'd' : fmt === 8 ? '-' : fmt === 10 ? 'l' : '?'
  const perms = 'rwxrwxrwx'
  let s = type
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? perms[i] : '-'
  return s
}

export default function Files(): JSX.Element {
  const { state } = useConn()
  const { t } = useI18n()
  const [path, setPath] = useState('/mnt/us')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<FileEntry | null>(null)
  const [renaming, setRenaming] = useState<FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creating, setCreating] = useState(false)
  const [createValue, setCreateValue] = useState('')
  const [preview, setPreview] = useState<{ name: string; text: string } | null>(null)
  const [transfers, setTransfers] = useState<TransferProgress[]>([])
  const history = useRef<string[]>([])

  const quick = [
    { label: t('files.quickUser'), path: '/mnt/us' },
    { label: t('files.quickRoot'), path: '/' },
    { label: '/var/local', path: '/var/local' },
    { label: t('files.quickScreensaver'), path: '/usr/share/blanket/screensaver' },
    { label: '/etc', path: '/etc' }
  ]

  const load = useCallback(async (p: string, pushHistory = true) => {
    setLoading(true)
    setSelected(null)
    const r = await kd.fsList(p)
    setEntries(r.entries)
    setError(r.error ?? '')
    setPath(r.path)
    if (pushHistory) history.current.push(p)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (state === 'connected') void load('/mnt/us')
    else setEntries([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    const off = kd.onTransferProgress((p) => {
      setTransfers((list) => {
        const i = list.findIndex((tt) => tt.id === p.id)
        if (i >= 0) {
          const copy = [...list]
          copy[i] = p
          return copy
        }
        return [...list, p]
      })
      if (p.done) {
        setTimeout(() => setTransfers((list) => list.filter((tt) => tt.id !== p.id)), 2500)
        if (!p.error) void load(path, false)
      }
    })
    return off
  }, [load, path])

  const parent = () => {
    const parts = path.split('/').filter(Boolean)
    parts.pop()
    void load('/' + parts.join('/'))
  }

  const openEntry = (e: FileEntry) => {
    if (e.isDir) void load(`${path.replace(/\/$/, '')}/${e.name}`)
    else if (e.isSymlink) void load(`${path.replace(/\/$/, '')}/${e.name}`)
    else setSelected(e.name)
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    const e = confirmDelete
    setConfirmDelete(null)
    const err = await kd.fsDelete(`${path.replace(/\/$/, '')}/${e.name}`, e.isDir)
    if (err) setError(t('common.deleteFailed', { err }))
    void load(path, false)
  }

  const doRename = async () => {
    if (!renaming || !renameValue.trim()) return
    const e = renaming
    setRenaming(null)
    const err = await kd.fsRename(
      `${path.replace(/\/$/, '')}/${e.name}`,
      `${path.replace(/\/$/, '')}/${renameValue.trim()}`
    )
    if (err) setError(t('files.renameFailed', { err }))
    void load(path, false)
  }

  const doCreate = async () => {
    if (!createValue.trim()) return
    setCreating(false)
    const err = await kd.fsMkdir(`${path.replace(/\/$/, '')}/${createValue.trim()}`)
    if (err) setError(t('files.createFailed', { err }))
    void load(path, false)
  }

  const previewText = async (e: FileEntry) => {
    const r = await kd.fsReadText(`${path.replace(/\/$/, '')}/${e.name}`)
    if (r.error) setError(t('files.readFailed', { err: r.error }))
    else setPreview({ name: e.name, text: r.text })
  }

  const isText = (e: FileEntry): boolean =>
    !e.isDir &&
    (/\.(txt|md|json|log|conf|ini|sh|py|js|ts|css|html|xml|yml|yaml|csv|po|mobi\.info)$/i.test(e.name) || e.size < 65536)

  const parts = path.split('/').filter(Boolean)

  if (state !== 'connected') {
    return <div className="empty">{t('common.deviceNotConnected')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-title" style={{ marginBottom: 10 }}>
        {t('nav.files')}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>SFTP</span>
      </div>

      <div className="file-toolbar">
        <button className="btn small" onClick={parent} disabled={path === '/'}>
          ↑ {t('files.parent')}
        </button>
        <button className="btn small" onClick={() => void load(path, false)}>
          ⟳ {t('common.refresh')}
        </button>
        <div className="breadcrumb" style={{ flex: 1 }}>
          <a onClick={() => void load('/')}>/</a>
          {parts.map((p, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <a onClick={() => void load('/' + parts.slice(0, i + 1).join('/'))}>{p}</a>
              <span className="sep">/</span>
            </span>
          ))}
        </div>
        {quick.map((q) => (
          <span key={q.path} className="quick-link" onClick={() => void load(q.path)}>
            {q.label}
          </span>
        ))}
      </div>

      <div className="file-toolbar">
        <button className="btn small primary" onClick={() => void kd.fsUpload(path)}>
          ⬆ {t('files.upload')}
        </button>
        <button
          className="btn small"
          disabled={!selected}
          onClick={() => selected && void kd.fsDownload(`${path.replace(/\/$/, '')}/${selected}`)}
        >
          ⬇ {t('files.download')}
        </button>
        <button className="btn small" onClick={() => setCreating(true)}>
          ＋ {t('files.newFolder')}
        </button>
        <button className="btn small" disabled={!selected} onClick={() => {
          const e = entries.find((x) => x.name === selected)
          if (e) {
            setRenaming(e)
            setRenameValue(e.name)
          }
        }}>
          ✎ {t('files.rename')}
        </button>
        <button
          className="btn small danger"
          disabled={!selected}
          onClick={() => {
            const e = entries.find((x) => x.name === selected)
            if (e) setConfirmDelete(e)
          }}
        >
          🗑 {t('common.del')}
        </button>
        {selected && isText(entries.find((x) => x.name === selected)!) && (
          <button className="btn small" onClick={() => void previewText(entries.find((x) => x.name === selected)!)}>
            👁 {t('files.preview')}
          </button>
        )}
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 10, padding: '8px 14px', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('files.colName')}</th>
              <th>{t('files.colSize')}</th>
              <th>{t('files.colPerms')}</th>
              <th>{t('files.colMtime')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="empty">
                  {t('files.readingDir')}
                </td>
              </tr>
            )}
            {!loading &&
              entries.map((e) => (
                <tr
                  key={e.name}
                  className={selected === e.name ? 'selected' : ''}
                  onClick={() => setSelected(e.name)}
                  onDoubleClick={() => openEntry(e)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <span style={{ marginRight: 8 }}>{e.isDir ? '📁' : e.isSymlink ? '🔗' : '📄'}</span>
                    <span style={e.isDir ? { color: 'var(--accent)', fontWeight: 500 } : undefined}>{e.name}</span>
                  </td>
                  <td style={{ color: 'var(--text-dim)' }}>{e.isDir ? '—' : fmtSize(e.size)}</td>
                  <td className="mono" style={{ color: 'var(--text-faint)' }}>
                    {modeString(e.mode)}
                  </td>
                  <td style={{ color: 'var(--text-dim)' }}>
                    {e.mtimeMs ? new Date(e.mtimeMs).toLocaleString(localeTag(), { hour12: false }) : '—'}
                  </td>
                </tr>
              ))}
            {!loading && !entries.length && !error && (
              <tr>
                <td colSpan={4} className="empty">
                  {t('files.emptyDir')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 传输浮窗 */}
      <div className="transfers">
        {transfers.map((tt) => (
          <div className="transfer-item" key={tt.id}>
            <div className="name">
              <span title={tt.name}>
                {tt.direction === 'upload' ? '↑' : '↓'} {tt.name}
              </span>
              <span style={{ color: tt.error ? 'var(--red)' : 'var(--text-dim)', flexShrink: 0 }}>
                {tt.error ? t('common.failed') : tt.done ? t('common.done') : tt.total ? `${Math.round((tt.bytes / tt.total) * 100)}%` : ''}
              </span>
            </div>
            <div className="progress-bar">
              <div
                style={{
                  width: `${tt.total ? (tt.bytes / tt.total) * 100 : 100}%`,
                  background: tt.error ? 'var(--red)' : undefined
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={confirmDelete.isDir ? t('files.deleteFolder') : t('files.deleteFile')}
          body={
            <>
              {t('files.deleteBodyA')} <b>{confirmDelete.name}</b> {t('files.deleteBodyB')}
              {confirmDelete.isDir && (
                <>
                  <br />
                  {t('files.deleteDirWarn')}
                </>
              )}
            </>
          }
          confirmText={t('common.del')}
          danger
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {renaming && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setRenaming(null)}>
          <div className="modal" style={{ width: 380 }}>
            <h3>{t('files.rename')}</h3>
            <input
              className="input"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doRename()}
            />
            <div className="form-actions">
              <button className="btn" onClick={() => setRenaming(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn primary" onClick={() => void doRename()}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setCreating(false)}>
          <div className="modal" style={{ width: 380 }}>
            <h3>{t('files.newFolder')}</h3>
            <input
              className="input"
              value={createValue}
              autoFocus
              placeholder={t('files.newFolderPlaceholder')}
              onChange={(e) => setCreateValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doCreate()}
            />
            <div className="form-actions">
              <button className="btn" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn primary" onClick={() => void doCreate()}>
                {t('files.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal" style={{ width: 720 }}>
            <h3>{preview.name}</h3>
            <pre
              style={{
                background: '#0d1117',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
                maxHeight: '55vh',
                overflow: 'auto',
                fontSize: 12,
                lineHeight: 1.6,
                userSelect: 'text',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {preview.text || t('files.emptyFile')}
            </pre>
            <div className="form-actions">
              <button className="btn" onClick={() => setPreview(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
