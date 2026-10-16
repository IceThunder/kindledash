/* 复现 stats 轮询 5 拍，检查 cpuPercent / load 是否正常
 * 用法: KINDLE_HOST=192.168.x.x KINDLE_KEY=~/.ssh/xxx.pem npx tsx src/test-stats.ts
 */
import { KindleSSH } from './main/kindle'
import { STATS_SCRIPT, parseStatsOutput } from './main/stats'

async function main(): Promise<void> {
  const host = process.env.KINDLE_HOST
  if (!host) {
    console.error('请先设置环境变量 KINDLE_HOST（设备 IP）')
    process.exit(1)
  }
  const ssh = new KindleSSH()
  await ssh.connectAndRemember({
    host,
    port: 22,
    username: process.env.KINDLE_USER ?? 'root',
    authMethod: 'key',
    privateKeyPath: process.env.KINDLE_KEY ?? '~/.ssh/id_rsa',
    password: ''
  })
  let prevCpu = null as ReturnType<typeof import('./main/stats').parseStatsOutput> extends never ? never : { total: number; idle: number } | null
  let prevProcs: Map<number, number> | null = null
  for (let i = 0; i < 5; i++) {
    const raw = await ssh.execText(STATS_SCRIPT)
    const snap = parseStatsOutput(raw, prevCpu, prevProcs)
    if (!snap) {
      console.log(`tick${i}: PARSE NULL`)
    } else {
      console.log(
        `tick${i}: cpu%=${snap.cpuPercent} load=${snap.load.join(',')} memUsed=${snap.mem.usedKB} procs=${snap.procs.length} batt=${snap.battery.capacity}`
      )
      prevCpu = snap.cpuJiffies
      prevProcs = new Map(snap.procs.map((p) => [p.pid, p.utime + p.stime]))
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  ssh.disconnect()
}
void main()
