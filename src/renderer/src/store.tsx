import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { kd } from './api'
import { localeTag, tNow } from './i18n'
import type { DeviceProfile, DeviceStore, ConnState, StatsSnapshot } from '../../shared/types'

// ---------- 工具 ----------

export function fmtKB(kb: number): string {
  if (kb < 1024) return `${kb} KB`
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${(kb / 1024 / 1024).toFixed(2)} GB`
}

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return tNow('fmt.uptimeDH', { d, h })
  if (h > 0) return tNow('fmt.uptimeHM', { h, m })
  return tNow('fmt.uptimeM', { m })
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(localeTag(), { hour12: false })
}

/** 进程/线程状态码 → 本地化标签（语言切换后按当前语言返回） */
export function stateLabel(code: string): string {
  const key = `procs.state${code}` as
    | 'procs.stateR'
    | 'procs.stateS'
    | 'procs.stateD'
    | 'procs.stateZ'
    | 'procs.stateT'
    | 'procs.stateX'
    | 'procs.stateW'
  return tNow(key)
}

export const STATE_COLOR: Record<string, string> = {
  R: '#3fb950',
  S: '#8b949e',
  D: '#d29922',
  Z: '#f85149',
  T: '#d29922',
  X: '#f85149',
  W: '#8b949e'
}

// ---------- 连接状态 ----------

interface ConnCtx {
  state: ConnState
  err: string
  /** 全部已保存设备 */
  devices: DeviceProfile[]
  /** 当前连接（或正在连接）的设备 */
  activeId: string | null
  /** 连接指定设备（自动断开当前） */
  connectDevice: (p: DeviceProfile) => Promise<void>
  disconnect: () => Promise<void>
  /** 设备配置变更后刷新本地列表 */
  refreshDevices: (store?: DeviceStore) => Promise<void>
}

const ConnContext = createContext<ConnCtx>(null as never)
export const useConn = () => useContext(ConnContext)

// ---------- 性能数据 ----------

export interface StatsHistory {
  cpu: number[]
  memUsedKB: number[]
  memTotalKB: number
  load1: number[]
}

interface StatsCtx {
  stats: StatsSnapshot | null
  history: StatsHistory
}

const StatsContext = createContext<StatsCtx>(null as never)
export const useStats = () => useContext(StatsContext)

const MAX_POINTS = 120

export function AppProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = useState<ConnState>('disconnected')
  const [err, setErr] = useState('')
  const [devices, setDevices] = useState<DeviceProfile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [stats, setStats] = useState<StatsSnapshot | null>(null)
  const [history, setHistory] = useState<StatsHistory>({
    cpu: [],
    memUsedKB: [],
    memTotalKB: 0,
    load1: []
  })

  const applyStore = useCallback((store: DeviceStore) => {
    setDevices(store.devices)
  }, [])

  const refreshDevices = useCallback(
    async (store?: DeviceStore) => {
      applyStore(store ?? (await kd.devicesList()))
    },
    [applyStore]
  )

  useEffect(() => {
    const off = kd.onState((s, e) => {
      setState(s)
      setErr(e || '')
      if (s === 'disconnected') {
        setStats(null)
        setHistory({ cpu: [], memUsedKB: [], memTotalKB: 0, load1: [] })
      }
    })
    const offStats = kd.onStats((s) => {
      setStats(s)
      setHistory((h) => {
        const cpu = [...h.cpu, s.cpuPercent].slice(-MAX_POINTS)
        const memUsedKB = [...h.memUsedKB, s.mem.usedKB].slice(-MAX_POINTS)
        const load1 = [...h.load1, s.load[0]].slice(-MAX_POINTS)
        return { cpu, memUsedKB, load1, memTotalKB: s.mem.totalKB }
      })
    })
    const offDev = kd.onDevicesUpdated((store) => applyStore(store))
    // 加载设备列表，自动连接上次使用的设备
    void kd.devicesList().then((store) => {
      applyStore(store)
    })
    // 页面重载/晚加载时 kd:state 事件可能已错过，主动拉一次当前状态
    void kd.connState().then(({ state, err }) => {
      setState(state)
      setErr(err || '')
    })
    return () => {
      off()
      offStats()
      offDev()
    }
  }, [applyStore])

  const connectDevice = useCallback(
    async (p: DeviceProfile) => {
      setState('connecting')
      setErr('')
      setActiveId(p.id)
      try {
        await kd.disconnect()
      } catch {
        /* ignore */
      }
      await kd.connect(p)
    },
    []
  )

  const disconnect = useCallback(async () => {
    await kd.disconnect()
  }, [])

  return (
    <ConnContext.Provider value={{ state, err, devices, activeId, connectDevice, disconnect, refreshDevices }}>
      <StatsContext.Provider value={{ stats, history }}>{children}</StatsContext.Provider>
    </ConnContext.Provider>
  )
}
