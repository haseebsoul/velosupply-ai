import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/apiClient'
import { useAppStore } from '../../store/useAppStore'
import type { Order } from '../../types'

const nextStatus: Record<string, string | undefined> = {
  PLACED: 'CONFIRMED', CONFIRMED: 'PICKING', PICKING: 'PACKED', PACKED: 'DISPATCHED', DISPATCHED: 'DELIVERED',
}
const money = new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })

export function OrdersPage() {
  const user = useAppStore((state) => state.user)
  const canOperate = user?.role === 'admin' || user?.role === 'operator'
  const [orders, setOrders] = useState<Order[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [references, setReferences] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try { const { data } = await api.get<Order[]>('/orders'); setOrders(data); setError('') }
    catch (reason) { setError(errorMessage(reason)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key); setError(''); setNotice('')
    try { await action(); setNotice(message); await refresh() }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(null) }
  }
  const updateStatus = (order: Order, status: string) => run(order.id,
    () => api.patch(`/orders/${order.id}/status`, { status }, {
      headers: status === 'DISPATCHED' ? { 'Idempotency-Key': crypto.randomUUID() } : undefined
    }),
    status === 'DELIVERED' ? 'Delivery was recorded as an operator report, not independently verified.' : `Order advanced to ${status}.`)
  const recordCod = (order: Order) => {
    const externalReference = references[order.id]?.trim()
    const amountMinor = order.totalMinor ?? order.price?.totalMinor
    if (!externalReference || !Number.isSafeInteger(amountMinor) || Number(amountMinor) <= 0) {
      setError('Enter a manual receipt reference and confirm the order total is available.'); return
    }
    void run(order.id, () => api.post(`/orders/${order.id}/payment/record-cod`, { amountMinor, externalReference }),
      'Manual COD reference recorded. Cash receipt is not independently verified.')
  }
  const cancelOrder = (order: Order) => run(order.id,
    () => api.post(`/orders/${order.id}/cancel`, {}, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
    'Order cancelled; reserved stock release was recorded.')
  const requestReturn = (order: Order) => {
    const reason = reasons[order.id]?.trim()
    if (!reason) { setError('Enter a reason before requesting a return.'); return }
    void run(order.id, () => api.post(`/orders/${order.id}/return`, { reason }), 'Return request recorded for staff review.')
  }
  return <main className="dashboard-content">
    <div className="drawer-head"><div><span className="mono-label">BUYER / OPERATIONS WORKFLOW</span><h1 className="ops-heading">Orders</h1>
      <p className="ops-copy">{canOperate ? 'Review orders and record operator actions.' : 'Review your own orders and request cancellation or returns.'}</p></div>
      <button className="small-button" onClick={() => void refresh()}>Refresh</button></div>
    <div className="card-ops dash-card" style={{ marginBottom: 16 }}><strong>Evidence boundary</strong>
      <p className="ops-copy">Manual COD references and operator-reported delivery are not independently verified. No payment provider or courier proof-of-delivery service is connected. HUB-KHI is a proposed site, not a verified operating facility.</p></div>
    {error && <div role="alert" className="danger-text" style={{ marginBottom: 12 }}>{error}</div>}
    {notice && <div role="status" className="success-text" style={{ marginBottom: 12 }}>{notice}</div>}
    {!orders.length ? <div className="card-ops dash-card"><p className="ops-copy">No orders are available for this account.</p></div> :
      <div style={{ display: 'grid', gap: 12 }}>{orders.map((order) => {
        const amountMinor = order.totalMinor ?? order.price?.totalMinor
        const next = nextStatus[order.status]
        const operatorDelivery = order.deliveryStatus === 'operator_reported' || order.deliveryEvidence?.source === 'operator_report'
        const cod = order.paymentMethod === 'COD'
        const codPending = cod && order.paymentState === 'pending_cod'
        const units = order.items.reduce((sum, item) => sum + (item.qty ?? item.quantity ?? 0), 0)
        return <section className="card-ops dash-card" key={order.id}>
          <div className="drawer-head"><div><span className="mono-label">{order.code || order.id}</span>
            <h3 style={{ margin: '4px 0' }}>{order.customerName || 'Buyer'} · {money.format(Number.isSafeInteger(amountMinor) ? Number(amountMinor) / 100 : 0)}</h3>
            <p className="ops-copy">{order.city || order.shippingRegion || '—'} · {units} units · {order.warehouse_hub || 'unassigned'}</p></div>
            <span className="status-pill">{order.status}</span></div>
          <p className="ops-copy">Payment: {cod ? (codPending ? 'COD pending' : 'manual record entered') : (order.paymentState || 'not recorded')}</p>
          {cod && order.paymentState === 'paid_manual' && <p className="ops-copy">Manual COD reference recorded — not independently verified; no payment-provider confirmation.</p>}
          {operatorDelivery ? <p className="danger-text">Delivery reported by an operator — not independently verified and not courier proof of delivery.</p>
            : <p className="ops-copy">No independent courier delivery status is connected.</p>}
          {canOperate && next && <button className="small-button" disabled={busy === order.id} onClick={() => void updateStatus(order, next)}>{busy === order.id ? 'Saving…' : `Advance to ${next}`}</button>}
          {canOperate && codPending && order.status === 'DELIVERED' && <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <label className="ops-copy">Manual cash receipt reference
              <input className="field" value={references[order.id] || ''} onChange={(event) => setReferences((state) => ({ ...state, [order.id]: event.target.value }))} placeholder="Operator receipt/reference" /></label>
            <button className="small-button" disabled={busy === order.id} onClick={() => recordCod(order)}>Record manual COD amount</button>
            <small className="ops-copy">Stored order total is used; VeloSupply does not verify the cash receipt.</small></div>}
          {!canOperate && ['PLACED', 'CONFIRMED'].includes(order.status) && <button className="small-button" disabled={busy === order.id} onClick={() => void cancelOrder(order)}>Cancel order</button>}
          {!canOperate && order.status === 'DELIVERED' && <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <label className="ops-copy">Return reason
              <input className="field" value={reasons[order.id] || ''} onChange={(event) => setReasons((state) => ({ ...state, [order.id]: event.target.value }))} placeholder="Describe the return reason" /></label>
            <button className="small-button" disabled={busy === order.id} onClick={() => requestReturn(order)}>Request return</button></div>}
          <div className="ops-copy" style={{ marginTop: 10 }}>Created: {order.createdAt ? new Date(order.createdAt).toLocaleString() : '—'}</div>
        </section>
      })}</div>}
  </main>
}
