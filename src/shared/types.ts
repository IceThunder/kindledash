// 主进程 / 渲染进程共享的类型定义

export interface ConnectionSettings {
  host: string
  port: number
  username: string
  authMethod: 'key' | 'password'
  privateKeyPath: string
  password: string
  /** 连接期间阻止设备自动休眠（防止休眠断网导致 SSH 掉线） */
  keepAwake: boolean
}

export type ConnState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export interface DeviceInfo {
  model: string
  hardware: string
  firmware: string
  kernel: string
  serial: string
  boardId: string
  cpuModel: string
  cpuCores: number
  ramTotalKB: number
  deviceName?: string
  cmdline: string
}

export interface BatteryInfo {
  capacity: number | null // %
  voltageMV: number | null
  temperatureC: number | null
  currentMA: number | null
}

export interface StorageInfo {
  mount: string
  totalKB: number
  usedKB: number
  availKB: number
}

export interface ProcInfo {
  pid: number
  comm: string
  state: string
  ppid: number
  utime: number
  stime: number
  cpuPercent: number // 相对单核，可 >100（多线程累计按 jiffies 计）
  rssKB: number
  vsizeKB: number
  threads: number
  kernelThread: boolean
}

export interface ThreadInfo {
  tid: number
  comm: string
  state: string
  cpuPercent: number
}

export interface StatsSnapshot {
  ts: number
  uptime: number
  cpuPercent: number
  cpuJiffies: { total: number; idle: number }
  load: [number, number, number]
  mem: {
    totalKB: number
    freeKB: number
    buffersKB: number
    cachedKB: number
    usedKB: number
    swapTotalKB: number
    swapFreeKB: number
  }
  procs: ProcInfo[]
  battery: BatteryInfo
  storage: StorageInfo[]
}

export interface ScreenFrame {
  width: number
  height: number
  gray: Uint8Array // 每像素 1 字节灰度
  changed: boolean
  ts: number
}

export interface FileEntry {
  name: string
  longname: string
  isDir: boolean
  isSymlink: boolean
  size: number
  mtimeMs: number
  mode: number
  uid: number
  gid: number
}

export interface TransferProgress {
  id: number
  name: string
  direction: 'upload' | 'download'
  bytes: number
  total: number
  done: boolean
  error?: string
}
