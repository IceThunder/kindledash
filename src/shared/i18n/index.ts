import { zh } from './zh'
import { en } from './en'
import { ja } from './ja'
import { ko } from './ko'

export type Lang = 'zh' | 'en' | 'ja' | 'ko'
export type Dict = typeof zh

export const LANGS: { id: Lang; native: string }[] = [
  { id: 'zh', native: '简体中文' },
  { id: 'en', native: 'English' },
  { id: 'ja', native: '日本語' },
  { id: 'ko', native: '한국어' }
]

export const DICTS: Record<Lang, Dict> = { zh, en, ja, ko }

/** 各语言对应的 BCP 47 区域标签（日期/时间格式化用） */
export const LOCALE_TAGS: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR'
}

/** 嵌套字典的扁平点路径键：'cleanup.scanBtn' 等 */
type Paths<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T & string]: Paths<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>
    }[keyof T & string]
  : Prefix

export type I18nKey = Paths<Dict>

export type TFunc = (key: I18nKey, params?: Record<string, string | number>) => string

function flatten(obj: Record<string, unknown>, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else flatten(v as Record<string, unknown>, key, out)
  }
  return out
}

const TABLES: Record<Lang, Record<string, string>> = {
  zh: flatten(zh),
  en: flatten(en),
  ja: flatten(ja),
  ko: flatten(ko)
}

/** 创建指定语言的翻译函数；{x} 占位符用 params 填充 */
export function createT(lang: Lang): TFunc {
  const table = TABLES[lang] ?? TABLES.zh
  return (key, params) => {
    let s = table[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
    }
    return s
  }
}

/** 系统区域标签 → 支持的语言；zh/en/ja/ko 前缀匹配，其余回落英文 */
export function detectLang(locale: string): Lang {
  const l = (locale || '').toLowerCase().replace('_', '-')
  if (l.startsWith('zh')) return 'zh'
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('ko')) return 'ko'
  return 'en'
}

export function isLang(v: unknown): v is Lang {
  return v === 'zh' || v === 'en' || v === 'ja' || v === 'ko'
}
