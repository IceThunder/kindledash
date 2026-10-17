import React, { createContext, useContext, useMemo, useState } from 'react'
import { kd } from './api'
import { createT, LOCALE_TAGS, type I18nKey, type Lang, type TFunc } from '../../shared/i18n'

// 模块级语言状态：store.tsx 里的 fmtTime/fmtUptime/STATE_LABEL 等非组件工具函数
// 也需要跟随语言，Provider 变更时同步更新。
let currentLang: Lang = 'zh'

/** 日期/时间格式化的区域标签（跟随当前语言） */
export function localeTag(): string {
  return LOCALE_TAGS[currentLang]
}

interface I18nCtx {
  lang: Lang
  /** 切换语言：更新界面并写回主进程 settings.json */
  setLang: (lang: Lang) => void
  t: TFunc
}

const I18nContext = createContext<I18nCtx>(null as never)
export const useI18n = (): I18nCtx => useContext(I18nContext)

export function I18nProvider({
  initialLang,
  children
}: {
  initialLang: Lang
  children: React.ReactNode
}): JSX.Element {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const t = useMemo(() => createT(lang), [lang])

  const setLang = (next: Lang) => {
    setLangState(next)
    currentLang = next
    document.documentElement.lang = LOCALE_TAGS[next]
    void kd.setLanguage(next)
  }

  // 首帧同步一次模块状态与 <html lang>
  currentLang = lang
  document.documentElement.lang = LOCALE_TAGS[lang]

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

/** 非组件环境（如 xterm 回调闭包）使用的翻译函数，读取当前语言 */
export function tNow(key: I18nKey, params?: Record<string, string | number>): string {
  return createT(currentLang)(key, params)
}
