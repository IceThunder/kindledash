import { app } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { detectLang, isLang, type Lang } from '../shared/i18n'

// 应用级设置（userData/settings.json）。历史上该文件曾是单设备配置（已迁移），
// 现在只存 UI 偏好；读写时保留未知字段，避免和旧字段互相覆盖。

interface AppSettings {
  language?: Lang
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: AppSettings | null = null

async function readSettings(): Promise<AppSettings> {
  if (cache) return cache
  try {
    const data = JSON.parse(await readFile(settingsPath(), 'utf8'))
    cache = data && typeof data === 'object' ? (data as AppSettings) : {}
  } catch {
    cache = {}
  }
  return cache
}

async function writeSettings(next: AppSettings): Promise<void> {
  cache = next
  await writeFile(settingsPath(), JSON.stringify(next, null, 2))
}

/**
 * 启动时取得语言：
 * - settings.json 已有 language → 沿用（用户切换过的选择优先于系统语言）
 * - 没有（首次启动或旧版配置）→ 按 macOS 系统语言检测并立即写盘，
 *   之后每次启动都走「读取配置」路径
 */
export async function loadLanguage(): Promise<Lang> {
  const s = await readSettings()
  if (isLang(s.language)) return s.language
  const preferred = app.getPreferredSystemLanguages()[0] || app.getLocale()
  const lang = detectLang(preferred)
  await writeSettings({ ...s, language: lang })
  return lang
}

export async function saveLanguage(lang: Lang): Promise<void> {
  const s = await readSettings()
  await writeSettings({ ...s, language: lang })
}
