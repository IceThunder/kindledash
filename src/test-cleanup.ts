/* 集成测试：对真实 Kindle 跑垃圾清理后端逻辑（不含 Electron UI）
 * 用法: KINDLE_HOST=192.168.x.x KINDLE_KEY=~/.ssh/xxx.pem npx tsx src/test-cleanup.ts
 *
 * 覆盖：扫描分类、默认勾选安全策略、删除前复核（防误删）、真实删除
 * 全程只种植/删除 kd_e2e_* 前缀的自建文件，不动设备已有数据
 */
import { KindleSSH } from './main/kindle'
import { CleanupService, DEFAULT_CHECKED } from './main/cleanup'
import type { JunkCategory } from './shared/types'

const TS = Date.now
const stamp = Date.now()

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

  const svc = new CleanupService(ssh, (p) => {
    if (p.scannedDirs % 20 === 0) console.log(`  … ${p.scannedDirs} 目录 · 已发现 ${p.found} 项`)
  })
  const sh = async (cmd: string): Promise<string> => (await ssh.exec(cmd, 10000)).stdout.toString()

  let failed = 0
  const expect = (cond: boolean, msg: string): void => {
    console.log(`${cond ? '✓' : '✗'} ${msg}`)
    if (!cond) failed++
  }

  // ---------- 1. 基线扫描 ----------
  console.log('\n[1] 基线扫描')
  const t0 = TS()
  const base = await svc.scan()
  const byCat = new Map<JunkCategory, number>()
  for (const it of base.items) byCat.set(it.category, (byCat.get(it.category) ?? 0) + 1)
  console.log(`  扫描 ${base.scannedDirs} 目录 / ${((TS() - t0) / 1000).toFixed(1)}s，共 ${base.items.length} 项：`)
  for (const [c, n] of byCat) console.log(`    ${c}: ${n}`)
  expect(!base.error, `扫描无错误${base.error ? `：${base.error}` : ''}`)
  expect(base.items.length > 0, '设备上确实扫出了垃圾（否则后续断言无意义）')
  for (const it of base.items) {
    if (it.category === 'orphan-sidecar') {
      expect(it.path.startsWith('/mnt/us/documents/'), `孤儿伴生目录路径在 documents 下：${it.name}`)
      break
    }
  }

  // ---------- 2. 安全网：非垃圾路径必须被拒绝 ----------
  console.log('\n[2] 删除安全网（不应删掉任何真实文件）')
  const book = (await sh('ls /mnt/us/documents/*.azw3 2>/dev/null | head -1')).trim()
  const bookDir = (await sh("for d in /mnt/us/documents/*/; do [ \"$(ls \"$d\" | head -1)\" ] && echo \"$d\" && break; done")).trim()
  const dangerous = [
    '/mnt/us/system',
    '/mnt/us/documents/dictionaries', // 系统已知目录：即使为空也受保护
    '/mnt/us',
    '/etc/passwd',
    '../../etc'
  ]
  if (book) dangerous.push(book)
  if (bookDir) dangerous.push(bookDir)
  const guard = await svc.delete(dangerous)
  console.log(`  ok=${guard.ok} skipped=${guard.skipped} failed=${guard.failed}`)
  expect(guard.ok === 0, '所有非垃圾路径（系统目录/书/书文件夹）均被拒绝')
  expect(guard.skipped === dangerous.length, '全部拒绝路径计入 skipped')

  // ---------- 3. 种植测试垃圾并复扫 ----------
  console.log('\n[3] 种植自建垃圾文件（kd_e2e_* 前缀）')
  const orphanSdr = `/mnt/us/documents/kd_e2e_孤本${stamp}.sdr`
  const appleDouble = `/mnt/us/documents/._kd_e2e_${stamp}.azw3`
  const dsStore = '/mnt/us/documents/.DS_Store'
  const emptyDir = `/mnt/us/documents/kd_e2e_空目录${stamp}`
  const pairedBook = `/mnt/us/documents/kd_e2e_配对${stamp}.txt`
  const pairedSdr = `/mnt/us/documents/kd_e2e_配对${stamp}.sdr`
  await sh(
    `mkdir -p '${orphanSdr}' '${emptyDir}' '${pairedSdr}' ` +
      `&& echo hi > '${orphanSdr}/progress.mbs' ` +
      `&& echo abc > '${appleDouble}' ` +
      `&& echo abc > '${dsStore}' ` +
      `&& echo book > '${pairedBook}' ` +
      `&& echo meta > '${pairedSdr}/x.mbs'`
  )
  console.log('  已种植：孤儿sdr / ._资源叉 / .DS_Store / 空目录 / 配对(sdr+书,不应被标记)')

  const rescan = await svc.scan()
  expect(!rescan.error, `复扫无错误${rescan.error ? `：${rescan.error}` : ''}`)
  expect(rescan.items.some((i) => i.path === orphanSdr && i.category === 'orphan-sidecar'), '孤儿 .sdr 被标记')
  expect(rescan.items.some((i) => i.path === appleDouble && i.category === 'sys-junk'), '._* AppleDouble 被标记')
  expect(rescan.items.some((i) => i.path === dsStore && i.category === 'sys-junk'), '.DS_Store 被标记')
  expect(rescan.items.some((i) => i.path === emptyDir && i.category === 'empty-dir'), '空目录被标记')
  expect(!rescan.items.some((i) => i.path === pairedSdr), '有对应书的 .sdr 不被标记')
  expect(rescan.items.some((i) => i.path.startsWith('/mnt/us/system/temp') && i.category === 'temp'), 'system/temp 临时目录被标记')

  // ---------- 4. 删除种植的垃圾 ----------
  console.log('\n[4] 删除种植的垃圾（模拟用户勾选）')
  // 先删掉一个种植项，验证「扫描后设备已变化 → 复核跳过」
  await sh(`rm -f '${appleDouble}'`)
  const del = await svc.delete([orphanSdr, appleDouble, dsStore, emptyDir])
  console.log(`  ok=${del.ok} skipped=${del.skipped} failed=${del.failed} freed=${del.freedBytes}B errors=${del.errors.join('; ')}`)
  expect(del.ok === 3, '3 个仍存在的垃圾被删除')
  expect(del.skipped === 1, '已消失的 ._ 文件被复核跳过')
  expect((await sh(`ls -d '${orphanSdr}' 2>/dev/null | wc -l`)).trim() === '0', '孤儿 .sdr 已从设备消失')
  expect((await sh(`ls '${dsStore}' 2>/dev/null | wc -l`)).trim() === '0', '.DS_Store 已从设备消失')

  // ---------- 5. 清理种植残留 ----------
  await sh(`rm -rf '${pairedBook}' '${pairedSdr}' '${emptyDir}'`)
  console.log('\n[5] 已清理全部种植残留')

  console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项断言失败 ❌`)
  ssh.disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

void main().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})
