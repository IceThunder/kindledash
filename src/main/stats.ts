import type { KindleSSH } from './kindle'
import type { StatsSnapshot, ProcInfo, DeviceInfo, StorageInfo, ThreadInfo } from '../shared/types'

// 一次 SSH 往返拉取全部性能数据，降低设备端开销
export const STATS_SCRIPT = [
  'echo "#U"; cat /proc/uptime',
  'echo "#S"; head -n 2 /proc/stat',
  'echo "#L"; cat /proc/loadavg',
  'echo "#M"; head -n 16 /proc/meminfo',
  'echo "#B"; cat /sys/devices/system/yoshi_battery/yoshi_battery0/battery_capacity /sys/devices/system/yoshi_battery/yoshi_battery0/battery_voltage /sys/devices/system/yoshi_battery/yoshi_battery0/battery_temperature /sys/devices/system/yoshi_battery/yoshi_battery0/battery_current 2>/dev/null',
  'echo "#P"; cat /proc/[0-9]*/stat 2>/dev/null',
  'echo "#END"'
].join('; ')

// 总览页只需要 CPU/内存/电池/磁盘；扫描所有进程的 stat 文件是 Kindle
// 上最重的一步，留给进程页按需启用。
export const STATS_LIGHT_SCRIPT = [
  'echo "#U"; cat /proc/uptime',
  'echo "#S"; head -n 2 /proc/stat',
  'echo "#L"; cat /proc/loadavg',
  'echo "#M"; head -n 16 /proc/meminfo',
  'echo "#B"; cat /sys/devices/system/yoshi_battery/yoshi_battery0/battery_capacity /sys/devices/system/yoshi_battery/yoshi_battery0/battery_voltage /sys/devices/system/yoshi_battery/yoshi_battery0/battery_temperature /sys/devices/system/yoshi_battery/yoshi_battery0/battery_current 2>/dev/null',
  'echo "#END"'
].join('; ')

export interface ParsedStat {
  total: number
  idle: number
}

export function parseStorageOutput(raw: string): StorageInfo[] {
  const out: StorageInfo[] = []
  for (const line of raw.trim().split('\n').slice(1)) {
    const f = line.trim().split(/\s+/)
    if (f.length < 6) continue
    out.push({
      mount: f[5],
      totalKB: parseInt(f[1], 10),
      usedKB: parseInt(f[2], 10),
      availKB: parseInt(f[3], 10)
    })
  }
  return out
}

export function parseCpuStatLine(line: string): ParsedStat {
  const parts = line.trim().split(/\s+/)
  let total = 0
  let idle = 0
  // user nice system idle iowait irq softirq steal ...
  for (let i = 1; i < parts.length; i++) {
    const v = parseInt(parts[i], 10) || 0
    total += v
    if (i === 4 || i === 5) idle += v // idle + iowait
  }
  return { total, idle }
}

/** 解析一行 /proc/<pid>/stat（comm 可能含空格/括号，取最后一个 ')' 之后为字段区） */
export function parseProcStatLine(line: string): ProcInfo | null {
  const op = line.indexOf('(')
  const cp = line.lastIndexOf(')')
  if (op < 0 || cp < 0 || cp < op) return null
  const pid = parseInt(line.slice(0, op).trim(), 10)
  if (!Number.isFinite(pid)) return null
  const comm = line.slice(op + 1, cp)
  const f = line.slice(cp + 2).split(' ')
  const state = f[0] ?? '?'
  const ppid = parseInt(f[1] ?? '0', 10)
  const utime = parseInt(f[11] ?? '0', 10)
  const stime = parseInt(f[12] ?? '0', 10)
  const threads = parseInt(f[17] ?? '1', 10)
  const vsize = parseInt(f[20] ?? '0', 10)
  const rssPages = parseInt(f[21] ?? '0', 10)
  return {
    pid,
    comm,
    state,
    ppid,
    utime,
    stime,
    cpuPercent: 0,
    rssKB: Math.floor((rssPages * 4096) / 1024),
    vsizeKB: Math.floor(vsize / 1024),
    threads,
    kernelThread: ppid === 2 || pid === 2
  }
}

function parseMeminfo(text: string): StatsSnapshot['mem'] {
  const map: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)\s*kB/)
    if (m) map[m[1]] = parseInt(m[2], 10)
  }
  const totalKB = map.MemTotal ?? 0
  const freeKB = map.MemFree ?? 0
  const buffersKB = map.Buffers ?? 0
  const cachedKB = (map.Cached ?? 0) + (map.SReclaimable ?? 0)
  return {
    totalKB,
    freeKB,
    buffersKB,
    cachedKB,
    usedKB: Math.max(0, totalKB - freeKB - buffersKB - cachedKB),
    swapTotalKB: map.SwapTotal ?? 0,
    swapFreeKB: map.SwapFree ?? 0
  }
}

function parseBattery(text: string): StatsSnapshot['battery'] {
  const vals = text
    .trim()
    .split('\n')
    .map((l) => parseInt(l.trim(), 10))
    .filter((v) => Number.isFinite(v))
  const [capacity, voltage, temperature, current] = vals
  return {
    capacity: Number.isFinite(capacity) ? capacity : null,
    // 内核上报微伏，转毫伏
    voltageMV: voltage > 100000 ? Math.round(voltage / 1000) : Number.isFinite(voltage) ? voltage : null,
    // 内核上报 0.1°C
    temperatureC: Number.isFinite(temperature) ? Math.round(temperature / 10) : null,
    currentMA: Number.isFinite(current) ? current : null
  }
}

function parseDf(text: string): StorageInfo[] {
  const out: StorageInfo[] = []
  for (const line of text.trim().split('\n').slice(1)) {
    const f = line.trim().split(/\s+/)
    if (f.length < 6) continue
    out.push({
      mount: f[5],
      totalKB: parseInt(f[1], 10),
      usedKB: parseInt(f[2], 10),
      availKB: parseInt(f[3], 10)
    })
  }
  return out
}

/** 把一次原始输出解析为快照；需要上一帧数据计算增量 CPU% */
export function parseStatsOutput(raw: string, prevCpu: ParsedStat | null, prevProcs: Map<number, number> | null): StatsSnapshot | null {
  const sections: Record<string, string> = {}
  let current = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('#')) {
      current = line
      sections[current] = ''
    } else if (current) {
      sections[current] += line + '\n'
    }
  }
  const uptimeText = sections['#U'] ?? ''
  const statText = (sections['#S'] ?? '').split('\n').find((l) => l.startsWith('cpu '))
  if (!statText) return null

  const cpu = parseCpuStatLine(statText)
  const dt = prevCpu ? cpu.total - prevCpu.total : 0
  const cpuPercent = prevCpu && dt > 0 ? Math.min(100, Math.round(((dt - (cpu.idle - prevCpu.idle)) / dt) * 100)) : 0

  const loadText = (sections['#L'] ?? '').trim().split(/\s+/)
  const load: [number, number, number] = [
    parseFloat(loadText[0] ?? '0'),
    parseFloat(loadText[1] ?? '0'),
    parseFloat(loadText[2] ?? '0')
  ]

  const procs: ProcInfo[] = []
  const curProcs = new Map<number, number>()
  for (const line of (sections['#P'] ?? '').split('\n')) {
    if (!line.trim()) continue
    const p = parseProcStatLine(line)
    if (!p) continue
    const t = p.utime + p.stime
    curProcs.set(p.pid, t)
    if (prevProcs && prevProcs.has(p.pid) && dt > 0) {
      const d = t - (prevProcs.get(p.pid) ?? 0)
      if (d > 0) p.cpuPercent = Math.round((d / dt) * 1000) / 10
    }
    procs.push(p)
  }
  procs.sort((a, b) => b.cpuPercent - a.cpuPercent || b.rssKB - a.rssKB)

  return {
    ts: Date.now(),
    uptime: parseFloat((uptimeText.trim().split(/\s+/)[0] ?? '0')),
    cpuPercent,
    cpuJiffies: cpu,
    load,
    mem: parseMeminfo(sections['#M'] ?? ''),
    procs,
    battery: parseBattery(sections['#B'] ?? ''),
    storage: parseDf(sections['#D'] ?? '')
  }
}

const DEVICE_SCRIPT = [
  'echo "#V"; head -n 1 /etc/prettyversion.txt',
  'echo "#H"; cat /proc/usid',
  'echo "#C"; cat /proc/cpuinfo',
  'echo "#K"; uname -r',
  'echo "#M"; cat /proc/cmdline',
  'echo "#N"; /usr/bin/lipc-get-prop com.lab126.sysinfo deviceName 2>/dev/null',
  'echo "#R"; head -n 3 /proc/meminfo',
  'echo "#END"'
].join('; ')

// MX50 板型 → 机型名（Paperwhite 2/3/Voyage 同系），按子串匹配 Hardware 字段
const HARDWARE_MODELS: [string, string][] = [
  ['YOSHIME', 'Kindle Paperwhite 2'],
  ['WARIO', 'Kindle Paperwhite 3'],
  ['RENAUD', 'Kindle Voyage'],
  ['ICEWINE', 'Kindle Basic 2 (KT2)'],
  ['MAGNA', 'Kindle Oasis']
]

export async function fetchDeviceInfo(ssh: KindleSSH): Promise<DeviceInfo> {
  const raw = await ssh.execText(DEVICE_SCRIPT)
  const sections: Record<string, string> = {}
  let current = ''
  for (const line of raw.split('\n')) {
    if (line.startsWith('#')) {
      current = line
      sections[current] = ''
    } else if (current) {
      sections[current] += line + '\n'
    }
  }
  const cpuinfo = sections['#C'] ?? ''
  const pick = (key: string): string => {
    const m = cpuinfo.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'))
    return m ? m[1].trim().replace(/^"|"$/g, '') : ''
  }
  const hardware = pick('Hardware')
  let ramTotalKB = 0
  const mt = (sections['#R'] ?? '').match(/MemTotal:\s+(\d+)/)
  if (mt) ramTotalKB = parseInt(mt[1], 10)

  const firmware = (sections['#V'] ?? '').trim().replace(/\(~~otaVersion~~\)/, '').trim()

  let model = 'Kindle'
  for (const [key, name] of HARDWARE_MODELS) {
    if (hardware.includes(key)) {
      model = name
      break
    }
  }

  return {
    model,
    hardware,
    firmware: firmware || '未知',
    kernel: (sections['#K'] ?? '').trim(),
    // /proc/usid 形如 B024...03M0#C，去掉 # 校验和后缀
    serial: ((sections['#H'] ?? '').trim().split('#')[0]) || pick('Serial'),
    boardId: pick('BoardId'),
    cpuModel: pick('Processor') || 'ARM',
    cpuCores: 1,
    ramTotalKB,
    deviceName: (sections['#N'] ?? '').trim() || undefined,
    cmdline: (sections['#M'] ?? '').trim()
  }
}

export async function fetchStorageInfo(ssh: KindleSSH): Promise<StorageInfo[]> {
  return parseStorageOutput(await ssh.execText('df -k | grep -v tmpfs'))
}

/** 读取某进程的全部线程 */
export async function fetchThreads(ssh: KindleSSH, pid: number): Promise<ThreadInfo[]> {
  const raw = await ssh.execText(`cat /proc/${pid}/task/*/stat 2>/dev/null`)
  const totalRaw = await ssh.execText('head -n 1 /proc/stat')
  const cpu = parseCpuStatLine(totalRaw.trim().split('\n')[0])

  const first: ThreadInfo[] = []
  const marks = new Map<number, number>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const op = line.indexOf('(')
    const cp = line.lastIndexOf(')')
    if (op < 0 || cp < 0) continue
    const tid = parseInt(line.slice(0, op).trim(), 10)
    const comm = line.slice(op + 1, cp)
    const f = line.slice(cp + 2).split(' ')
    const t = (parseInt(f[11] ?? '0', 10) + parseInt(f[12] ?? '0', 10)) as number
    marks.set(tid, t)
    first.push({ tid, comm, state: f[0] ?? '?', cpuPercent: 0 })
  }

  // 间隔 400ms 再采样一次，计算每线程 CPU%
  await new Promise((r) => setTimeout(r, 400))
  const raw2 = await ssh.execText(`cat /proc/${pid}/task/*/stat 2>/dev/null`)
  const total2Raw = await ssh.execText('head -n 1 /proc/stat')
  const cpu2 = parseCpuStatLine(total2Raw.trim().split('\n')[0])
  const dt = cpu2.total - cpu.total
  if (dt <= 0) return first
  for (const line of raw2.split('\n')) {
    if (!line.trim()) continue
    const op = line.indexOf('(')
    const cp = line.lastIndexOf(')')
    if (op < 0 || cp < 0) continue
    const tid = parseInt(line.slice(0, op).trim(), 10)
    const f = line.slice(cp + 2).split(' ')
    const t = parseInt(f[11] ?? '0', 10) + parseInt(f[12] ?? '0', 10)
    const d = t - (marks.get(tid) ?? t)
    const hit = first.find((x) => x.tid === tid)
    if (hit && d > 0) hit.cpuPercent = Math.round((d / dt) * 1000) / 10
  }
  return first
}
