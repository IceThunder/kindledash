import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { kd } from './api'
import type { ConnectionSettings, ConnState, StatsSnapshot } from '../../shared/types'

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
  if (d > 0) return `${d} 天 ${h} 小时`
  if (h > 0) return `${h} 小时 ${m} 分`
  return `${m} 分`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

export const STATE_LABEL: Record<string, string> = {
  R: '运行',
  S: '睡眠',
  D: '等待IO',
  Z: '僵尸',
  T: '停止',
  X: '死亡',
  W: '换出'
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
  settings: ConnectionSettings | null
  connect: (s: ConnectionSettings) => Promise<void>
  disconnect: () => Promise<void>
  setSettings: (s: ConnectionSettings) => Promise<void>
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
  const [settings, setSettings] = useState<ConnectionSettings | null>(null)
  const [stats, setStats] = useState<StatsSnapshot | null>(null)
  const [history, setHistory] = useState<StatsHistory>({
    cpu: [],
    memUsedKB: [],
    memTotalKB: 0,
    load1: []
  })
  const wasConnected = useRef(false)

  useEffect(() => {
    const off = kd.onState((s, e) => {
      setState(s)
      setErr(e || '')
      if (s === 'connected') {
        wasConnected.current = true
        void kd.startStats(1000)
      } else if (s === 'disconnected') {
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
    // 加载已保存的设置并自动连接（未配置过地址则停在未连接状态）
    void kd.getSettings().then((s) => {
      setSettings(s)
      if (s.host) {
        setState('connecting')
        kd.connect(s).catch(() => {})
      }
    })
    return () => {
      off()
      offStats()
    }
  }, [])

  const connect = useCallback(async (s: ConnectionSettings) => {
    setState('connecting')
    setErr('')
    await kd.saveSettings(s)
    setSettings(s)
    await kd.connect(s)
  }, [])

  const disconnect = useCallback(async () => {
    await kd.disconnect()
  }, [])

  const saveSettings = useCallback(async (s: ConnectionSettings) => {
    await kd.saveSettings(s)
    setSettings(s)
  }, [])

  return (
    <ConnContext.Provider value={{ state, err, settings, connect, disconnect, setSettings: saveSettings }}>
      <StatsContext.Provider value={{ stats, history }}>{children}</StatsContext.Provider>
    </ConnContext.Provider>
  )
}
