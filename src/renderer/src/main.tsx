import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { kd } from './api'
import './styles.css'
import '@xterm/xterm/css/xterm.css'

// 先从主进程取语言（settings.json / 系统语言检测的结果）再渲染，避免首帧英文闪烁
void kd.getLanguage().then((lang) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App initialLang={lang} />
    </React.StrictMode>
  )
})
