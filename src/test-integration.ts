/* 集成测试：对真实 Kindle 跑一遍全部后端逻辑（不含 Electron UI）
 * 用法: KINDLE_HOST=192.168.x.x KINDLE_KEY=~/.ssh/xxx.pem npx tsx src/test-integration.ts
 */
import { KindleSSH } from './main/kindle'
import { STATS_SCRIPT, parseStatsOutput, fetchDeviceInfo, fetchThreads } from './main/stats'
import { ScreenService } from './main/screen'
import { FileService } from './main/files'
import type { ScreenFrame } from './shared/types'

async function main(): Promise<void> {
  const host = process.env.KINDLE_HOST
  if (!host) {
    console.error('请先设置环境变量 KINDLE_HOST（设备 IP），可选 KINDLE_KEY（私钥路径）/ KINDLE_USER')
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
  console.log('✓ SSH 连接成功')

  const info = await fetchDeviceInfo(ssh)
  console.log('✓ 设备信息:', info.model, info.firmware, 'serial:', info.serial)

  // 两次采样计算增量
  const raw1 = await ssh.execText(STATS_SCRIPT)
  await new Promise((r) => setTimeout(r, 1000))
  const raw2 = await ssh.execText(STATS_SCRIPT)
  const s1 = parseStatsOutput(raw1, null, null)
  const s2 = parseStatsOutput(
    raw2,
    s1!.cpuJiffies,
    new Map(s1!.procs.map((p) => [p.pid, p.utime + p.stime]))
  )
  console.log(
    `✓ 性能: CPU ${s2!.cpuPercent}% | 内存 used ${s2!.mem.usedKB}/${s2!.mem.totalKB} kB | 进程 ${s2!.procs.length} | 电池 ${s2!.battery.capacity}%`
  )
  console.log(
    '  CPU 前三:',
    s2!.procs
      .slice(0, 3)
      .map((p) => `${p.comm} ${p.cpuPercent}%`)
      .join(', ')
  )
  console.log('  存储:', s2!.storage.filter((s) => s.mount === '/mnt/us').map((s) => `${s.mount} ${s.usedKB}/${s.totalKB}kB`).join(''))

  const threads = await fetchThreads(ssh, 1)
  console.log(`✓ init 进程线程: ${threads.length} 条, 示例:`, threads.slice(0, 3).map((t) => `${t.tid}:${t.comm}`).join(' '))

  // 屏幕抓帧
  const screen = new ScreenService()
  screen.bind(ssh)
  const frame = await new Promise<ScreenFrame>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('屏幕抓帧超时')), 10000)
    screen.start(500, (f) => {
      clearTimeout(t)
      resolve(f)
    }, reject)
  })
  console.log(`✓ 屏幕帧: ${frame.width}x${frame.height}, ${frame.gray.length} 字节灰度`)
  screen.stop()

  // SFTP
  const fs = new FileService(ssh, () => {})
  const list = await fs.list('/mnt/us')
  console.log('✓ SFTP 列目录 /mnt/us:', list.entries.slice(0, 8).map((e) => (e.isDir ? '📁' : '📄') + e.name).join('  '))
  if (list.error) throw new Error('SFTP 列目录失败: ' + list.error)
  const txt = await fs.readTextFile('/etc/prettyversion.txt')
  console.log('✓ 文本预览 /etc/prettyversion.txt:', JSON.stringify(txt.text.trim()))

  // 终端 shell
  const shell = await ssh.shell(80, 24)
  let out = ''
  shell.on('data', (d: Buffer) => (out += d.toString()))
  await new Promise((r) => setTimeout(r, 1200))
  shell.write('echo TERM_MARKER_$((40+2))\n')
  await new Promise((r) => setTimeout(r, 1500))
  console.log('✓ 终端交互:', out.includes('TERM_MARKER_42') ? '输出正常' : '未找到标记!')
  shell.close()

  ssh.disconnect()
  console.log('\n=== 全部后端集成测试通过 ===')
}

main().catch((e) => {
  console.error('测试失败:', e)
  process.exit(1)
})
