import { useCallback, useEffect, useMemo, useState } from 'react'
import { kd } from '../api'
import { useConn } from '../store'
import { useI18n, localeTag } from '../i18n'
import { ConfirmDialog } from '../components/ui'
import type { I18nKey } from '../../../shared/i18n'
import type { LibraryBook, LibraryScanProgress } from '../../../shared/types'

const SORTS: { id: string; labelKey: I18nKey }[] = [
  { id: 'recent', labelKey: 'library.sortRecent' },
  { id: 'title', labelKey: 'library.sortTitle' },
  { id: 'author', labelKey: 'library.sortAuthor' },
  { id: 'size', labelKey: 'library.sortSize' }
]

type SortId = 'recent' | 'title' | 'author' | 'size'

const FORMAT_LABEL: Record<string, string> = {
  azw3: 'AZW3',
  azw: 'AZW',
  azw1: 'AZW1',
  azw2: 'AZW2',
  azw4: 'AZW4',
  mobi: 'MOBI',
  prc: 'PRC',
  pdf: 'PDF',
  tpz: 'TPZ',
  txt: 'TXT',
  epub: 'EPUB'
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function Cover({ book, url, big }: { book: LibraryBook; url?: string; big?: boolean }): JSX.Element {
  if (url) {
    return <img src={url} alt={book.title} draggable={false} />
  }
  return (
    <div className={`cover-ph ${big ? 'big' : ''}`}>
      <span className="ph-icon">📖</span>
      <span className="ph-fmt">{FORMAT_LABEL[book.format] ?? book.format.toUpperCase()}</span>
    </div>
  )
}

export default function Library(): JSX.Element {
  const { state } = useConn()
  const { t } = useI18n()
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<LibraryScanProgress | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [covers, setCovers] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortId>('recent')
  const [fmt, setFmt] = useState('all')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<LibraryBook | null>(null)
  const [downloading, setDownloading] = useState(false)

  const scan = useCallback(async (): Promise<void> => {
    setScanning(true)
    setError('')
    setProgress({ phase: 'list', done: 0, total: 0, current: '' })
    const r = await kd.libraryScan()
    setBooks(r.books)
    setError(r.error ?? '')
    setInfo(
      r.error
        ? ''
        : t('library.scanSummary', { n: r.books.length, sec: (r.durationMs / 1000).toFixed(1) }) +
            (r.cached ? t('library.cacheHit', { n: r.cached }) : '')
    )
    setScanning(false)
    setProgress(null)
    // 封面从本地缓存逐本取回，渐进显示
    for (const b of r.books) {
      if (!b.hasCover) continue
      const url = await kd.libraryGetCover(b.id)
      if (url) setCovers((m) => ({ ...m, [b.id]: url }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  useEffect(() => {
    if (state === 'connected') void scan()
    else {
      setBooks([])
      setCovers({})
      setInfo('')
      setError('')
    }
  }, [state, scan])

  useEffect(() => {
    const off = kd.onLibraryScanProgress(setProgress)
    return () => {
      off()
    }
  }, [])

  const formats = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of books) map.set(b.format, (map.get(b.format) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [books])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = books.filter((b) => {
      if (fmt !== 'all' && b.format !== fmt) return false
      if (!q) return true
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.asin.toLowerCase().includes(q) ||
        b.fileName.toLowerCase().includes(q)
      )
    })
    list = [...list].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, localeTag())
      if (sort === 'author') return (a.author || '～').localeCompare(b.author || '～', localeTag())
      if (sort === 'size') return b.size - a.size
      return b.mtimeMs - a.mtimeMs
    })
    return list
  }, [books, search, fmt, sort])

  const detail = books.find((b) => b.id === detailId) ?? null

  const doDelete = async (): Promise<void> => {
    if (!confirmDelete) return
    const b = confirmDelete
    setConfirmDelete(null)
    setDetailId(null)
    const err = await kd.libraryDelete(b.id)
    if (err) setError(t('common.deleteFailed', { err }))
    else {
      setBooks((list) => list.filter((x) => x.id !== b.id))
      setInfo(t('library.deleted', { title: b.title }))
    }
  }

  const doUpload = async (): Promise<void> => {
    const paths = await kd.libraryPickBooks()
    if (!paths.length) return
    setInfo(t('library.uploading', { n: paths.length }))
    const ok = await kd.libraryUpload(paths)
    setInfo(ok ? t('library.uploaded', { n: ok }) : t('library.uploadFailed'))
    await scan()
  }

  const doDownload = async (): Promise<void> => {
    if (!detail) return
    setDownloading(true)
    const ok = await kd.fsDownload(detail.path)
    setDownloading(false)
    setInfo(ok ? t('library.savedLocal', { title: detail.title }) : t('library.downloadCancelled'))
  }

  if (state !== 'connected') {
    return <div className="empty">{t('common.deviceNotConnected')}</div>
  }

  const totalCovered = books.filter((b) => b.hasCover).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="page-title" style={{ marginBottom: 10 }}>
        {t('nav.library')}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)' }}>
          {t('library.summary', { total: books.length, covered: totalCovered })}
        </span>
      </div>

      <div className="file-toolbar">
        <input
          className="input"
          style={{ width: 200 }}
          placeholder={t('library.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input" style={{ width: 110 }} value={sort} onChange={(e) => setSort(e.target.value as SortId)}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.labelKey)}
            </option>
          ))}
        </select>
        <div className="fmt-filter">
          <button className={`chip ${fmt === 'all' ? 'on' : ''}`} onClick={() => setFmt('all')}>
            {t('library.allFormats', { n: books.length })}
          </button>
          {formats.map(([f, n]) => (
            <button key={f} className={`chip ${fmt === f ? 'on' : ''}`} onClick={() => setFmt(f)}>
              {FORMAT_LABEL[f] ?? f.toUpperCase()} {n}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={() => void scan()} disabled={scanning}>
          ⟳ {t('common.refresh')}
        </button>
        <button className="btn small primary" onClick={() => void doUpload()}>
          ⬆ {t('library.upload')}
        </button>
      </div>

      {scanning && progress && (
        <div className="card" style={{ marginBottom: 10, padding: '8px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>
            <span>
              {progress.phase === 'list'
                ? t('library.phaseList')
                : t('library.phaseMeta', { done: progress.done, total: progress.total })}
              {progress.current && progress.phase === 'meta' ? ` · ${progress.current}` : ''}
            </span>
            <span>{t('library.scanHint')}</span>
          </div>
          <div className="progress-bar">
            <div
              style={{
                width: progress.phase === 'list' ? '8%' : `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`
              }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 10, padding: '8px 14px', fontSize: 13 }}>
          {error}
        </div>
      )}
      {!error && info && !scanning && (
        <div className="card" style={{ marginBottom: 10, padding: '8px 14px', fontSize: 12, color: 'var(--text-dim)' }}>
          {info}
          <span style={{ float: 'right' }}>
            {t('library.afterUploadHint')}
          </span>
        </div>
      )}

      <div className="library-scroll">
        {!scanning && !shown.length && !error && (
          <div className="empty" style={{ paddingTop: 60 }}>
            {books.length ? t('library.noMatch') : t('library.empty')}
          </div>
        )}
        <div className="library-grid">
          {shown.map((b) => (
            <div
              key={b.id}
              className={`book-card ${detailId === b.id ? 'active' : ''}`}
              onClick={() => setDetailId(b.id)}
              title={`${b.title}${b.author ? ` · ${b.author}` : ''}`}
            >
              <div className="book-cover">
                <Cover book={b} url={covers[b.id]} />
                <span className="fmt-chip">{FORMAT_LABEL[b.format] ?? b.format.toUpperCase()}</span>
              </div>
              <div className="book-title">{b.title}</div>
              <div className="book-meta">{b.author || b.asin || fmtSize(b.size)}</div>
            </div>
          ))}
        </div>
      </div>

      {detail && (
        <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && setDetailId(null)}>
          <div className="modal" style={{ width: 620 }}>
            <h3 style={{ paddingRight: 24 }}>{detail.title}</h3>
            <div className="book-detail">
              <div className="book-cover detail-cover">
                <Cover book={detail} url={covers[detail.id]} big />
                <span className="fmt-chip">{FORMAT_LABEL[detail.format] ?? detail.format.toUpperCase()}</span>
              </div>
              <div className="book-detail-info">
                {detail.author && <div className="detail-author">{detail.author}</div>}
                <table className="tbl detail-table">
                  <tbody>
                    <tr>
                      <td>{t('library.format')}</td>
                      <td>{FORMAT_LABEL[detail.format] ?? detail.format.toUpperCase()} · {fmtSize(detail.size)}</td>
                    </tr>
                    {detail.asin && (
                      <tr>
                        <td>ASIN</td>
                        <td className="mono">{detail.asin}</td>
                      </tr>
                    )}
                    {detail.publisher && (
                      <tr>
                        <td>{t('library.publisher')}</td>
                        <td>{detail.publisher}</td>
                      </tr>
                    )}
                    {detail.publishDate && (
                      <tr>
                        <td>{t('library.publishDate')}</td>
                        <td>{detail.publishDate}</td>
                      </tr>
                    )}
                    <tr>
                      <td>{t('library.file')}</td>
                      <td className="mono" style={{ wordBreak: 'break-all' }}>
                        {detail.fileName}
                      </td>
                    </tr>
                    <tr>
                      <td>{t('library.path')}</td>
                      <td className="mono" style={{ wordBreak: 'break-all' }}>
                        {detail.path}
                      </td>
                    </tr>
                    <tr>
                      <td>{t('library.addedAt')}</td>
                      <td>{detail.mtimeMs ? new Date(detail.mtimeMs).toLocaleString(localeTag(), { hour12: false }) : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="form-actions">
              <button className="btn" onClick={() => setDetailId(null)}>
                {t('common.close')}
              </button>
              <button className="btn" onClick={() => void doDownload()} disabled={downloading}>
                {downloading ? t('library.downloading') : t('library.download')}
              </button>
              <button className="btn danger" onClick={() => setConfirmDelete(detail)}>
                {t('library.deleteFromDevice')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t('library.deleteTitle')}
          body={
            <>
              {t('library.deleteBodyA')}<b>{confirmDelete.title}</b>{t('library.deleteBodyB')}
              <br />
              {t('library.deleteBody2')}
            </>
          }
          confirmText={t('common.del')}
          danger
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
