import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Plus, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { api, errorMessage } from '../../lib/apiClient'

type InvitationRole = 'admin' | 'operator'
type Invitation = {
  id: string
  role: InvitationRole
  codeHint: string
  maxUses: number
  usedCount: number
  expiresAt: string
  status: 'active' | 'used' | 'revoked'
  createdAt: string
}

export function InvitationKeysPage() {
  const [role, setRole] = useState<InvitationRole>('operator')
  const [keys, setKeys] = useState<Invitation[]>([])
  const [newCode, setNewCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<Invitation[]>('/invitations')
      setKeys(response.data)
      setError('')
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const generate = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    setNewCode('')
    setCopied(false)
    try {
      const response = await api.post<{ invitation: { code: string } }>('/invitations', {
        role, maxUses: 1, expiresInDays: 7
      })
      setNewCode(response.data.invitation.code)
      setNotice('Invitation created. Copy this key now; the full secret is shown only once.')
      await refresh()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    if (!newCode) return
    try {
      await navigator.clipboard.writeText(newCode)
      setCopied(true)
    } catch {
      setError('Clipboard access was blocked. Select and copy the key manually.')
    }
  }

  const revoke = async (id: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.patch('/invitations/' + id + '/revoke')
      setNotice('Invitation revoked.')
      await refresh()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const active = keys.filter((key) => key.status === 'active' && Date.parse(key.expiresAt) > Date.now()).length
  const used = keys.filter((key) => key.status === 'used').length

  return <main className="dashboard-content invitation-page">
    <div className="page-intro">
      <div>
        <span className="mono-label">ACCESS CONTROL / ADMINISTRATOR</span>
        <h1 className="ops-heading">Invitation keys</h1>
        <p className="ops-copy">Issue controlled, time-limited access for administrators and operations colleagues.</p>
      </div>
      <span className="status-pill">Administrator only</span>
    </div>

    {error && <div role="alert" className="page-alert">{error}</div>}
    {notice && <div role="status" className="page-notice">{notice}</div>}

    <div className="invitation-summary-grid">
      <article className="card-ops invitation-summary-card"><span className="mono-label">ISSUED KEYS</span><strong>{keys.length}</strong><small>All invitation records</small></article>
      <article className="card-ops invitation-summary-card"><span className="mono-label">ACTIVE</span><strong>{active}</strong><small>Available for redemption</small></article>
      <article className="card-ops invitation-summary-card"><span className="mono-label">REDEEMED</span><strong>{used}</strong><small>Use limit reached</small></article>
    </div>

    <section className="card-ops invitation-create-card">
      <div className="invitation-create-copy">
        <span className="invitation-icon"><KeyRound size={18} /></span>
        <div>
          <h2>Generate an invitation</h2>
          <p className="ops-copy">New keys are single-use and expire after seven days. Only a hash is stored in the database.</p>
        </div>
      </div>
      <div className="invitation-create-controls">
        <label className="invitation-role-label">Stakeholder role
          <select className="field" value={role} onChange={(event) => setRole(event.target.value as InvitationRole)}>
            <option value="operator">Operations team</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        <button type="button" className="button button-dark invitation-generate" onClick={() => void generate()} disabled={busy}>
          <Plus size={15} /> {busy ? 'Generating…' : 'Generate invitation key'}
        </button>
      </div>
      {newCode && <div className="invitation-secret-panel">
        <div><span className="mono-label">NEW KEY · COPY BEFORE LEAVING</span><code>{newCode}</code></div>
        <button type="button" className="small-button" onClick={() => void copyCode()}><Copy size={14} /> {copied ? 'Copied ✓' : 'Copy key'}</button>
      </div>}
    </section>

    <section className="card-ops invitation-list-card">
      <div className="invitation-list-heading">
        <div><span className="mono-label">KEY INVENTORY</span><h2>Issued invitations</h2></div>
        <button className="small-button" type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button>
      </div>
      <div className="table-wrap">
        <table className="dash-table invitation-table">
          <thead><tr><th>KEY REFERENCE</th><th>TARGET ROLE</th><th>USAGE</th><th>EXPIRES</th><th>STATUS</th><th>ACTION</th></tr></thead>
          <tbody>{keys.map((key) => {
            const expired = Date.parse(key.expiresAt) <= Date.now() && key.status === 'active'
            const status = expired ? 'expired' : key.status
            return <tr key={key.id}>
              <td><code className="invitation-code-hint">•••• {key.codeHint}</code></td>
              <td>{key.role === 'admin' ? 'Administrator' : 'Operations team'}</td>
              <td className="mono">{key.usedCount}/{key.maxUses}</td>
              <td>{new Date(key.expiresAt).toLocaleDateString('en-PK')}</td>
              <td><span className={`status-pill ${status === 'active' ? 'status-positive' : status === 'used' ? 'status-muted' : 'status-warning'}`}>{status.toUpperCase()}</span></td>
              <td>{key.status === 'active' && !expired
                ? <button className="small-button" type="button" disabled={busy} onClick={() => void revoke(key.id)}><XCircle size={13} /> Revoke</button>
                : <span className="ops-muted">—</span>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {keys.length === 0 && <p className="ops-copy invitation-empty">No invitation keys have been issued yet.</p>}
    </section>

    <p className="invitation-security-note"><ShieldCheck size={15} /> Full invitation secrets are never returned by the list endpoint or stored as readable text.</p>
  </main>
}
