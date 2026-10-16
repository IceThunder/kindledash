import { useCallback, useEffect, useRef, useState } from 'react'
import { kd } from '../api'
import { useConn } from '../store'
import { ConfirmDialog } from '../components/ui'
import type { FileEntry, TransferProgress } from '../../../shared/types'

const QUICK = [
  { label: '用户存储 /mnt/us', path: '/mnt/us' },
  { label: '系统 /', path: '/' },
  { label: '/var/local', path: '/var/local' },
  { label: '屏幕保护', path: '/usr/share/blanket/screensaver' },
  { label: '/etc', path: '/etc' }
]

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
        const i = list.findIndex((t) => t.id === p.id)
        if (i >= 0) {
          const copy = [...list]
          copy[i] = p
          return copy
        }
        return [...list, p]
      })
      if (p.done) {
        setTimeout(() => setTransfers((list) => list.filter((t) => t.id !== p.id)), 2500)
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
    if (err) setError(`删除失败：${err}`)
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
    if (err) setError(`重命名失败：${err}`)
    void load(path, false)
  }

  const doCreate = async () => {
    if (!createValue.trim()) return
    setCreating(false)
    const err = await kd.fsMkdir(`${path.replace(/\/$/, '')}/${createValue.trim()}`)
    if (err) setError(`创建失败：${err}`)
    void load(path, false)
  }

  const previewText = async (e: FileEntry) => {
    const r = await kd.fsReadText(`${path.replace(/\/$/, '')}/${e.name}`)
    if (r.error) setError(`读取失败：${r.error}`)
    else setPreview({ name: e.name, text: r.text })
  }

  const isText = (e: FileEntry): boolean =>
    !e.isDir &&
    (/\.(txt|md|json|log|conf|ini|sh|py|js|ts|css|html|xml|yml|yaml|csv|po|mobi\.info)$/i.test(e.name) || e.size < 65536)

  const parts = path.split('/').filter(Boolean)

  if (state !== 'connected') {
    return <div className="empty">设备未连接</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-title" style={{ marginBottom: 10 }}>
        文件管理
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>SFTP</span>
      </div>

      <div className="file-toolbar">
        <button className="btn small" onClick={parent} disabled={path === '/'}>
          ↑ 上级
        </button>
        <button className="btn small" onClick={() => void load(path, false)}>
          ⟳ 刷新
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
        {QUICK.map((q) => (
          <span key={q.path} className="quick-link" onClick={() => void load(q.path)}>
            {q.label}
          </span>
        ))}
      </div>

      <div className="file-toolbar">
        <button className="btn small primary" onClick={() => void kd.fsUpload(path)}>
          ⬆ 上传文件
        </button>
        <button
          className="btn small"
          disabled={!selected}
          onClick={() => selected && void kd.fsDownload(`${path.replace(/\/$/, '')}/${selected}`)}
        >
          ⬇ 下载
        </button>
        <button className="btn small" onClick={() => setCreating(true)}>
          ＋ 新建文件夹
        </button>
        <button className="btn small" disabled={!selected} onClick={() => {
          const e = entries.find((x) => x.name === selected)
          if (e) {
            setRenaming(e)
            setRenameValue(e.name)
          }
        }}>
          ✎ 重命名
        </button>
        <button
          className="btn small danger"
          disabled={!selected}
          onClick={() => {
            const e = entries.find((x) => x.name === selected)
            if (e) setConfirmDelete(e)
          }}
        >
          🗑 删除
        </button>
        {selected && isText(entries.find((x) => x.name === selected)!) && (
          <button className="btn small" onClick={() => void previewText(entries.find((x) => x.name === selected)!)}>
            👁 预览
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
              <th>名称</th>
              <th>大小</th>
              <th>权限</th>
              <th>修改时间</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="empty">
                  读取目录…
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
                    {e.mtimeMs ? new Date(e.mtimeMs).toLocaleString('zh-CN', { hour12: false }) : '—'}
                  </td>
                </tr>
              ))}
            {!loading && !entries.length && !error && (
              <tr>
                <td colSpan={4} className="empty">
                  空目录（双击文件夹进入）
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 传输浮窗 */}
      <div className="transfers">
        {transfers.map((t) => (
          <div className="transfer-item" key={t.id}>
            <div className="name">
              <span title={t.name}>
                {t.direction === 'upload' ? '↑' : '↓'} {t.name}
              </span>
              <span style={{ color: t.error ? 'var(--red)' : 'var(--text-dim)', flexShrink: 0 }}>
                {t.error ? '失败' : t.done ? '完成' : t.total ? `${Math.round((t.bytes / t.total) * 100)}%` : ''}
              </span>
            </div>
            <div className="progress-bar">
              <div
                style={{
                  width: `${t.total ? (t.bytes / t.total) * 100 : 100}%`,
                  background: t.error ? 'var(--red)' : undefined
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`删除 ${confirmDelete.isDir ? '文件夹' : '文件'}`}
          body={
            <>
              确定删除 <b>{confirmDelete.name}</b> 吗？
              {confirmDelete.isDir && (
                <>
                  <br />
                  文件夹内的全部内容都会被递归删除，不可恢复。
                </>
              )}
            </>
          }
          confirmText="删除"
          danger
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {renaming && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setRenaming(null)}>
          <div className="modal" style={{ width: 380 }}>
            <h3>重命名</h3>
            <input
              className="input"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doRename()}
            />
            <div className="form-actions">
              <button className="btn" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button className="btn primary" onClick={() => void doRename()}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setCreating(false)}>
          <div className="modal" style={{ width: 380 }}>
            <h3>新建文件夹</h3>
            <input
              className="input"
              value={createValue}
              autoFocus
              placeholder="文件夹名称"
              onChange={(e) => setCreateValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void doCreate()}
            />
            <div className="form-actions">
              <button className="btn" onClick={() => setCreating(false)}>
                取消
              </button>
              <button className="btn primary" onClick={() => void doCreate()}>
                创建
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
              {preview.text || '(空文件或二进制)'}
            </pre>
            <div className="form-actions">
              <button className="btn" onClick={() => setPreview(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
