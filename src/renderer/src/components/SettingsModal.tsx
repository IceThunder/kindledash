import { useEffect, useState } from 'react'
import { useConn } from '../store'
import { useI18n } from '../i18n'
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
  const { t } = useI18n()
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
      setError(t('settings.hostRequired'))
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
        <h3>{editing ? t('settings.editDevice') : t('settings.addDevice')}</h3>
        <div className="form-row">
          <label>{t('settings.nameLabel')}</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={t('settings.namePlaceholder')}
          />
        </div>
        <div className="form-row">
          <label>{t('settings.hostLabel')}</label>
          <input
            className="input"
            value={form.host}
            onChange={(e) => set({ host: e.target.value })}
            placeholder={t('settings.hostPlaceholder')}
          />
        </div>
        <div className="form-row" style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label>{t('settings.portLabel')}</label>
            <input
              className="input"
              type="number"
              value={form.port}
              onChange={(e) => set({ port: parseInt(e.target.value, 10) || 22 })}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label>{t('settings.userLabel')}</label>
            <input className="input" value={form.username} onChange={(e) => set({ username: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <label>{t('settings.authLabel')}</label>
          <select
            className="input"
            value={form.authMethod}
            onChange={(e) => set({ authMethod: e.target.value as 'key' | 'password' })}
          >
            <option value="key">{t('settings.authKey')}</option>
            <option value="password">{t('settings.authPassword')}</option>
          </select>
        </div>
        {form.authMethod === 'key' ? (
          <div className="form-row">
            <label>{t('settings.keyPathLabel')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input mono"
                style={{ flex: 1 }}
                value={form.privateKeyPath}
                onChange={(e) => set({ privateKeyPath: e.target.value })}
                placeholder={t('settings.keyPlaceholder')}
              />
              <button className="btn" onClick={() => void pickKey()} title={t('settings.pickKeyTitle')}>
                {t('settings.browse')}
              </button>
            </div>
          </div>
        ) : (
          <div className="form-row">
            <label>{t('settings.authPassword')}</label>
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
            {t('settings.keepAwake')}
            <span style={{ color: 'var(--text-faint)' }}>{t('settings.keepAwakeHint')}</span>
          </label>
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{t('settings.connectFailed', { err: error })}</div>}
        <div className="form-actions" style={{ justifyContent: 'space-between' }}>
          <div>
            {editing && (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                {t('settings.delete')}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn" disabled={busy || !form.host} onClick={() => void save(false)}>
              {t('settings.save')}
            </button>
            <button className="btn primary" disabled={busy || !form.host} onClick={() => void save(true)}>
              {busy ? t('settings.connecting') : t('settings.saveConnect')}
            </button>
          </div>
        </div>

        {confirmDelete && (
          <ConfirmDialog
            title={t('settings.deleteTitle', { name: form.name || form.host })}
            body={<>{t('settings.deleteBody')}</>}
            confirmText={t('settings.delete')}
            danger
            onConfirm={() => void doDelete()}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </div>
    </div>
  )
}
