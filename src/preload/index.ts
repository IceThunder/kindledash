import { contextBridge, ipcRenderer } from 'electron'
import type {
  DeviceProfile,
  DeviceStore,
  ConnState,
  DeviceInfo,
  StatsSnapshot,
  ScreenFrame,
  ThreadInfo,
  FileEntry,
  TransferProgress,
  LibraryBook,
  LibraryScanResult,
  LibraryScanProgress
} from '../shared/types'

const api = {
  // 连接（传入完整设备配置）
  connect: (profile: DeviceProfile) => ipcRenderer.invoke('kd:connect', profile),
  disconnect: () => ipcRenderer.invoke('kd:disconnect'),
  connState: (): Promise<{ state: ConnState; err: string }> => ipcRenderer.invoke('kd:conn-state'),
  onState: (cb: (state: ConnState, err: string) => void) => {
    const l = (_e: unknown, state: ConnState, err: string) => cb(state, err)
    ipcRenderer.on('kd:state', l)
    return () => ipcRenderer.removeListener('kd:state', l)
  },

  // 设备配置管理
  devicesList: (): Promise<DeviceStore> => ipcRenderer.invoke('kd:devices-list'),
  deviceSave: (profile: DeviceProfile, connectNow: boolean): Promise<DeviceStore> =>
    ipcRenderer.invoke('kd:device-save', profile, connectNow),
  deviceDelete: (id: string): Promise<DeviceStore> => ipcRenderer.invoke('kd:device-delete', id),
  setLastActive: (id: string) => ipcRenderer.invoke('kd:set-last-active', id),
  onDevicesUpdated: (cb: (store: DeviceStore) => void) => {
    const l = (_e: unknown, store: DeviceStore) => cb(store)
    ipcRenderer.on('kd:devices-updated', l)
    return () => {
      ipcRenderer.removeListener('kd:devices-updated', l)
    }
  },

  // 通用
  pickKeyFile: (): Promise<string | null> => ipcRenderer.invoke('kd:pick-key-file'),
  openExternal: (url: string) => ipcRenderer.invoke('kd:open-external', url),
  appVersion: (): Promise<string> => ipcRenderer.invoke('kd:app-version'),

  // 设备
  getDeviceInfo: (): Promise<DeviceInfo> => ipcRenderer.invoke('kd:device-info'),
  getStorageInfo: (): Promise<import('../shared/types').StorageInfo[]> => ipcRenderer.invoke('kd:storage-info'),
  reboot: (): Promise<boolean> => ipcRenderer.invoke('kd:reboot'),
  listThreads: (pid: number): Promise<ThreadInfo[]> => ipcRenderer.invoke('kd:list-threads', pid),
  kill: (pid: number, sig: string): Promise<string> => ipcRenderer.invoke('kd:kill', pid, sig),

  // 性能
  startStats: (intervalMs: number, includeProcesses = false) => ipcRenderer.invoke('kd:stats-start', intervalMs, includeProcesses),
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

  // 内容管理（书库）
  libraryScan: (): Promise<LibraryScanResult> => ipcRenderer.invoke('kd:library-scan'),
  libraryGetCover: (id: string): Promise<string | null> => ipcRenderer.invoke('kd:library-get-cover', id),
  libraryDelete: (id: string): Promise<string | null> => ipcRenderer.invoke('kd:library-delete', id),
  libraryUpload: (localPaths: string[]): Promise<number> => ipcRenderer.invoke('kd:library-upload', localPaths),
  libraryPickBooks: (): Promise<string[]> => ipcRenderer.invoke('kd:library-pick-books'),
  onLibraryScanProgress: (cb: (p: LibraryScanProgress) => void) => {
    const l = (_e: unknown, p: LibraryScanProgress) => cb(p)
    ipcRenderer.on('kd:library-scan-progress', l)
    return () => ipcRenderer.removeListener('kd:library-scan-progress', l)
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
