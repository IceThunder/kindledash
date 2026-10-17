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

/** 已保存的设备连接配置（多设备管理） */
export interface DeviceProfile extends ConnectionSettings {
  id: string
  /** 显示名称，如「客厅的 Kindle」 */
  name: string
  /** 最近一次连接成功的设备名（来自设备本身），用于默认命名 */
  deviceName?: string
}

export interface DeviceStore {
  devices: DeviceProfile[]
  /** 启动时自动连接的设备 */
  lastActiveId: string | null
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

// ---------- 内容管理（书库） ----------

export interface LibraryBook {
  /** 远程绝对路径（同时作为唯一 ID） */
  id: string
  path: string
  fileName: string
  /** 书名：EXTH 503 → MOBI fullName → 文件名 */
  title: string
  author: string
  asin: string
  publisher?: string
  publishDate?: string
  /** 小写扩展名：azw3 / azw / mobi / pdf / txt / epub … */
  format: string
  size: number
  mtimeMs: number
  hasCover: boolean
  coverMime?: string
}

export interface LibraryScanResult {
  books: LibraryBook[]
  error?: string
  durationMs: number
  /** 本次扫描中有多少本书直接命中本地缓存（未重新读取设备） */
  cached: number
}

export interface LibraryScanProgress {
  phase: 'list' | 'meta'
  done: number
  total: number
  current: string
}

// ---------- 垃圾清理 ----------

/** 垃圾类别：孤儿伴生目录 / 系统残留文件 / 临时目录 / 剪贴汇总 / 空目录 */
export type JunkCategory = 'orphan-sidecar' | 'sys-junk' | 'temp' | 'clippings' | 'empty-dir'

export interface JunkItem {
  /** 远程绝对路径（同时作为唯一 ID） */
  id: string
  path: string
  name: string
  category: JunkCategory
  isDir: boolean
  /** true 表示只清空目录内容、保留目录本身（system/tmp、system/temp） */
  dirContents?: boolean
  /** 目录为递归累计字节数 */
  size: number
  /** 目录内文件数（普通文件为 1） */
  fileCount: number
  mtimeMs: number
  /** 判定为垃圾的依据，展示给用户 */
  reason: string
}

export interface CleanupScanResult {
  items: JunkItem[]
  error?: string
  durationMs: number
  scannedDirs: number
}

export interface CleanupDeleteResult {
  ok: number
  failed: number
  /** 删除时设备状态已变化、复核不通过的条目数 */
  skipped: number
  freedBytes: number
  errors: string[]
}

export interface CleanupProgress {
  current: string
  found: number
  scannedDirs: number
}
