// 垃圾清理服务（只扫描、标记；删除必须由用户在界面上勾选并确认）：
//   1. SFTP 扫描设备上的可清理垃圾：
//      - 孤儿伴生目录：documents 下 X.sdr / X.dir，对应的书文件已不存在（书删掉后残留的标注/书签/进度）
//      - 系统残留文件：.fuse_hidden* / .DS_Store / ._*（macOS AppleDouble）/ Thumbs.db / desktop.ini / .Trashes
//      - 系统临时目录内容：system/tmp、system/temp（只清空内容、保留目录本身）
//      - 剪贴汇总：documents/My Clippings.txt（会随标注无限增长；删除丢失剪贴历史）
//      - 空目录：documents 下的空目录
//   2. 删除前对每个路径按同一套规则重新复核（设备状态可能已变化），
//      复核不通过则跳过——即使界面传错路径也不会误删正常文件
import type { KindleSSH } from './kindle'
import type { CleanupDeleteResult, CleanupProgress, CleanupScanResult, JunkCategory, JunkItem } from '../shared/types'
import { tMain } from './i18n'

const US_ROOT = '/mnt/us'
const DOC_ROOT = `${US_ROOT}/documents`
const SYSTEM_ROOT = `${US_ROOT}/system`
const CLIPPINGS_PATH = `${DOC_ROOT}/My Clippings.txt`
const TEMP_DIRS = [`${SYSTEM_ROOT}/tmp`, `${SYSTEM_ROOT}/temp`]

/** 与书库扫描保持一致的电子书扩展名，用于判断 .sdr 是否有对应的书 */
const BOOK_EXTS = new Set(['azw', 'azw1', 'azw2', 'azw3', 'azw4', 'mobi', 'prc', 'pdf', 'tpz', 'txt', 'epub'])

const DOC_WALK_DEPTH = 4
const SYSTEM_WALK_DEPTH = 3
/** 递归统计/删除的深度保险丝，正常 .sdr 只有 2 层 */
const MAX_DELETE_DEPTH = 8

/** documents 下系统会主动使用的已知目录，即使为空也不算垃圾（真机验证过 dictionaries 为空） */
const PROTECTED_DOC_DIRS = new Set([`${DOC_ROOT}/dictionaries`])

const S_IFMT = 0o170000
const S_IFDIR = 0o040000

const CATEGORY_ORDER: JunkCategory[] = ['orphan-sidecar', 'sys-junk', 'temp', 'clippings', 'empty-dir']

/** 渲染端默认勾选「确认无价值」的类别，其余（临时目录/剪贴/空目录）交由用户自己勾选 */
export const DEFAULT_CHECKED: JunkCategory[] = ['orphan-sidecar', 'sys-junk']

interface ReaddirEntry {
  filename: string
  attrs: { size?: number; mtime?: number; mode?: number }
}

interface RemoteStat {
  isDir: boolean
  size: number
  mtime: number
}

function sftpCall<T>(fn: (cb: (err: Error | null, res: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))))
}

function isDirMode(mode: number | undefined): boolean {
  return ((mode ?? 0) & S_IFMT) === S_IFDIR
}

/** 文件名是否属于跨系统残留垃圾（macOS/Windows 拷贝或 FUSE 删除残留） */
function isJunkFileName(name: string): boolean {
  if (name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini') return true
  if (name.startsWith('.fuse_hidden')) return true
  // macOS AppleDouble 资源叉文件（._书名.azw3 之类），隐藏文件且基本无内容价值
  if (name.startsWith('._') && name.length > 2) return true
  return false
}

/** X.sdr 是否有对应的书：同目录下存在任意 X.<书扩展名> */
function hasBookForSdr(base: string, fileNames: Iterable<string>): boolean {
  for (const n of fileNames) {
    const dot = n.lastIndexOf('.')
    if (dot <= 0) continue
    if (n.slice(0, dot) === base && BOOK_EXTS.has(n.slice(dot + 1).toLowerCase())) return true
  }
  return false
}

export class CleanupService {
  /** 扫描进行中的去重：并发请求复用同一次扫描 */
  private scanning: Promise<CleanupScanResult> | null = null

  constructor(
    private ssh: KindleSSH,
    private onProgress: (p: CleanupProgress) => void
  ) {}

  private async readdir(path: string): Promise<ReaddirEntry[] | null> {
    try {
      const sftp = await this.ssh.getSftp()
      return await sftpCall((cb) => sftp.readdir(path, cb as never) as never)
    } catch {
      return null
    }
  }

  private async stat(path: string): Promise<RemoteStat | null> {
    try {
      const sftp = await this.ssh.getSftp()
      const st = await sftpCall<{ size?: number; mtime?: number; mode?: number }>((cb) => sftp.stat(path, cb as never))
      return { isDir: isDirMode(st.mode), size: st.size ?? 0, mtime: st.mtime ?? 0 }
    } catch {
      return null
    }
  }

  /** 递归统计目录的字节数与文件数 */
  private async dirStat(path: string, depth: number): Promise<{ size: number; fileCount: number }> {
    const list = await this.readdir(path)
    if (!list) return { size: 0, fileCount: 0 }
    let size = 0
    let fileCount = 0
    for (const e of list) {
      if (e.filename === '.' || e.filename === '..') continue
      if (isDirMode(e.attrs.mode)) {
        if (depth < MAX_DELETE_DEPTH) {
          const sub = await this.dirStat(`${path}/${e.filename}`, depth + 1)
          size += sub.size
          fileCount += sub.fileCount
        }
      } else {
        size += e.attrs.size ?? 0
        fileCount++
      }
    }
    return { size, fileCount }
  }

  scan(): Promise<CleanupScanResult> {
    if (this.scanning) return this.scanning
    this.scanning = this.doScan().finally(() => (this.scanning = null))
    return this.scanning
  }

  private async doScan(): Promise<CleanupScanResult> {
    const started = Date.now()
    const items: JunkItem[] = []
    let scannedDirs = 0

    const report = (current: string): void => {
      this.onProgress({ current, found: items.length, scannedDirs })
    }

    try {
      // 1) documents 全树：孤儿伴生目录 / 空目录 / 残留垃圾文件
      await this.walkDocuments(DOC_ROOT, 0, items, () => {
        scannedDirs++
        report(DOC_ROOT)
      })

      // 2) 剪贴汇总文件（单列一项，删除会丢失剪贴历史，默认不勾选）
      const clip = await this.stat(CLIPPINGS_PATH)
      if (clip && !clip.isDir && clip.size > 0) {
        items.push({
          id: CLIPPINGS_PATH,
          path: CLIPPINGS_PATH,
          name: 'My Clippings.txt',
          category: 'clippings',
          isDir: false,
          size: clip.size,
          fileCount: 1,
          mtimeMs: clip.mtime * 1000,
          reason: tMain('main.cleanupClippings')
        })
      }

      // 3) /mnt/us 顶层残留（垃圾文件 + .Trashes 回收站目录）
      const top = await this.readdir(US_ROOT)
      scannedDirs++
      if (top) {
        for (const e of top) {
          const name = e.filename
          const path = `${US_ROOT}/${name}`
          if (isDirMode(e.attrs.mode)) {
            if (name === '.Trashes') {
              const st = await this.dirStat(path, 0)
              if (st.fileCount > 0) {
                items.push({
                  id: path, path, name, category: 'sys-junk', isDir: true,
                  size: st.size, fileCount: st.fileCount, mtimeMs: (e.attrs.mtime ?? 0) * 1000,
                  reason: tMain('main.cleanupTrash')
                })
              }
            }
          } else if (isJunkFileName(name)) {
            items.push({
              id: path, path, name, category: 'sys-junk', isDir: false,
              size: e.attrs.size ?? 0, fileCount: 1, mtimeMs: (e.attrs.mtime ?? 0) * 1000,
              reason: this.junkFileReason(name)
            })
          }
        }
      }

      // 4) system 目录（浅层）：残留垃圾文件 + 临时目录内容
      await this.walkSystem(SYSTEM_ROOT, 0, items, () => {
        scannedDirs++
        report(SYSTEM_ROOT)
      })
      for (const t of TEMP_DIRS) {
        const st = await this.stat(t)
        if (st?.isDir) {
          const inner = await this.dirStat(t, 0)
          if (inner.fileCount > 0) {
            items.push({
              id: t, path: t, name: t.slice(SYSTEM_ROOT.length + 1), category: 'temp', isDir: true, dirContents: true,
              size: inner.size, fileCount: inner.fileCount, mtimeMs: st.mtime * 1000,
              reason: tMain('main.cleanupTemp')
            })
          }
        }
      }

      items.sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
          b.size - a.size
      )
      report('')
      return { items, durationMs: Date.now() - started, scannedDirs }
    } catch (e) {
      return { items: [], error: (e as Error).message, durationMs: Date.now() - started, scannedDirs }
    }
  }

  private junkFileReason(name: string): string {
    if (name.startsWith('.fuse_hidden')) return tMain('main.cleanupFuseHidden')
    if (name === '.DS_Store') return tMain('main.cleanupDsStore')
    if (name.startsWith('._')) return tMain('main.cleanupAppleDouble')
    if (name === 'Thumbs.db' || name === 'desktop.ini') return tMain('main.cleanupThumbs')
    return tMain('main.cleanupCrossSys')
  }

  /** documents 树：每个目录里根据同目录文件判定孤儿伴生目录，进入子目录时发现空目录单独标记 */
  private async walkDocuments(
    dir: string,
    depth: number,
    items: JunkItem[],
    onDir: () => void,
    dirMtimeMs = 0
  ): Promise<void> {
    const list = await this.readdir(dir)
    onDir()
    if (!list) return
    const entries = list.filter((e) => e.filename !== '.' && e.filename !== '..')
    if (entries.length === 0 && dir !== DOC_ROOT && !PROTECTED_DOC_DIRS.has(dir)) {
      items.push({
        id: dir, path: dir, name: dir.slice(dir.lastIndexOf('/') + 1), category: 'empty-dir', isDir: true,
        size: 0, fileCount: 0, mtimeMs: dirMtimeMs, reason: tMain('main.cleanupEmptyDir')
      })
      return
    }

    const fileNames = entries.filter((e) => !isDirMode(e.attrs.mode)).map((e) => e.filename)
    for (const e of entries) {
      const name = e.filename
      const path = `${dir}/${name}`
      const mtimeMs = (e.attrs.mtime ?? 0) * 1000

      if (isDirMode(e.attrs.mode)) {
        let reason = ''
        if (name.endsWith('.sdr')) {
          reason = tMain('main.cleanupOrphanSdr')
          if (hasBookForSdr(name.slice(0, -4), fileNames)) continue
        } else if (name.endsWith('.dir')) {
          reason = tMain('main.cleanupOrphanDir')
          if (fileNames.includes(name.slice(0, -4))) continue
        } else {
          // 普通子目录（书库文件夹）：隐藏目录不深入，伴生目录不属于书库内容也不深入
          if (!name.startsWith('.') && depth < DOC_WALK_DEPTH) {
            await this.walkDocuments(path, depth + 1, items, onDir, mtimeMs)
          }
          continue
        }
        const st = await this.dirStat(path, 0)
        items.push({
          id: path, path, name, category: 'orphan-sidecar', isDir: true,
          size: st.size, fileCount: st.fileCount, mtimeMs, reason
        })
      } else if (isJunkFileName(name)) {
        items.push({
          id: path, path, name, category: 'sys-junk', isDir: false,
          size: e.attrs.size ?? 0, fileCount: 1, mtimeMs, reason: this.junkFileReason(name)
        })
      }
    }
  }

  /** system 树（浅层）：只找跨系统残留文件，不深入隐藏目录 */
  private async walkSystem(
    dir: string,
    depth: number,
    items: JunkItem[],
    onDir: () => void
  ): Promise<void> {
    const list = await this.readdir(dir)
    onDir()
    if (!list) return
    for (const e of list) {
      const name = e.filename
      if (name === '.' || name === '..' || name.startsWith('.')) continue
      const isDir = isDirMode(e.attrs.mode)
      if (isDir) {
        if (depth < SYSTEM_WALK_DEPTH) await this.walkSystem(`${dir}/${name}`, depth + 1, items, onDir)
      } else if (isJunkFileName(name)) {
        const path = `${dir}/${name}`
        items.push({
          id: path, path, name, category: 'sys-junk', isDir: false,
          size: e.attrs.size ?? 0, fileCount: 1, mtimeMs: (e.attrs.mtime ?? 0) * 1000,
          reason: this.junkFileReason(name)
        })
      }
    }
  }

  // ---------- 删除（仅处理用户显式勾选并确认的路径） ----------

  async delete(paths: string[]): Promise<CleanupDeleteResult> {
    const res: CleanupDeleteResult = { ok: 0, failed: 0, skipped: 0, freedBytes: 0, errors: [] }
    for (const p of paths) {
      try {
        if (!p.startsWith(`${US_ROOT}/`) || p.includes('/../')) {
          res.skipped++
          continue
        }
        // 删除前按扫描规则逐条复核：设备状态已变化（或路径不合法）的一律跳过
        const verdict = await this.classify(p)
        if (!verdict) {
          res.skipped++
          continue
        }
        if (verdict.dirContents) {
          const list = await this.readdir(p)
          for (const e of list ?? []) {
            if (e.filename === '.' || e.filename === '..') continue
            await this.removeRemote(`${p}/${e.filename}`, isDirMode(e.attrs.mode), 0)
          }
        } else {
          await this.removeRemote(p, verdict.isDir, 0)
        }
        res.ok++
        res.freedBytes += verdict.size
      } catch (e) {
        res.failed++
        if (res.errors.length < 8) res.errors.push(`${p}: ${(e as Error).message}`)
      }
    }
    return res
  }

  /** 独立复核单个路径此刻是否仍符合垃圾判定；返回删除所需的元数据，不合格返回 null */
  private async classify(path: string): Promise<{ isDir: boolean; dirContents?: boolean; size: number } | null> {
    if (path === CLIPPINGS_PATH) {
      const st = await this.stat(path)
      return st && !st.isDir ? { isDir: false, size: st.size } : null
    }
    if (TEMP_DIRS.includes(path)) {
      const st = await this.stat(path)
      if (!st?.isDir) return null
      const inner = await this.dirStat(path, 0)
      return inner.fileCount > 0 ? { isDir: true, dirContents: true, size: inner.size } : null
    }

    const st = await this.stat(path)
    if (!st) return null
    const parent = path.slice(0, path.lastIndexOf('/'))
    const name = path.slice(path.lastIndexOf('/') + 1)
    const underDocs = parent === DOC_ROOT || parent.startsWith(`${DOC_ROOT}/`)
    const underSystem = parent === SYSTEM_ROOT || parent.startsWith(`${SYSTEM_ROOT}/`)
    const usTop = parent === US_ROOT

    if (!st.isDir) {
      // 垃圾文件必须位于三个扫描根之内，且文件名命中残留规则
      if (!(underDocs || underSystem || usTop)) return null
      return isJunkFileName(name) ? { isDir: false, size: st.size } : null
    }

    // 目录：仅认 .Trashes（顶层）、documents 下的孤儿伴生目录、documents 下的空目录
    if (usTop && name === '.Trashes') {
      const inner = await this.dirStat(path, 0)
      return inner.fileCount > 0 ? { isDir: true, size: inner.size } : null
    }
    if (!underDocs) return null
    const parentList = await this.readdir(parent)
    if (!parentList) return null
    const fileNames = parentList
      .filter((e) => !isDirMode(e.attrs.mode) && e.filename !== '.' && e.filename !== '..')
      .map((e) => e.filename)
    if (name.endsWith('.sdr')) {
      if (hasBookForSdr(name.slice(0, -4), fileNames)) return null
    } else if (name.endsWith('.dir')) {
      if (fileNames.includes(name.slice(0, -4))) return null
    } else {
      // 空目录：readdir 无真实条目才放行；系统已知目录受保护
      const self = (await this.readdir(path))?.filter((e) => e.filename !== '.' && e.filename !== '..') ?? null
      if (!self || self.length > 0 || PROTECTED_DOC_DIRS.has(path)) return null
      return { isDir: true, size: 0 }
    }
    const inner = await this.dirStat(path, 0)
    return { isDir: true, size: inner.size }
  }

  private async removeRemote(path: string, isDir: boolean, depth: number): Promise<void> {
    if (depth > MAX_DELETE_DEPTH) throw new Error(tMain('main.cleanupDeepNest'))
    const sftp = await this.ssh.getSftp()
    if (!isDir) {
      await sftpCall((cb) => sftp.unlink(path, cb as never))
      return
    }
    const list = await this.readdir(path)
    for (const e of list ?? []) {
      if (e.filename === '.' || e.filename === '..') continue
      await this.removeRemote(`${path}/${e.filename}`, isDirMode(e.attrs.mode), depth + 1)
    }
    await sftpCall((cb) => sftp.rmdir(path, cb as never))
  }
}
