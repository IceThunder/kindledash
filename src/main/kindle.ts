import { Client, type SFTPWrapper, type ClientChannel } from 'ssh2'
import { readFileSync } from 'fs'
import { EventEmitter } from 'events'
import type { ConnectionSettings, ConnState } from '../shared/types'

export interface ExecResult {
  stdout: Buffer
  stderr: string
  code: number | null
}

export class KindleSSH extends EventEmitter {
  private conn: Client | null = null
  private sftp: SFTPWrapper | null = null
  private _state: ConnState = 'disconnected'
  private lastError = ''
  private hadSession = false // 成功连接过才自动重连
  private reconnectTimer: NodeJS.Timeout | null = null
  private retriesLeft = 0
  private pendingShell: ((err: Error | null, ch: ClientChannel | null) => void) | null = null

  get state(): ConnState {
    return this._state
  }

  get error(): string {
    return this.lastError
  }

  private setState(s: ConnState) {
    this._state = s
    this.emit('state', s, this.lastError)
  }

  connect(settings: ConnectionSettings): Promise<void> {
    this.disconnectInternal(false)
    this.setState('connecting')

    const conn = new Client()
    this.conn = conn

    const opts: Record<string, unknown> = {
      host: settings.host,
      port: settings.port || 22,
      username: settings.username || 'root',
      // 禁用 SSH agent：只用显式提供的私钥/密码认证，
      // 避免 macOS 尝试从钥匙串取密钥时弹出授权对话框
      agent: false,
      keepaliveInterval: 10000,
      readyTimeout: 12000,
      debug: false
    }
    if (settings.authMethod === 'key') {
      try {
        opts.privateKey = readFileSync(settings.privateKeyPath.replace(/^~/, process.env.HOME || ''))
      } catch (e) {
        this.lastError = `无法读取私钥: ${(e as Error).message}`
        this.setState('error')
        return Promise.reject(new Error(this.lastError))
      }
    } else {
      opts.password = settings.password
    }

    return new Promise((resolve, reject) => {
      const onReady = () => {
        this.hadSession = true
        this.retriesLeft = 0
        this.lastError = ''
        this.setState('connected')
        resolve()
      }
      const onError = (err: Error) => {
        this.lastError = err.message
        if (this._state === 'connecting' || this._state === 'reconnecting') {
          this.setState('error')
          reject(err)
          this.scheduleReconnect()
        }
      }
      conn.once('ready', onReady)
      conn.once('error', onError)
      conn.on('close', () => {
        this.sftp = null
        if (this._state === 'connected') {
          // 意外断开（网络波动/设备重启）→ 自动重连
          this.retriesLeft = 30
          this.scheduleReconnect()
        }
      })
      conn.on('error', () => {}) // 后续错误走 close 流程
      conn.connect(opts as never)
    })
  }

  private scheduleReconnect() {
    if (!this.hadSession || this.reconnectTimer) return
    if (this.retriesLeft <= 0) return
    this.retriesLeft--
    this.setState('reconnecting')
    const settings = this.lastSettings
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (settings) {
        this.connect(settings).catch(() => {})
      }
    }, 5000)
  }

  private lastSettings: ConnectionSettings | null = null

  connectAndRemember(settings: ConnectionSettings): Promise<void> {
    this.lastSettings = settings
    return this.connect(settings)
  }

  disconnect(): void {
    this.hadSession = false
    this.retriesLeft = 0
    this.disconnectInternal(true)
    this.setState('disconnected')
  }

  private disconnectInternal(notify: boolean) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pendingShell) {
      this.pendingShell(new Error('disconnected'), null)
      this.pendingShell = null
    }
    this.sftp = null
    if (this.conn) {
      try {
        this.conn.end()
      } catch {
        /* ignore */
      }
      this.conn = null
    }
    if (!notify) this.hadSession = this.hadSession && false
    void notify
  }

  private ensureConn(): Client {
    if (!this.conn || this._state !== 'connected') {
      throw new Error('SSH 未连接')
    }
    return this.conn
  }

  /** 执行远程命令并收集输出 */
  exec(cmd: string, timeoutMs = 15000): Promise<ExecResult> {
    const conn = this.ensureConn()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`命令超时: ${cmd.slice(0, 60)}`)), timeoutMs)
      conn.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer)
          return reject(err)
        }
        const chunks: Buffer[] = []
        let stderr = ''
        stream.on('data', (d: Buffer) => chunks.push(d))
        stream.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
        stream.on('close', (code: number | null) => {
          clearTimeout(timer)
          resolve({ stdout: Buffer.concat(chunks), stderr, code })
        })
        stream.on('error', (e: Error) => {
          clearTimeout(timer)
          reject(e)
        })
      })
    })
  }

  async execText(cmd: string, timeoutMs?: number): Promise<string> {
    const r = await this.exec(cmd, timeoutMs)
    return r.stdout.toString('utf8')
  }

  /** 获取（复用的）SFTP 会话 */
  getSftp(): Promise<SFTPWrapper> {
    if (this.sftp) return Promise.resolve(this.sftp)
    const conn = this.ensureConn()
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) return reject(err)
        sftp.on('close', () => (this.sftp = null))
        this.sftp = sftp
        resolve(sftp)
      })
    })
  }

  /** 打开交互式 shell（终端页用） */
  shell(cols: number, rows: number): Promise<ClientChannel> {
    const conn = this.ensureConn()
    return new Promise((resolve, reject) => {
      conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return reject(err)
        resolve(stream)
      })
    })
  }
}
