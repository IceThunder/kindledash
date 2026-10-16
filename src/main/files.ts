import { createReadStream, createWriteStream, statSync } from 'fs'
import { readFile, readdir, mkdir } from 'fs/promises'
import { join, basename } from 'path'
import type { KindleSSH } from './kindle'
import type { FileEntry, TransferProgress } from '../shared/types'

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

export function toFileEntry(filename: string, longname: string, attrs: {
  size?: number
  mtime?: number
  mode?: number
  uid?: number
  gid?: number
}): FileEntry {
  const mode = attrs.mode ?? 0
  const fmt = mode & S_IFMT
  return {
    name: filename,
    longname,
    isDir: fmt === S_IFDIR,
    isSymlink: fmt === S_IFLNK,
    size: attrs.size ?? 0,
    mtimeMs: (attrs.mtime ?? 0) * 1000,
    mode,
    uid: attrs.uid ?? -1,
    gid: attrs.gid ?? -1
  }
}

export class FileService {
  constructor(
    private ssh: KindleSSH,
    private onProgress: (p: TransferProgress) => void
  ) {}

  async list(path: string): Promise<{ path: string; entries: FileEntry[]; error?: string }> {
    try {
      const sftp = await this.ssh.getSftp()
      const raw = await new Promise<{ filename: string; longname: string; attrs: { size?: number; mtime?: number; mode?: number; uid?: number; gid?: number } }[]>(
        (resolve, reject) => {
          sftp.readdir(path, (err, list) => (err ? reject(err) : resolve(list as never)))
        }
      )
      const entries = raw
        .map((e) => toFileEntry(e.filename, e.longname, e.attrs))
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
      return { path, entries }
    } catch (e) {
      return { path, entries: [], error: (e as Error).message }
    }
  }

  async mkdir(path: string): Promise<string | null> {
    const sftp = await this.ssh.getSftp()
    return new Promise((resolve) => {
      sftp.mkdir(path, (err) => resolve(err ? err.message : null))
    })
  }

  async rename(from: string, to: string): Promise<string | null> {
    const sftp = await this.ssh.getSftp()
    return new Promise((resolve) => {
      sftp.rename(from, to, (err) => resolve(err ? err.message : null))
    })
  }

  /** 删除文件或空目录；目录递归删除 */
  async delete(path: string, isDir: boolean): Promise<string | null> {
    const sftp = await this.ssh.getSftp()
    if (!isDir) {
      return new Promise((resolve) => {
        sftp.unlink(path, (err) => resolve(err ? err.message : null))
      })
    }
    // 递归
    const list = await this.list(path)
    if (list.error) return list.error
    for (const e of list.entries) {
      if (e.name === '.' || e.name === '..') continue
      const err = await this.delete(join(path, e.name).replace(/\\/g, '/'), e.isDir)
      if (err) return err
    }
    return new Promise((resolve) => {
      sftp.rmdir(path, (err) => resolve(err ? err.message : null))
    })
  }

  async chmod(path: string, mode: number): Promise<string | null> {
    const sftp = await this.ssh.getSftp()
    return new Promise((resolve) => {
      sftp.setstat(path, { mode }, (err) => resolve(err ? err.message : null))
    })
  }

  /** 读取小文本文件用于预览 */
  async readTextFile(path: string, maxBytes = 1024 * 1024): Promise<{ text: string; error?: string }> {
    try {
      const sftp = await this.ssh.getSftp()
      const buf = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        const stream = sftp.createReadStream(path, { start: 0, end: maxBytes })
        stream.on('data', (d: Buffer) => chunks.push(d))
        stream.on('error', reject)
        stream.on('end', () => resolve(Buffer.concat(chunks)))
      })
      return { text: buf.toString('utf8') }
    } catch (e) {
      return { text: '', error: (e as Error).message }
    }
  }

  private nextId = 1

  async upload(localPath: string, remoteDir: string): Promise<void> {
    const id = this.nextId++
    const remotePath = `${remoteDir.replace(/\/$/, '')}/${basename(localPath)}`
    const total = statSync(localPath).size
    const name = basename(localPath)
    this.onProgress({ id, name, direction: 'upload', bytes: 0, total, done: false })
    try {
      const sftp = await this.ssh.getSftp()
      await new Promise<void>((resolve, reject) => {
        const rs = createReadStream(localPath)
        const ws = sftp.createWriteStream(remotePath)
        let bytes = 0
        let lastSent = 0
        rs.on('data', (d) => {
          bytes += (d as Buffer).length
          if (bytes - lastSent > 65536 || bytes === total) {
            lastSent = bytes
            this.onProgress({ id, name, direction: 'upload', bytes, total, done: false })
          }
        })
        ws.on('close', () => resolve())
        rs.on('error', reject)
        ws.on('error', reject)
        rs.pipe(ws)
      })
      this.onProgress({ id, name, direction: 'upload', bytes: total, total, done: true })
    } catch (e) {
      this.onProgress({ id, name, direction: 'upload', bytes: 0, total, done: true, error: (e as Error).message })
    }
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    const id = this.nextId++
    const name = basename(remotePath)
    try {
      const sftp = await this.ssh.getSftp()
      const attrs = await new Promise<{ size?: number }>((resolve, reject) => {
        sftp.stat(remotePath, (err, st) => (err ? reject(err) : resolve(st as never)))
      })
      const total = attrs.size ?? 0
      this.onProgress({ id, name, direction: 'download', bytes: 0, total, done: false })
      await new Promise<void>((resolve, reject) => {
        const rs = sftp.createReadStream(remotePath)
        const ws = createWriteStream(localPath)
        let bytes = 0
        let lastSent = 0
        rs.on('data', (d: Buffer) => {
          bytes += d.length
          if (bytes - lastSent > 65536 || bytes >= total) {
            lastSent = bytes
            this.onProgress({ id, name, direction: 'download', bytes, total, done: false })
          }
        })
        ws.on('close', () => resolve())
        rs.on('error', reject)
        ws.on('error', reject)
        rs.pipe(ws)
      })
      this.onProgress({ id, name, direction: 'download', bytes: total, total, done: true })
    } catch (e) {
      this.onProgress({ id, name, direction: 'download', bytes: 0, total: 0, done: true, error: (e as Error).message })
    }
  }

  /** 上传本地目录（递归） */
  async uploadDir(localDir: string, remoteDir: string): Promise<void> {
    const entries = await readdir(localDir, { withFileTypes: true })
    for (const e of entries) {
      const local = join(localDir, e.name)
      const remote = `${remoteDir.replace(/\/$/, '')}/${e.name}`
      if (e.isDirectory()) {
        await this.mkdir(remote)
        await this.uploadDir(local, remote)
      } else if (e.isFile()) {
        await this.upload(local, remoteDir)
      }
    }
  }

  /** 读取本地文件内容（打包给渲染进程的文本预览等场景预留） */
  async readLocalText(path: string): Promise<string> {
    return (await readFile(path, 'utf8')).slice(0, 100000)
  }
}

export async function ensureLocalDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}
