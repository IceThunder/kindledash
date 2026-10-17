// 书库（内容管理）服务：
//   1. 递归扫描 /mnt/us/documents 下的电子书文件（SFTP，跳过 .sdr/.dir 伴生目录）
//   2. 逐本解析 MOBI/AZW/AZW3 头部元数据（书名/作者/ASIN/出版社）并提取内嵌封面
//   3. 元数据 + 封面缓存在本机 userData，size/mtime 未变时直接复用，二次扫描秒回
//   4. 删除图书（连同 .sdr / .dir 伴生目录）、上传新书到设备
import { createHash } from 'crypto'
import { createReadStream, existsSync, statSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { SFTPWrapper } from 'ssh2'
import type { KindleSSH } from './kindle'
import { detectImageFormat, parseRecord0, readNumRecords, readRecordOffsets } from './mobi'
import { tMain } from './i18n'
import type { LibraryBook, LibraryScanProgress, LibraryScanResult, TransferProgress } from '../shared/types'

const DOC_ROOT = '/mnt/us/documents'
/** 认作电子书的扩展名（小写）。azw2 是 Kindlet 应用（如 KUAL），一并纳入管理 */
const BOOK_EXTS = new Set(['azw', 'azw1', 'azw2', 'azw3', 'azw4', 'mobi', 'prc', 'pdf', 'tpz', 'txt', 'epub'])
/** 元数据解析只对这些 PalmDB/MOBI 系格式生效，其余走文件名回退 */
const MOBI_EXTS = new Set(['azw', 'azw1', 'azw2', 'azw3', 'azw4', 'mobi', 'prc', 'tpz'])
const MAX_RECORD_TABLE = 1 << 20 // 记录表 >1MB 视为损坏文件，放弃元数据解析
const MAX_RECORD0 = 64 * 1024
const MAX_COVER = 4 * 1024 * 1024

const S_IFDIR = 0o040000

interface RemoteFile {
  path: string
  size: number
  mtime: number
}

interface CacheEntry extends LibraryBook {
  mtime: number
  coverFile?: string
}

function sftpCall<T>(fn: (cb: (err: Error | null, res: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))))
}

type ReaddirEntry = { filename: string; attrs: { size?: number; mtime?: number; mode?: number } }

export class LibraryService {
  /** 扫描进行中的去重：并发请求复用同一次扫描 */
  private scanning: Promise<LibraryScanResult> | null = null
  private entries = new Map<string, CacheEntry>()
  private coversDir = ''
  private indexFile = ''
  private nextTransferId = 1

  constructor(
    private ssh: KindleSSH,
    cacheRoot: string,
    private onScanProgress: (p: LibraryScanProgress) => void,
    private onTransferProgress: (p: TransferProgress) => void
  ) {
    void this.initCache(join(cacheRoot, 'library-cache'))
  }

  // ---------- 本地缓存 ----------

  private async initCache(deviceDir: string): Promise<void> {
    this.coversDir = join(deviceDir, 'covers')
    this.indexFile = join(deviceDir, 'index.json')
    try {
      await mkdir(this.coversDir, { recursive: true })
      const data = JSON.parse(await readFile(this.indexFile, 'utf8')) as Record<string, CacheEntry>
      this.entries = new Map(Object.entries(data))
    } catch {
      this.entries = new Map()
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.indexFile) return
    try {
      await mkdir(join(this.indexFile, '..'), { recursive: true })
      await writeFile(this.indexFile, JSON.stringify(Object.fromEntries(this.entries), null, 0))
    } catch {
      /* 缓存写失败不影响扫描结果 */
    }
  }

  // ---------- SFTP 小工具 ----------

  private async readRange(path: string, start: number, length: number): Promise<Buffer> {
    const sftp = await this.ssh.getSftp()
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = sftp.createReadStream(path, { start, end: start + length - 1 })
      stream.on('data', (d: Buffer) => chunks.push(d))
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks)))
    })
  }

  private async readdir(path: string): Promise<ReaddirEntry[]> {
    const sftp = await this.ssh.getSftp()
    return sftpCall((cb) => sftp.readdir(path, cb as never) as never)
  }

  private async stat(path: string): Promise<{ isDir: boolean } | null> {
    const sftp = await this.ssh.getSftp()
    try {
      const st = await sftpCall<{ mode?: number }>((cb) => sftp.stat(path, cb as never))
      return { isDir: ((st.mode ?? 0) & 0o170000) === S_IFDIR }
    } catch {
      return null
    }
  }

  // ---------- 扫描 ----------

  scan(): Promise<LibraryScanResult> {
    if (this.scanning) return this.scanning
    this.scanning = this.doScan().finally(() => (this.scanning = null))
    return this.scanning
  }

  private async doScan(): Promise<LibraryScanResult> {
    const started = Date.now()
    try {
      this.onScanProgress({ phase: 'list', done: 0, total: 0, current: tMain('main.readingDirs') })
      const files: RemoteFile[] = []
      await this.walk(DOC_ROOT, 0, files)
      files.sort((a, b) => a.path.localeCompare(b.path))

      const books: LibraryBook[] = []
      let cached = 0
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        this.onScanProgress({ phase: 'meta', done: i, total: files.length, current: f.path.split('/').pop() ?? '' })
        const wasCached = this.isCacheHit(f)
        const book = await this.buildBook(f)
        if (book) {
          books.push(book)
          if (wasCached) {
            cached++
          } else {
            // 增量落盘：扫描中途断连/退出时，已提取的元数据和封面不浪费
            await this.saveIndex()
          }
        }
      }
      this.onScanProgress({ phase: 'meta', done: files.length, total: files.length, current: '' })

      // 清理已不存在的缓存项（书被删掉/换设备）
      const alive = new Set(files.map((f) => f.path))
      for (const key of [...this.entries.keys()]) {
        if (!alive.has(key)) {
          const e = this.entries.get(key)
          if (e?.coverFile) void rm(join(this.coversDir, e.coverFile), { force: true }).catch(() => {})
          this.entries.delete(key)
        }
      }
      await this.saveIndex()

      books.sort((a, b) => b.mtimeMs - a.mtimeMs)
      return { books, durationMs: Date.now() - started, cached }
    } catch (e) {
      return { books: [], error: (e as Error).message, durationMs: Date.now() - started, cached: 0 }
    }
  }

  private isCacheHit(f: RemoteFile): boolean {
    const e = this.entries.get(f.path)
    return !!e && e.size === f.size && e.mtime === f.mtime
  }

  private async walk(dir: string, depth: number, out: RemoteFile[]): Promise<void> {
    const list = await this.readdir(dir)
    for (const e of list) {
      const name = e.filename
      if (name.startsWith('.')) continue
      const mode = e.attrs.mode ?? 0
      if ((mode & 0o170000) === S_IFDIR) {
        // .sdr / .dir 是 Kindle 为每本书生成的伴生目录（进度/标注/缓存），不属于书库内容
        if (name.endsWith('.sdr') || name.endsWith('.dir')) continue
        if (depth < 4) await this.walk(`${dir}/${name}`, depth + 1, out)
      } else {
        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
        if (BOOK_EXTS.has(ext)) {
          out.push({ path: `${dir}/${name}`, size: e.attrs.size ?? 0, mtime: e.attrs.mtime ?? 0 })
        }
      }
    }
  }

  private async buildBook(f: RemoteFile): Promise<LibraryBook | null> {
    const cached = this.entries.get(f.path)
    if (cached && cached.size === f.size && cached.mtime === f.mtime) {
      const hasCover = !!cached.coverFile && existsSync(join(this.coversDir, cached.coverFile))
      return { ...cached, hasCover, coverMime: hasCover ? cached.coverMime : undefined }
    }

    const fileName = f.path.split('/').pop() ?? f.path
    const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : ''
    const fallbackTitle = fileName.replace(/\.[^.]+$/, '').replace(/_B0[A-Z0-9]{8,}$/, '')

    const book: CacheEntry = {
      id: f.path,
      path: f.path,
      fileName,
      title: fallbackTitle,
      author: '',
      asin: '',
      format: ext,
      size: f.size,
      mtimeMs: f.mtime * 1000,
      hasCover: false,
      mtime: f.mtime
    }

    if (MOBI_EXTS.has(ext)) {
      try {
        const meta = await this.extractMobi(f)
        if (meta.title) book.title = meta.title
        if (meta.author) book.author = meta.author
        if (meta.asin) book.asin = meta.asin
        if (meta.publisher) book.publisher = meta.publisher
        if (meta.publishDate) book.publishDate = meta.publishDate
        if (meta.coverFile) {
          book.coverFile = meta.coverFile
          book.coverMime = meta.coverMime
        }
      } catch {
        /* 单本解析失败 → 文件名回退，不中断整体扫描 */
      }
    }

    this.entries.set(f.path, book)
    const hasCover = !!book.coverFile && existsSync(join(this.coversDir, book.coverFile))
    return { ...book, hasCover, coverMime: hasCover ? book.coverMime : undefined }
  }

  /** 读取 MOBI 头并提取元数据 + 封面，封面落盘到本地缓存 */
  private async extractMobi(f: RemoteFile): Promise<Partial<CacheEntry>> {
    const header80 = await this.readRange(f.path, 0, 80)
    const numRecords = readNumRecords(header80)
    if (numRecords <= 1) return {}

    const tableLen = numRecords * 8
    if (tableLen > MAX_RECORD_TABLE) return {}
    const table = await this.readRange(f.path, 78, tableLen)
    const offsets = readRecordOffsets(table, numRecords)
    const r0Start = offsets[0]
    const r0End = offsets[1] ?? r0Start + MAX_RECORD0
    const r0 = await this.readRange(f.path, r0Start, Math.min(r0End - r0Start, MAX_RECORD0))

    const meta = parseRecord0(r0)
    if (!meta) return {}

    const result: Partial<CacheEntry> = {}
    if (meta.title) result.title = meta.title
    if (meta.author) result.author = meta.author
    if (meta.asin) result.asin = meta.asin
    if (meta.publisher) result.publisher = meta.publisher
    if (meta.publishDate) result.publishDate = meta.publishDate

    // 封面：先按 firstImage+coverOffset 的资源号取（KF8/AZW 通用，真机验证过）；
    // 个别老 MOBI6 的 EXTH201 是绝对记录索引，取不到图片时回退再试一次
    const candidates: number[] = []
    if (meta.coverRecordIndex > 0) candidates.push(meta.coverRecordIndex)
    if (meta.firstImageRecordIndex > 0) {
      const raw = meta.coverRecordIndex - meta.firstImageRecordIndex
      if (raw > 0 && raw < numRecords && raw !== meta.coverRecordIndex) candidates.push(raw)
    }

    for (const idx of candidates) {
      if (idx <= 0 || idx >= numRecords) continue
      const start = offsets[idx]
      const end = Math.min(offsets[idx + 1] ?? f.size, start + MAX_COVER)
      if (end <= start) continue
      const raw = await this.readRange(f.path, start, end - start)
      const img = detectImageFormat(raw)
      if (!img) continue
      const bytes = raw.subarray(img.start)
      const hash = createHash('sha1').update(f.path).digest('hex').slice(0, 20)
      const coverFile = `${hash}.${img.ext}`
      await mkdir(this.coversDir, { recursive: true })
      await writeFile(join(this.coversDir, coverFile), bytes)
      result.coverFile = coverFile
      result.coverMime = img.mime
      break
    }
    return result
  }

  // ---------- 封面供给（渲染进程） ----------

  async getCoverDataUrl(id: string): Promise<string | null> {
    const e = this.entries.get(id)
    if (!e?.coverFile || !e.coverMime) return null
    try {
      const buf = await readFile(join(this.coversDir, e.coverFile))
      return `data:${e.coverMime};base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }

  // ---------- 管理：删除 ----------

  /** 删除图书文件及其伴生目录（<书名>.sdr / <文件名>.dir），并清理本地缓存 */
  async deleteBook(id: string): Promise<string | null> {
    try {
      const sidecars = [
        `${id}.dir`,
        `${id.replace(/\.[^.]+$/, '')}.sdr`
      ]
      const st = await this.stat(id)
      if (st) await this.removeRemote(id, st.isDir)
      for (const s of sidecars) {
        const ss = await this.stat(s)
        if (ss) await this.removeRemote(s, ss.isDir)
      }
      const e = this.entries.get(id)
      if (e?.coverFile) void rm(join(this.coversDir, e.coverFile), { force: true }).catch(() => {})
      this.entries.delete(id)
      await this.saveIndex()
      return null
    } catch (e) {
      return (e as Error).message
    }
  }

  private async removeRemote(path: string, isDir: boolean): Promise<void> {
    const sftp = await this.ssh.getSftp()
    if (!isDir) {
      await sftpCall((cb) => sftp.unlink(path, cb as never))
      return
    }
    const list = await this.readdir(path)
    for (const e of list) {
      const mode = e.attrs.mode ?? 0
      const child = `${path}/${e.filename}`
      await this.removeRemote(child, (mode & 0o170000) === S_IFDIR)
    }
    await sftpCall((cb) => sftp.rmdir(path, cb as never))
  }

  // ---------- 管理：上传 ----------

  /** 上传本地电子书到 /mnt/us/documents，复用全局传输进度通道 */
  async uploadBooks(localPaths: string[]): Promise<number> {
    let ok = 0
    for (const local of localPaths) {
      const name = local.split('/').filter(Boolean).pop() ?? 'book'
      const id = this.nextTransferId++
      const total = statSync(local).size
      this.onTransferProgress({ id, name, direction: 'upload', bytes: 0, total, done: false })
      try {
        const sftp = await this.ssh.getSftp()
        await new Promise<void>((resolve, reject) => {
          const rs = createReadStream(local)
          const ws = sftp.createWriteStream(`${DOC_ROOT}/${name}`)
          let bytes = 0
          let lastSent = 0
          rs.on('data', (d) => {
            bytes += (d as Buffer).length
            if (bytes - lastSent > 65536 || bytes === total) {
              lastSent = bytes
              this.onTransferProgress({ id, name, direction: 'upload', bytes, total, done: false })
            }
          })
          ws.on('close', () => resolve())
          rs.on('error', reject)
          ws.on('error', reject)
          rs.pipe(ws)
        })
        this.onTransferProgress({ id, name, direction: 'upload', bytes: total, total, done: true })
        ok++
      } catch (e) {
        this.onTransferProgress({
          id, name, direction: 'upload', bytes: 0, total, done: true, error: (e as Error).message
        })
      }
    }
    return ok
  }
}
