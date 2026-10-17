import { app, BrowserWindow, ipcMain, dialog, Menu, shell, powerMonitor } from 'electron'
import { statSync } from 'fs'
import { join } from 'path'
import { writeFile, readFile, appendFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { KindleSSH } from './kindle'
import { ScreenService } from './screen'
import { STATS_SCRIPT, STATS_LIGHT_SCRIPT, parseStatsOutput, fetchDeviceInfo, fetchStorageInfo, fetchThreads, type ParsedStat } from './stats'
import { FileService } from './files'
import type { DeviceProfile, DeviceStore, StatsSnapshot, TransferProgress, ScreenFrame, ConnState } from '../shared/types'

const EMPTY_PROFILE: Omit<DeviceProfile, 'id' | 'name'> = {
  host: '',
  port: 22,
  username: 'root',
  authMethod: 'key',
  privateKeyPath: '',
  password: '',
  keepAwake: true
}

// ---------- 简单文件日志（连接问题排查用） ----------

function appendLog(line: string): void {
  const ts = new Date().toISOString()
  const out = `[${ts}] ${line}\n`
  console.log(out.trim())
  void appendFile(join(app.getPath('userData'), 'kindledash.log'), out).catch(() => {})
}

// ---------- 设备配置持久化（userData/devices.json） ----------

function devicesPath(): string {
  return join(app.getPath('userData'), 'devices.json')
}

function legacySettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let deviceStore: DeviceStore = { devices: [], lastActiveId: null }

async function loadDeviceStore(): Promise<DeviceStore> {
  try {
    const data = JSON.parse(await readFile(devicesPath(), 'utf8'))
    if (Array.isArray(data.devices)) {
      deviceStore = { devices: data.devices, lastActiveId: data.lastActiveId ?? null }
      return deviceStore
    }
  } catch {
    /* 首次运行或文件损坏，走迁移 */
  }
  // 旧版单设备 settings.json → 迁移为第一个设备配置
  try {
    const legacy = JSON.parse(await readFile(legacySettingsPath(), 'utf8'))
    if (legacy && legacy.host) {
      const profile: DeviceProfile = {
        ...EMPTY_PROFILE,
        ...legacy,
        id: randomUUID(),
        name: `Kindle (${legacy.host})`
      }
      deviceStore = { devices: [profile], lastActiveId: profile.id }
      await saveDeviceStore()
      return deviceStore
    }
  } catch {
    /* 无旧配置 */
  }
  deviceStore = { devices: [], lastActiveId: null }
  return deviceStore
}

async function saveDeviceStore(): Promise<void> {
  await writeFile(devicesPath(), JSON.stringify(deviceStore, null, 2))
}

// 连接期间阻止 Kindle 自动休眠（休眠会断开 WiFi 导致 SSH 掉线）
const KEEP_AWAKE_ON = '/usr/bin/lipc-set-prop com.lab126.powerd preventScreenSaver 1'
const KEEP_AWAKE_OFF = '/usr/bin/lipc-set-prop com.lab126.powerd preventScreenSaver 0'
let currentSettings: DeviceProfile | null = null

let mainWindow: BrowserWindow | null = null
const ssh = new KindleSSH()
const screenService = new ScreenService()
let fileService: FileService | null = null

let statsTimer: NodeJS.Timeout | null = null
let prevCpu: ParsedStat | null = null
let prevProcs: Map<number, number> | null = null
let pendingScreenInterval = 0

// 终端通道
let termStream: import('ssh2').ClientChannel | null = null

function send(ch: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(ch, ...args)
  }
}

function stopStats(): void {
  if (statsTimer) clearInterval(statsTimer)
  statsTimer = null
  prevCpu = null
  prevProcs = null
}

function startStats(intervalMs: number, includeProcesses = false): void {
  stopStats()
  if (intervalMs <= 0) return
  let busy = false
  const tick = async () => {
    // 串行化：设备繁忙、上一拍尚未返回时跳过本拍，
    // 避免并发 exec 通道堆积把连接压垮
    if (ssh.state !== 'connected' || busy) return
    busy = true
    try {
      const raw = await ssh.execText(includeProcesses ? STATS_SCRIPT : STATS_LIGHT_SCRIPT)
      const snap = parseStatsOutput(raw, prevCpu, prevProcs)
      if (process.env.KD_DEBUG) console.log(`[stats] cpu%=${snap?.cpuPercent} load=${snap?.load?.join(',')} memUsed=${snap?.mem?.usedKB} rawLen=${raw.length}`)
      if (snap) {
        prevCpu = snap.cpuJiffies
        prevProcs = new Map(snap.procs.map((p) => [p.pid, p.utime + p.stime]))
        send('kd:stats', snap)
      }
    } catch {
      /* 单次失败静默跳过，等下一拍 */
    } finally {
      busy = false
    }
  }
  void tick()
  statsTimer = setInterval(tick, intervalMs)
}

/** 恢复设备自动休眠（断开/退出前调用） */
async function restoreKeepAwake(): Promise<void> {
  if (ssh.state === 'connected' && currentSettings?.keepAwake) {
    try {
      await ssh.exec(KEEP_AWAKE_OFF, 3000)
    } catch {
      /* 尽力而为 */
    }
  }
}

function resetTerminal(): void {
  if (termStream) {
    try {
      termStream.close()
    } catch {
      /* ignore */
    }
    termStream = null
  }
}

ssh.on('state', (state: ConnState, err: string) => {
  send('kd:state', state, err)
  appendLog(`连接状态: ${state}${err ? ` — ${err}` : ''}`)
  if (state === 'connected') {
    fileService = new FileService(ssh, (p: TransferProgress) => send('kd:transfer-progress', p))
    screenService.bind(ssh)
    if (currentSettings?.keepAwake) {
      void ssh.exec(KEEP_AWAKE_ON, 5000).catch(() => {})
    }
    if (pendingScreenInterval > 0) {
      screenService.start(
        pendingScreenInterval,
        (f: ScreenFrame) => send('kd:screen-frame', f),
        (msg: string) => send('kd:screen-error', msg)
      )
    }
  } else if (state === 'disconnected' || state === 'error') {
    screenService.bind(null)
    stopStats()
    resetTerminal()
  }
})
ssh.on('warmup', (ok: boolean) => appendLog(`系统 SSH 预热: ${ok ? '成功' : '失败'}`))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'KindleDash',
    backgroundColor: '#0d1117',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // QA 巡游模式（env 门控）：KD_TOUR=1 KD_SHOT_DIR=/tmp/kdshots 时自动遍历页面截图
  const shotDir = process.env.KD_SHOT_DIR
  if (process.env.KD_TOUR && shotDir) {
    void (async () => {
      const { mkdir } = await import('fs/promises')
      await mkdir(shotDir, { recursive: true })
      await new Promise((r) => setTimeout(r, 6000))
      const tabs = ['overview', 'procs', 'files', 'term']
      for (let i = 0; i < tabs.length; i++) {
        if (!mainWindow) break
        try {
          await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.nav-item')[${i}]?.click()`)
          await new Promise((r) => setTimeout(r, 5000))
          if (!mainWindow) break
          // 小窗口下截屏验证屏幕镜像自适应缩放
          if (tabs[i] === 'screen') {
            const [ow, oh] = mainWindow.getSize()
            mainWindow.setSize(880, 640)
            await new Promise((r) => setTimeout(r, 1500))
            const imgSmall = await mainWindow.webContents.capturePage()
            await writeFile(join(shotDir, 'page-screen-small.png'), imgSmall.toPNG())
            console.log('[tour] captured screen-small')
            mainWindow.setSize(ow, oh)
            await new Promise((r) => setTimeout(r, 800))
          }
          // 终端页：自动打开 shell 并对比 ls(?) 与 ll(中文) 的显示
          if (tabs[i] === 'term') {
            await ssh.exec('touch "/tmp/中文测试文件.txt"').catch(() => {})
            await mainWindow.webContents.executeJavaScript(
              `[...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('打开终端'))?.click()`
            )
            await new Promise((r) => setTimeout(r, 3000))
            termStream?.write('ls /tmp\r')
            await new Promise((r) => setTimeout(r, 1200))
            termStream?.write('ll /tmp\r')
            await new Promise((r) => setTimeout(r, 1500))
          }
          const img = await mainWindow.webContents.capturePage()
          await writeFile(join(shotDir, `page-${tabs[i]}.png`), img.toPNG())
          console.log(`[tour] captured ${tabs[i]}`)
        } catch (e) {
          console.log(`[tour] failed ${tabs[i]}:`, (e as Error).message)
        }
      }
      // 验证设置菜单与亮色主题
      try {
        await mainWindow.webContents.executeJavaScript(`[...document.querySelectorAll('.footer-btn')].find(b=>b.textContent?.includes('⚙'))?.click()`)
        await new Promise((r) => setTimeout(r, 900))
        const menuShot = await mainWindow.webContents.capturePage()
        await writeFile(join(shotDir, 'page-menu.png'), menuShot.toPNG())
        console.log('[tour] captured menu')
        await mainWindow.webContents.executeJavaScript(`[...document.querySelectorAll('.footer-btn')].find(b=>b.textContent?.includes('⚙'))?.click()`)
        // 主题切到浅色再截一张总览
        await mainWindow.webContents.executeJavaScript(`[...document.querySelectorAll('.footer-btn')].find(b=>b.textContent?.match(/◐|☀|☾/))?.click()`)
        await new Promise((r) => setTimeout(r, 400))
        await mainWindow.webContents.executeJavaScript(`[...document.querySelectorAll('.footer-btn')].find(b=>b.textContent?.match(/◐|☀|☾/))?.click()`)
        await new Promise((r) => setTimeout(r, 900))
        await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('.nav-item')[0]?.click()`)
        await new Promise((r) => setTimeout(r, 2500))
        const lightShot = await mainWindow.webContents.capturePage()
        await writeFile(join(shotDir, 'page-light.png'), lightShot.toPNG())
        console.log('[tour] captured light theme')
      } catch (e) {
        console.log('[tour] menu/theme failed:', (e as Error).message)
      }
      console.log('[tour] done')
    })()
  }

  // 外部链接走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      label: 'KindleDash',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ])
)

// ---------- IPC ----------

ipcMain.handle('kd:connect', async (_e, profile: DeviceProfile) => {
  currentSettings = profile
  deviceStore.lastActiveId = profile.id
  await saveDeviceStore()
  await ssh.connectAndRemember(profile)
  return true
})

ipcMain.handle('kd:disconnect', async () => {
  pendingScreenInterval = 0
  screenService.stop()
  // 注意：此处不恢复设备自动休眠——断开后若允许 Kindle 休眠，
  // 其 WiFi 会停止应答导致后续连接失败（EHOSTUNREACH），仅应用退出时恢复
  ssh.disconnect()
  return true
})

// ---------- 设备配置 CRUD ----------

ipcMain.handle('kd:devices-list', () => deviceStore)

ipcMain.handle('kd:device-save', async (_e, profile: DeviceProfile, connectNow: boolean) => {
  const i = deviceStore.devices.findIndex((d) => d.id === profile.id)
  if (i >= 0) {
    deviceStore.devices[i] = profile
  } else {
    deviceStore.devices.push(profile)
  }
  await saveDeviceStore()
  if (connectNow) {
    currentSettings = profile
    deviceStore.lastActiveId = profile.id
    await saveDeviceStore()
    await ssh.connectAndRemember(profile)
  }
  return deviceStore
})

ipcMain.handle('kd:device-delete', async (_e, id: string) => {
  deviceStore.devices = deviceStore.devices.filter((d) => d.id !== id)
  if (deviceStore.lastActiveId === id) deviceStore.lastActiveId = null
  await saveDeviceStore()
  if (currentSettings && (currentSettings as DeviceProfile).id === id) {
    pendingScreenInterval = 0
    screenService.stop()
    ssh.disconnect()
  }
  return deviceStore
})

// ---------- 通用 ----------

ipcMain.handle('kd:pick-key-file', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: '选择 SSH 私钥文件',
    properties: ['openFile'],
    filters: [
      { name: '私钥文件', extensions: ['pem', 'key', 'id_rsa', 'id_ed25519', 'openssh'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  return canceled || !filePaths.length ? null : filePaths[0]
})

ipcMain.handle('kd:open-external', (_e, url: string) => {
  if (/^https:\/\//.test(url)) void shell.openExternal(url)
  return true
})

ipcMain.handle('kd:app-version', () => app.getVersion())

ipcMain.handle('kd:set-last-active', async (_e, id: string) => {
  deviceStore.lastActiveId = id
  await saveDeviceStore()
  return true
})

ipcMain.handle('kd:device-info', async () => fetchDeviceInfo(ssh))
ipcMain.handle('kd:storage-info', async () => fetchStorageInfo(ssh))

ipcMain.handle('kd:stats-start', (_e, intervalMs: number, includeProcesses = false) => {
  // The stats command scans /proc/[0-9]*/stat and is relatively expensive on
  // older Kindles. Keep a safe floor even if an old renderer requests 500ms.
  startStats(Math.max(2000, intervalMs), includeProcesses)
  return true
})
ipcMain.handle('kd:stats-stop', () => {
  stopStats()
  return true
})

ipcMain.handle('kd:screen-start', (_e, intervalMs: number) => {
  pendingScreenInterval = intervalMs
  if (intervalMs <= 0) {
    screenService.stop()
    return true
  }
  screenService.start(
    intervalMs,
    (f) => send('kd:screen-frame', f),
    (msg) => send('kd:screen-error', msg)
  )
  return true
})
ipcMain.handle('kd:screen-stop', () => {
  pendingScreenInterval = 0
  screenService.stop()
  return true
})
ipcMain.handle('kd:screen-refresh', () => {
  screenService.refresh(ssh)
  return true
})
ipcMain.handle('kd:screen-last', () => screenService.frame)

ipcMain.handle('kd:save-screenshot', async (_e, dataUrl: string) => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    defaultPath: `kindle-screen-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
  })
  if (canceled || !filePath) return null
  const b64 = dataUrl.split(',')[1]
  await writeFile(filePath, Buffer.from(b64, 'base64'))
  return filePath
})

ipcMain.handle('kd:list-threads', (_e, pid: number) => fetchThreads(ssh, pid))

ipcMain.handle('kd:kill', async (_e, pid: number, sig: string) => {
  const r = await ssh.exec(`kill -${sig} ${pid} 2>&1; echo EXIT:$?`)
  return r.stdout.toString().trim()
})

ipcMain.handle('kd:reboot', async () => {
  const r = await ssh.exec('(sleep 1; /sbin/reboot) >/dev/null 2>&1 & echo REBOOTING')
  return r.stdout.toString().includes('REBOOTING')
})

ipcMain.handle('kd:exec', async (_e, cmd: string) => {
  const r = await ssh.exec(cmd, 20000)
  return { stdout: r.stdout.toString('utf8'), stderr: r.stderr, code: r.code }
})

// ---------- 文件管理 ----------

ipcMain.handle('kd:fs-list', (_e, path: string) => fileService?.list(path) ?? { path, entries: [], error: '未连接' })
ipcMain.handle('kd:fs-mkdir', (_e, path: string) => fileService?.mkdir(path) ?? '未连接')
ipcMain.handle('kd:fs-rename', (_e, from: string, to: string) => fileService?.rename(from, to) ?? '未连接')
ipcMain.handle('kd:fs-delete', (_e, path: string, isDir: boolean) => fileService?.delete(path, isDir) ?? '未连接')
ipcMain.handle('kd:fs-chmod', (_e, path: string, mode: number) => fileService?.chmod(path, mode) ?? '未连接')
ipcMain.handle('kd:fs-read-text', (_e, path: string) => fileService?.readTextFile(path) ?? { text: '', error: '未连接' })

ipcMain.handle('kd:fs-upload', async (_e, remoteDir: string) => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: '选择要上传的文件或文件夹',
    properties: ['openFile', 'multiSelections', 'openDirectory', 'createDirectory']
  })
  if (canceled || !filePaths.length || !fileService) return 0
  for (const p of filePaths) {
    const st = statSyncSafe(p)
    if (st?.isDirectory()) {
      const name = p.split('/').filter(Boolean).pop() ?? 'upload'
      await fileService.mkdir(`${remoteDir.replace(/\/$/, '')}/${name}`)
      await fileService.uploadDir(p, `${remoteDir.replace(/\/$/, '')}/${name}`)
    } else {
      await fileService.upload(p, remoteDir)
    }
  }
  return filePaths.length
})

ipcMain.handle('kd:fs-download', async (_e, remotePath: string) => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const name = remotePath.split('/').filter(Boolean).pop() ?? 'file'
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    title: '保存到本机',
    defaultPath: join(app.getPath('downloads'), name)
  })
  if (canceled || !filePath || !fileService) return false
  await fileService.download(remotePath, filePath)
  return true
})

// ---------- 终端 ----------

ipcMain.handle('kd:term-open', async (_e, cols: number, rows: number) => {
  if (termStream) return true
  const stream = await ssh.shell(cols, rows)
  termStream = stream
  stream.on('data', (d: Buffer) => send('kd:term-data', d))
  stream.stderr.on('data', (d: Buffer) => send('kd:term-data', d))
  stream.on('close', () => {
    termStream = null
    send('kd:term-exit')
  })
  // 等 shell 初始化完成后注入 UTF-8 环境和中文友好的 ll 函数：
  // 设备 busybox 未编译 Unicode 支持，ls 会把中文文件名替换为 ?
  setTimeout(() => {
    if (!termStream) return
    const setup = [
      'export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8',
      "ll() { if [ $# -eq 0 ]; then set -- .; fi; for d in \"$@\"; do if [ -d \"$d\" ]; then for f in \"$d\"/*; do [ -e \"$f\" ] && echo \"  $f\"; done; else echo \"$d\"; fi; done; }",
      'echo "提示: 设备 busybox 不支持 Unicode，ls 中文文件名会显示为 ?，可用 ll 查看"'
    ].join('\n')
    termStream.write(setup + '\r')
  }, 800)
  return true
})

ipcMain.handle('kd:term-input', (_e, data: string) => {
  termStream?.write(data)
  return true
})

ipcMain.handle('kd:term-resize', (_e, cols: number, rows: number) => {
  try {
    termStream?.setWindow(rows, cols, 480, 480)
  } catch {
    /* ignore */
  }
  return true
})

ipcMain.handle('kd:term-close', () => {
  resetTerminal()
  return true
})

function statSyncSafe(p: string): import('fs').Stats | null {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

// ---------- 生命周期 ----------

void app.whenReady().then(async () => {
  await loadDeviceStore()
  powerMonitor.on('resume', () => ssh.retryNow())
  powerMonitor.on('unlock-screen', () => ssh.retryNow())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // before-quit 里统一做 keepAwake 恢复后再退出
  app.quit()
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void restoreKeepAwake().finally(() => {
    ssh.disconnect()
    app.quit()
  })
})

// Mac 睡眠唤醒/解锁后网络需要几秒才就绪，此时立即触发重连并重置退避
