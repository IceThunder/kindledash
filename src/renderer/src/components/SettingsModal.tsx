import { useEffect, useState } from 'react'
import { useConn } from '../store'
import { kd } from '../api'
import type { DeviceProfile } from '../../../shared/types'
import { ConfirmDialog } from './ui'

const EMPTY_FORM: Omit<DeviceProfile, 'id'> = {
  name: '',
  host: '',
  port: 22,
  username: 'root',
  authMethod: 'key',
  privateKeyPath: '',
  password: '',
  keepAwake: true
}

export default function SettingsModal({
  editing,
  onClose
}: {
  /** null = 新增设备；DeviceProfile = 编辑该设备 */
  editing: DeviceProfile | null
  onClose: () => void
}): JSX.Element {
  const { connectDevice, refreshDevices } = useConn()
  const [form, setForm] = useState<DeviceProfile>(
    editing ?? { ...EMPTY_FORM, id: crypto.randomUUID(), name: '' }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setError('')
  }, [form.host, form.port, form.username, form.authMethod, form.privateKeyPath, form.password])

  const set = (patch: Partial<DeviceProfile>) => setForm((f) => ({ ...f, ...patch }))

  const pickKey = async () => {
    const p = await kd.pickKeyFile()
    if (p) set({ privateKeyPath: p })
  }

  const save = async (connectNow: boolean) => {
    if (!form.host.trim()) {
      setError('请填写设备地址')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (connectNow) {
        try {
          await kd.disconnect()
        } catch {
          /* ignore */
        }
      }
      const store = await kd.deviceSave(form, connectNow)
      await refreshDevices(store)
      if (connectNow) await connectDevice(form)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    setConfirmDelete(false)
    const store = await kd.deviceDelete(form.id)
    await refreshDevices(store)
    onClose()
  }

  return (
    <div className="modal-mask" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{editing ? '编辑设备' : '添加设备'}</h3>
        <div className="form-row">
          <label>设备名称（便于区分多台 Kindle）</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="例如 客厅的 Kindle"
          />
        </div>
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
          <select
            className="input"
            value={form.authMethod}
            onChange={(e) => set({ authMethod: e.target.value as 'key' | 'password' })}
          >
            <option value="key">SSH 私钥</option>
            <option value="password">密码</option>
          </select>
        </div>
        {form.authMethod === 'key' ? (
          <div className="form-row">
            <label>私钥路径（本机）</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input mono"
                style={{ flex: 1 }}
                value={form.privateKeyPath}
                onChange={(e) => set({ privateKeyPath: e.target.value })}
                placeholder="例如 ~/.ssh/id_rsa"
              />
              <button className="btn" onClick={() => void pickKey()} title="从本机选择私钥文件">
                浏览…
              </button>
            </div>
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
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>连接失败：{error}</div>}
        <div className="form-actions" style={{ justifyContent: 'space-between' }}>
          <div>
            {editing && (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                删除
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              取消
            </button>
            <button className="btn" disabled={busy || !form.host} onClick={() => void save(false)}>
              保存
            </button>
            <button className="btn primary" disabled={busy || !form.host} onClick={() => void save(true)}>
              {busy ? '连接中…' : '保存并连接'}
            </button>
          </div>
        </div>

        {confirmDelete && (
          <ConfirmDialog
            title={`删除设备「${form.name || form.host}」`}
            body={<>只删除本机的连接记录，不影响设备本身。确定删除吗？</>}
            confirmText="删除"
            danger
            onConfirm={() => void doDelete()}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </div>
    </div>
  )
}
