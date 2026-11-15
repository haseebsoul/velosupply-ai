import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/apiClient'
import { useAppStore } from '../../store/useAppStore'

type ReturnRow = {
  id: string
  orderId: string
  buyerId: string
  reason: string
  status: string
  hubCode?: string | null
  stockDisposition?: 'restockable' | 'quarantine' | 'damaged'
  receiptEvidence?: {
    source?: string
    status?: string
    physicalReceiptConfirmed?: boolean
    conditionAssessed?: boolean
    disposition?: string
    providerVerified?: boolean
    independentlyVerified?: boolean
    reportedAt?: string
  }
  refund?: { status?: string; providerVerified?: boolean }
  createdAt?: string
}

type Disposition = 'restockable' | 'quarantine' | 'damaged'

export function ReturnsPage() {
  const user = useAppStore((state) => state.user)
  const canOperate = user?.role === 'admin' || user?.role === 'operator'
  const [rows, setRows] = useState<ReturnRow[]>([])
  const [hubs, setHubs] = useState<Record<string, string>>({})
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({})
  const [physicalReceipt, setPhysicalReceipt] = useState<Record<string, boolean>>({})
  const [conditionAssessed, setConditionAssessed] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get<ReturnRow[]>('/returns')
      setRows(data)
      setError('')
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const run = async (id: string, action: () => Promise<unknown>, message: string) => {
    setBusy(id)
    setError('')
    setNotice('')
    try {
      await action()
      setNotice(message)
      await refresh()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const decide = (row: ReturnRow, decision: 'approved' | 'rejected') => run(
    row.id,
    () => api.post(`/returns/${row.id}/decision`, { decision }),
    `Return request ${decision}.`
  )

  const receive = (row: ReturnRow) => {
    const hubCode = (hubs[row.id] || '').trim()
    const disposition = dispositions[row.id] || 'quarantine'
    if (!hubCode) {
      setError('Enter a receiving hub code that has been confirmed in physical operations evidence.')
      return
    }
    if (!physicalReceipt[row.id] || !conditionAssessed[row.id]) {
      setError('Confirm physical receipt and condition assessment before recording receipt.')
      return
    }
    void run(row.id, () => api.post(`/returns/${row.id}/receive`, {
      hubCode,
      physicalReceiptConfirmed: true,
      conditionAssessed: true,
      disposition,
    }, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
    `Return receipt recorded as ${disposition}. This operator report is not independently verified.`)
  }

  if (!canOperate) return <main className="dashboard-content">
    <h1 className="ops-heading">Returns</h1>
    <p role="alert" className="danger-text">Returns receiving and disposition are restricted to operators and administrators.</p>
  </main>

  return <main className="dashboard-content">
    <div className="drawer-head">
      <div>
        <span className="mono-label">REVERSE LOGISTICS</span>
        <h1 className="ops-heading">Returns</h1>
        <p className="ops-copy">Review buyer requests, inspect received goods and record their stock disposition.</p>
      </div>
      <button className="small-button" onClick={() => void refresh()}>Refresh</button>
    </div>

    <div className="card-ops dash-card" style={{ marginBottom: 16 }}>
      <strong>Evidence boundary</strong>
      <p className="ops-copy">Physical receipt and condition assessment are operator attestations, not independent verification. A warehouse record does not prove a real facility; HUB-KHI remains proposed. Only inspected restockable items return to saleable stock. Quarantined or damaged items stay out of available inventory.</p>
    </div>
    {error && <div role="alert" className="danger-text" style={{ marginBottom: 12 }}>{error}</div>}
    {notice && <div role="status" className="success-text" style={{ marginBottom: 12 }}>{notice}</div>}

    {!rows.length ? <section className="card-ops dash-card"><p className="ops-copy">No return requests are recorded.</p></section> :
      <div style={{ display: 'grid', gap: 12 }}>
        {rows.map((row) => <section className="card-ops dash-card" key={row.id}>
          <div className="drawer-head">
            <div>
              <span className="mono-label">{row.id}</span>
              <h3 style={{ margin: '4px 0' }}>Order {row.orderId}</h3>
              <p className="ops-copy">{row.reason} · Buyer {row.buyerId}</p>
            </div>
            <span className="status-pill">{row.status}</span>
          </div>
          {row.status === 'requested' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="small-button" disabled={busy === row.id} onClick={() => void decide(row, 'approved')}>Approve for inspection</button>
            <button className="small-button" disabled={busy === row.id} onClick={() => void decide(row, 'rejected')}>Reject request</button>
          </div>}
          {row.status === 'approved' && <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <label className="ops-copy">Receiving hub code
              <input className="field" value={hubs[row.id] || ''} onChange={(event) => setHubs((state) => ({ ...state, [row.id]: event.target.value }))} placeholder="Enter evidence-confirmed hub code" />
            </label>
            <label className="ops-copy">Condition disposition
              <select className="field" value={dispositions[row.id] || 'quarantine'} onChange={(event) => setDispositions((state) => ({ ...state, [row.id]: event.target.value as Disposition }))}>
                <option value="quarantine">Quarantine — do not make saleable</option>
                <option value="damaged">Damaged — do not make saleable</option>
                <option value="restockable">Restockable after inspection</option>
              </select>
            </label>
            <label className="ops-copy" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={Boolean(physicalReceipt[row.id])} onChange={(event) => setPhysicalReceipt((state) => ({ ...state, [row.id]: event.target.checked }))} />
              I physically received these goods at the entered hub (operator attestation)
            </label>
            <label className="ops-copy" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={Boolean(conditionAssessed[row.id])} onChange={(event) => setConditionAssessed((state) => ({ ...state, [row.id]: event.target.checked }))} />
              I assessed the returned goods' condition
            </label>
            <p className="ops-copy">For pilot-tagged orders the receiving hub must match the proposed site recorded on the order. The configured warehouse must also exist, be online and not archived. This does not verify that the physical site exists.</p>
            <button className="small-button" disabled={busy === row.id} onClick={() => receive(row)}>Record receipt and disposition</button>
          </div>}
          {row.status === 'received' && <div style={{ marginTop: 10 }}>
            <p className="ops-copy">Disposition: <strong>{row.stockDisposition || 'not recorded'}</strong></p>
            <p className="danger-text">Operator-reported receipt; not independently verified.</p>
            <p className="ops-copy">Refunds, where applicable, remain manual records. No payment provider or money transfer is performed.</p>
          </div>}
        </section>)}
      </div>}
  </main>
}
