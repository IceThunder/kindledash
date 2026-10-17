import { Client, type SFTPWrapper, type ClientChannel } from 'ssh2'
import { existsSync, readFileSync } from 'fs'
import { EventEmitter } from 'events'
import dgram from 'dgram'
import os from 'os'
import path from 'path'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { Duplex } from 'stream'
import type { ConnectionSettings, ConnState } from '../shared/types'

export interface ExecResult {
  stdout: Buffer
  stderr: string
  code: number | null
}

/**
 * Pick the local address on the same IPv4 network as the Kindle.  This is
 * useful on macOS when a VPN/TUN adapter is installed: without a local bind,
 * Node follows the default route and the SSH attempt can end up on the TUN
 * interface even though the normal `ssh` command uses the Wi-Fi interface.
 */
function localAddressFor(host: string): string | undefined {
  const target = host.trim()
  const octets = target.split('.').map((v) => Number(v))
  if (octets.length !== 4 || octets.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return undefined
  const target24 = octets.slice(0, 3).join('.')
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      // Prefer an address in the Kindle's /24.  This excludes Clash's usual
      // virtual ranges (for example 198.18.0.0/15) automatically.
      if (entry.address.split('.').slice(0, 3).join('.') === target24) return entry.address
    }
  }
  return undefined
}

function joinHome(relative: string): string {
  return path.join(process.env.HOME || process.env.USERPROFILE || '', relative)
}

function systemSshWarmup(settings: ConnectionSettings, keyPath: string | undefined): Promise<boolean> {
  if (process.platform !== 'darwin' || settings.authMethod !== 'key' || !keyPath) return Promise.resolve(false)
  const target = `${settings.username || 'root'}@${settings.host.trim().replace(/^\[|\]$/g, '')}`
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/ssh',
      [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=4',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-i', keyPath,
        '-p', String(settings.port || 22),
        target,
        'true'
      ],
      { timeout: 6000, windowsHide: true },
      (error) => resolve(!error)
    )
  })
}

export class KindleSSH extends EventEmitter {
  private conn: Client | null = null
  private sftp: SFTPWrapper | null = null
  private _state: ConnState = 'disconnected'
  private lastError = ''
  private hadSession = false // 成功连接过才自动重连
  private reconnectTimer: NodeJS.Timeout | null = null
  /** 退避重连：从 5s 起步，连续失败逐步拉长到 30s 上限；无限重试（认证错误除外） */
  private backoffMs = 5000
  private initialRetries = 0
  private manualStopped = false
  /** First try the physical LAN source address; fall back to the OS route if
   * Clash/TUN rejects a socket that is explicitly bound to that address. */
  // Start with the OS route.  This is the same path used by /usr/bin/ssh and
  // is safer when a Clash TUN policy treats explicitly bound sockets
  // differently from ordinary LAN sockets.
  private bypassLocalBind = true
  private pendingShell: ((err: Error | null, ch: ClientChannel | null) => void) | null = null
  private systemSocketProcess: ChildProcessWithoutNullStreams | null = null
  /** Kindle 性能有限，所有 exec 请求串行执行，避免多个 SSH channel 同时压垮设备。 */
  private commandTail: Promise<void> = Promise.resolve()

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

  /** Electron's Node socket can be rejected by a Clash TUN policy even when
   * the same destination works from OpenSSH.  macOS's /usr/bin/nc follows the
   * system network path, so expose its stdio as the socket consumed by ssh2. */
  private createSystemSocket(host: string, port: number): Duplex | undefined {
    if (process.platform !== 'darwin') return undefined
    const child = spawn('/usr/bin/nc', ['-w', '15', host, String(port)], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.systemSocketProcess = child
    const socket = new Duplex({
      read() {
        /* data is pushed from nc.stdout below */
      },
      write: (chunk, encoding, callback) => {
        if (child.stdin.write(chunk, encoding)) callback()
        else child.stdin.once('drain', callback)
      },
      final: (callback) => {
        child.stdin.end()
        callback()
      }
    })
    child.stdout.on('data', (data: Buffer) => socket.push(data))
    child.stdout.on('end', () => socket.push(null))
    child.on('error', (error) => socket.destroy(error))
    child.on('close', () => {
      if (!socket.destroyed) socket.push(null)
      if (this.systemSocketProcess === child) this.systemSocketProcess = null
    })
    return socket
  }

  connect(settings: ConnectionSettings): Promise<void> {
    this.manualStopped = false
    this.disconnectInternal()
    this.setState('connecting')

    const conn = new Client()
    this.conn = conn

    const host = settings.host.trim().replace(/^\[|\]$/g, '')
    const localAddress = this.bypassLocalBind ? undefined : localAddressFor(host)
    const opts: Record<string, unknown> = {
      host,
      port: settings.port || 22,
      username: settings.username || 'root',
      keepaliveInterval: 10000,
      readyTimeout: 12000,
      debug: false
    }
    if (localAddress) opts.localAddress = localAddress
    const systemSocket = this.createSystemSocket(host, settings.port || 22)
    if (systemSocket) {
      opts.sock = systemSocket
      delete opts.host
      delete opts.port
      delete opts.localAddress
    }
    let selectedKeyPath: string | undefined
    if (settings.authMethod === 'key') {
      // Match the OpenSSH command's normal behavior: use ssh-agent when it is
      // available, and fall back to common default key files if the UI field
      // is empty.  Previously agent:false made `ssh` work while KindleDash
      // failed whenever the key lived only in the agent/keychain.
      const agent = process.env.SSH_AUTH_SOCK
      if (agent) opts.agent = agent
      const configured = settings.privateKeyPath.trim().replace(/^~/, process.env.HOME || '')
      const candidates = configured
        ? [configured]
        : [joinHome('.ssh/id_ed25519'), joinHome('.ssh/id_rsa'), joinHome('.ssh/id_ecdsa')]
      selectedKeyPath = candidates.find((p) => existsSync(p))
      if (selectedKeyPath) {
        try {
          opts.privateKey = readFileSync(selectedKeyPath)
        } catch (e) {
          this.lastError = `无法读取私钥: ${(e as Error).message}`
          this.setState('error')
          return Promise.reject(new Error(this.lastError))
        }
      } else if (!agent) {
        this.lastError = '未找到 SSH 私钥；请填写私钥路径，或启动 ssh-agent 后重试'
        this.setState('error')
        return Promise.reject(new Error(this.lastError))
      }
    } else {
      opts.password = settings.password
    }

    return new Promise((resolve, reject) => {
      const onReady = () => {
        this.hadSession = true
        this.backoffMs = 5000
        this.initialRetries = 0
        this.lastError = ''
        this.setState('connected')
        resolve()
      }
      const onError = (err: Error) => {
        this.lastError = err.message
        // 路由/主机不可达的常见诱因：设备休眠断网，或 VPN/代理 TUN 劫持路由
        if (err.message.includes('EHOSTUNREACH') || err.message.includes('ENETUNREACH')) {
          // A TUN rule can reject the explicitly bound socket while allowing
          // the same destination through the normal route (as /usr/bin/ssh
          // does). The next attempt must therefore drop localAddress.
          this.bypassLocalBind = true
          this.lastError +=
            ` — 无法到达 Kindle（已${localAddress ? `绑定本机 ${localAddress}` : '使用系统路由'}）；请确认 Kindle 唤醒，并在 Clash 中将 ${host} 或 192.168.0.0/16 设为 DIRECT`
          void this.probeLocalNetworkPermission()
          void this.warmupWithSystemSsh(settings, selectedKeyPath)
        }
        if (this._state === 'connecting' || this._state === 'reconnecting') {
          this.setState('error')
          // Return the same actionable message to the settings dialog as the
          // status bar receives; otherwise the renderer only shows the raw
          // EHOSTUNREACH code and hides the DIRECT-route hint.
          reject(new Error(this.lastError))
          // 认证/配置类错误不自动重试（避免密码错误时无限循环）；
          // 网络类错误（EHOSTUNREACH/ETIMEDOUT/ECONNREFUSED 等）按退避无限重试
          const authFailed = (err as Error & { level?: string }).level === 'client-authentication'
          if (!authFailed && !this.manualStopped) this.scheduleReconnect()
        }
      }
      conn.once('ready', onReady)
      conn.once('error', onError)
      conn.on('close', () => {
        this.sftp = null
        if (this._state === 'connected') {
          // 意外断开（网络波动/设备重启/Mac 睡眠唤醒）→ 自动重连
          this.scheduleReconnect()
        }
      })
      conn.on('error', () => {}) // 后续错误走 close 流程
      conn.connect(opts as never)
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.manualStopped) return
    // 本次启动从未成功连过（如密码错误、启动时设备休眠）也允许有限次自动重试，
    // 避免启动瞬间撞上网络窗口后永久放弃；成功连接过则无限退避重试
    if (!this.hadSession) {
      this.initialRetries++
      if (this.initialRetries > 10) return
    }
    this.setState('reconnecting')
    const settings = this.lastSettings
    const delay = this.backoffMs
    this.backoffMs = Math.min(30000, this.backoffMs * 2)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (settings && !this.manualStopped) {
        this.connect(settings).catch(() => {})
      }
    }, delay)
  }

  /** 立即重试（Mac 唤醒/网络恢复时调用），并重置退避 */
  retryNow(): void {
    if (this._state !== 'connected' && this._state !== 'connecting') {
      this.backoffMs = 5000
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      if (this.lastSettings && !this.manualStopped) {
        this.connect(this.lastSettings).catch(() => {})
      }
    }
  }

  private lastProbeAt = 0
  private lastWarmupAt = 0

  /** macOS「本地网络」权限探测：未授权 app 的纯 TCP 单播连接会被静默 EHOSTUNREACH，
   *  且不触发系统授权弹窗、也不出现在设置列表里；发送一次 mDNS 组播查询即可触发弹窗。
   *  用户点「允许」后组播恢复畅通 → 此处立即重连，无需等退避计时 */
  private async probeLocalNetworkPermission(): Promise<void> {
    if (process.platform !== 'darwin') return
    const now = Date.now()
    if (now - this.lastProbeAt < 10000) return
    this.lastProbeAt = now
    // _services._dns-sd._udp.local 的 PTR 查询（DNS-SD 服务枚举标准报文）
    const name = (label: string): number[] => [label.length, ...Buffer.from(label)]
    const query = Buffer.from([
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      ...name('_services'), ...name('_dns-sd'), ...name('_udp'), ...name('local'), 0,
      0, 0x0c, 0, 1
    ])
    const granted = await new Promise<boolean>((resolve) => {
      const sock = dgram.createSocket('udp4')
      const finish = (ok: boolean): void => {
        clearTimeout(timer)
        try {
          sock.close()
        } catch {
          /* ignore */
        }
        resolve(ok)
      }
      const timer = setTimeout(() => finish(false), 2000)
      sock.once('error', () => finish(false))
      sock.send(query, 5353, '224.0.0.251', (err) => finish(!err))
    })
    if (granted && this._state !== 'connected') this.retryNow()
  }

  /** macOS/Clash 启动瞬间可能让 Node 的 socket 先收到 EHOSTUNREACH，
   *  而系统 OpenSSH 可以正常建立同一目标的连接。用系统 SSH 预热 ARP/路由
   *  后再重试 ssh2，保持后续 SFTP/终端仍由本应用管理。 */
  private async warmupWithSystemSsh(settings: ConnectionSettings, keyPath: string | undefined): Promise<void> {
    const now = Date.now()
    if (now - this.lastWarmupAt < 10000) return
    this.lastWarmupAt = now
    const ok = await systemSshWarmup(settings, keyPath)
    this.emit('warmup', ok)
    if (ok) this.retryNow()
  }

  private lastSettings: ConnectionSettings | null = null

  connectAndRemember(settings: ConnectionSettings): Promise<void> {
    this.lastSettings = settings
    return this.connect(settings)
  }

  disconnect(): void {
    this.manualStopped = true
    this.hadSession = false
    this.disconnectInternal()
    this.setState('disconnected')
  }

  private disconnectInternal() {
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
    if (this.systemSocketProcess) {
      try {
        this.systemSocketProcess.kill()
      } catch {
        /* ignore */
      }
      this.systemSocketProcess = null
    }
  }

  private ensureConn(): Client {
    if (!this.conn || this._state !== 'connected') {
      throw new Error('SSH 未连接')
    }
    return this.conn
  }

  /** 执行远程命令并收集输出 */
  exec(cmd: string, timeoutMs = 15000): Promise<ExecResult> {
    const run = () => this.execDirect(cmd, timeoutMs)
    const result = this.commandTail.then(run, run)
    this.commandTail = result.then(() => undefined, () => undefined)
    return result
  }

  private execDirect(cmd: string, timeoutMs: number): Promise<ExecResult> {
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
