import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionSettings,
  ConnState,
  DeviceInfo,
  StatsSnapshot,
  ScreenFrame,
  ThreadInfo,
  FileEntry,
  TransferProgress
} from '../shared/types'

const api = {
  // 连接
  connect: (settings: ConnectionSettings) => ipcRenderer.invoke('kd:connect', settings),
  disconnect: () => ipcRenderer.invoke('kd:disconnect'),
  getSettings: (): Promise<ConnectionSettings> => ipcRenderer.invoke('kd:get-settings'),
  saveSettings: (s: ConnectionSettings) => ipcRenderer.invoke('kd:save-settings', s),
  onState: (cb: (state: ConnState, err: string) => void) => {
    const l = (_e: unknown, state: ConnState, err: string) => cb(state, err)
    ipcRenderer.on('kd:state', l)
    return () => ipcRenderer.removeListener('kd:state', l)
  },

  // 设备
  getDeviceInfo: (): Promise<DeviceInfo> => ipcRenderer.invoke('kd:device-info'),
  reboot: (): Promise<boolean> => ipcRenderer.invoke('kd:reboot'),
  listThreads: (pid: number): Promise<ThreadInfo[]> => ipcRenderer.invoke('kd:list-threads', pid),
  kill: (pid: number, sig: string): Promise<string> => ipcRenderer.invoke('kd:kill', pid, sig),

  // 性能
  startStats: (intervalMs: number) => ipcRenderer.invoke('kd:stats-start', intervalMs),
  stopStats: () => ipcRenderer.invoke('kd:stats-stop'),
  onStats: (cb: (s: StatsSnapshot) => void) => {
    const l = (_e: unknown, s: StatsSnapshot) => cb(s)
    ipcRenderer.on('kd:stats', l)
    return () => ipcRenderer.removeListener('kd:stats', l)
  },

  // 屏幕
  startScreen: (intervalMs: number) => ipcRenderer.invoke('kd:screen-start', intervalMs),
  stopScreen: () => ipcRenderer.invoke('kd:screen-stop'),
  refreshScreen: () => ipcRenderer.invoke('kd:screen-refresh'),
  getScreenLast: (): Promise<ScreenFrame | null> => ipcRenderer.invoke('kd:screen-last'),
  saveScreenshot: (dataUrl: string): Promise<string | null> => ipcRenderer.invoke('kd:save-screenshot', dataUrl),
  onScreenFrame: (cb: (f: ScreenFrame) => void) => {
    const l = (_e: unknown, f: ScreenFrame) => cb(f)
    ipcRenderer.on('kd:screen-frame', l)
    return () => ipcRenderer.removeListener('kd:screen-frame', l)
  },
  onScreenError: (cb: (msg: string) => void) => {
    const l = (_e: unknown, msg: string) => cb(msg)
    ipcRenderer.on('kd:screen-error', l)
    return () => ipcRenderer.removeListener('kd:screen-error', l)
  },

  // 文件管理
  fsList: (path: string): Promise<{ path: string; entries: FileEntry[]; error?: string }> =>
    ipcRenderer.invoke('kd:fs-list', path),
  fsMkdir: (path: string): Promise<string | null> => ipcRenderer.invoke('kd:fs-mkdir', path),
  fsRename: (from: string, to: string): Promise<string | null> => ipcRenderer.invoke('kd:fs-rename', from, to),
  fsDelete: (path: string, isDir: boolean): Promise<string | null> => ipcRenderer.invoke('kd:fs-delete', path, isDir),
  fsReadText: (path: string): Promise<{ text: string; error?: string }> => ipcRenderer.invoke('kd:fs-read-text', path),
  fsUpload: (remoteDir: string): Promise<number> => ipcRenderer.invoke('kd:fs-upload', remoteDir),
  fsDownload: (remotePath: string): Promise<boolean> => ipcRenderer.invoke('kd:fs-download', remotePath),
  onTransferProgress: (cb: (p: TransferProgress) => void) => {
    const l = (_e: unknown, p: TransferProgress) => cb(p)
    ipcRenderer.on('kd:transfer-progress', l)
    return () => {
      ipcRenderer.removeListener('kd:transfer-progress', l)
    }
  },

  // 终端
  termOpen: (cols: number, rows: number) => ipcRenderer.invoke('kd:term-open', cols, rows),
  termInput: (data: string) => ipcRenderer.invoke('kd:term-input', data),
  termResize: (cols: number, rows: number) => ipcRenderer.invoke('kd:term-resize', cols, rows),
  termClose: () => ipcRenderer.invoke('kd:term-close'),
  onTermData: (cb: (d: Uint8Array) => void) => {
    const l = (_e: unknown, d: Uint8Array) => cb(d)
    ipcRenderer.on('kd:term-data', l)
    return () => ipcRenderer.removeListener('kd:term-data', l)
  },
  onTermExit: (cb: () => void) => {
    const l = () => cb()
    ipcRenderer.on('kd:term-exit', l)
    return () => ipcRenderer.removeListener('kd:term-exit', l)
  }
}

export type KindleDashApi = typeof api

contextBridge.exposeInMainWorld('kd', api)
