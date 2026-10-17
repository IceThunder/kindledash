import { createT, type Lang, type TFunc } from '../shared/i18n'

// 主进程文案（错误信息 / 对话框标题 / 清理 reason 等）与渲染端共用一套字典。
// 语言状态由 kd:set-language IPC 更新；生成时机在错误发生时，切换语言后的
// 新文案立即生效，已生成并展示的历史字符串不回溯翻译。

let lang: Lang = 'zh'
let t: TFunc = createT(lang)

export function setMainLang(next: Lang): void {
  lang = next
  t = createT(next)
}

export function mainLang(): Lang {
  return lang
}

/** 主进程翻译函数（渲染端请用 renderer/src/i18n.tsx 的 useI18n） */
export function tMain(key: Parameters<TFunc>[0], params?: Record<string, string | number>): string {
  return t(key, params)
}
