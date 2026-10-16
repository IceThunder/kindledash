import { useEffect, useState } from 'react'
import { useConn } from '../store'
import { kd } from '../api'
import type { ConnectionSettings } from '../../../shared/types'

export default function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, connect, disconnect, state } = useConn()
  const [form, setForm] = useState<ConnectionSettings>(
    settings ?? {
      host: '',
      port: 22,
      username: 'root',
      authMethod: 'key',
      privateKeyPath: '',
      password: '',
      keepAwake: true
    }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
  }, [form.host, form.port, form.username, form.authMethod, form.privateKeyPath, form.password])

  const set = (patch: Partial<ConnectionSettings>) => setForm((f) => ({ ...f, ...patch }))

  const handleConnect = async () => {
    setBusy(true)
    setError('')
    try {
      await disconnect()
    } catch {
      /* ignore */
    }
    try {
      await connect(form)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>连接设置</h3>
        <div className="form-row">
          <label>设备地址（IP）</label>
          <input
            className="input"
            value={form.host}
            onChange={(e) => set({ host: e.target.value })}
            placeholder="例如 192.168.1.100"
          />
        </div>
        <div className="form-row" style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label>SSH 端口</label>
            <input
              className="input"
              type="number"
              value={form.port}
              onChange={(e) => set({ port: parseInt(e.target.value, 10) || 22 })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>用户名</label>
            <input className="input" value={form.username} onChange={(e) => set({ username: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <label>认证方式</label>
          <select className="input" value={form.authMethod} onChange={(e) => set({ authMethod: e.target.value as 'key' | 'password' })}>
            <option value="key">SSH 私钥</option>
            <option value="password">密码</option>
          </select>
        </div>
        {form.authMethod === 'key' ? (
          <div className="form-row">
            <label>私钥路径（本机）</label>
            <input
              className="input mono"
              value={form.privateKeyPath}
              onChange={(e) => set({ privateKeyPath: e.target.value })}
              placeholder="例如 ~/.ssh/id_rsa"
            />
          </div>
        ) : (
          <div className="form-row">
            <label>密码</label>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => set({ password: e.target.value })}
            />
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>连接失败：{error}</div>
        )}
        <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            id="keep-awake"
            type="checkbox"
            checked={form.keepAwake !== false}
            onChange={(e) => set({ keepAwake: e.target.checked })}
          />
          <label htmlFor="keep-awake" style={{ margin: 0 }}>
            连接期间保持设备唤醒
            <span style={{ color: 'var(--text-faint)' }}>（防止 Kindle 自动休眠导致频繁断连）</span>
          </label>
        </div>
        <div className="form-actions">
          {state === 'connected' && (
            <button
              className="btn"
              onClick={async () => {
                await kd.saveSettings(form)
                await disconnect()
                onClose()
              }}
            >
              仅保存并断开
            </button>
          )}
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={busy || !form.host} onClick={handleConnect}>
            {busy ? '连接中…' : '保存并连接'}
          </button>
        </div>
      </div>
    </div>
  )
}
