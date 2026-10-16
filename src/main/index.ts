import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import { statSync } from 'fs'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { KindleSSH } from './kindle'
import { ScreenService } from './screen'
import { STATS_SCRIPT, parseStatsOutput, fetchDeviceInfo, fetchThreads, type ParsedStat } from './stats'
import { FileService } from './files'
import type { ConnectionSettings, StatsSnapshot, TransferProgress, ScreenFrame, ConnState } from '../shared/types'

const DEFAULT_SETTINGS: ConnectionSettings = {
  host: '',
  port: 22,
  username: 'root',
  authMethod: 'key',
  privateKeyPath: '',
  password: '',
  keepAwake: true
}

// 连接期间阻止 Kindle 自动休眠（休眠会断开 WiFi 导致 SSH 掉线）
const KEEP_AWAKE_ON = '/usr/bin/lipc-set-prop com.lab126.powerd preventScreenSaver 1'
const KEEP_AWAKE_OFF = '/usr/bin/lipc-set-prop com.lab126.powerd preventScreenSaver 0'
let currentSettings: ConnectionSettings = { ...DEFAULT_SETTINGS }

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

async function loadSettings(): Promise<ConnectionSettings> {
  try {
    const { readFile } = await import('fs/promises')
    const data = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8'))
    return { ...DEFAULT_SETTINGS, ...data }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function saveSettings(s: ConnectionSettings): Promise<void> {
  await writeFile(join(app.getPath('userData'), 'settings.json'), JSON.stringify(s, null, 2))
}

function stopStats(): void {
  if (statsTimer) clearInterval(statsTimer)
  statsTimer = null
  prevCpu = null
  prevProcs = null
}

function startStats(intervalMs: number): void {
  stopStats()
  if (intervalMs <= 0) return
  let busy = false
  const tick = async () => {
    // 串行化：设备繁忙、上一拍尚未返回时跳过本拍，
    // 避免并发 exec 通道堆积把连接压垮
    if (ssh.state !== 'connected' || busy) return
    busy = true
    try {
      const raw = await ssh.execText(STATS_SCRIPT)
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
  if (ssh.state === 'connected' && currentSettings.keepAwake) {
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
  if (state === 'connected') {
    fileService = new FileService(ssh, (p: TransferProgress) => send('kd:transfer-progress', p))
    screenService.bind(ssh)
    if (currentSettings.keepAwake) {
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
      const tabs = ['overview', 'screen', 'procs', 'files', 'term']
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

ipcMain.handle('kd:connect', async (_e, settings: ConnectionSettings) => {
  currentSettings = settings
  await ssh.connectAndRemember(settings)
  return true
})

ipcMain.handle('kd:disconnect', async () => {
  pendingScreenInterval = 0
  screenService.stop()
  await restoreKeepAwake()
  ssh.disconnect()
  return true
})

ipcMain.handle('kd:get-settings', async () => {
  currentSettings = await loadSettings()
  return currentSettings
})
ipcMain.handle('kd:save-settings', (_e, s: ConnectionSettings) => {
  currentSettings = s
  return saveSettings(s)
})

ipcMain.handle('kd:device-info', async () => fetchDeviceInfo(ssh))

ipcMain.handle('kd:stats-start', (_e, intervalMs: number) => {
  startStats(Math.max(500, intervalMs))
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

void app.whenReady().then(() => {
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
