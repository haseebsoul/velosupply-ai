import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Truck } from 'lucide-react'
import { api, errorMessage } from '../../lib/apiClient'
import type { Order } from '../../types'

type Deliverer = { id: string; name: string; email: string }
export function DeliveryAssignmentsPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [deliverers, setDeliverers] = useState<Deliverer[]>([])
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [orderResponse, delivererResponse] = await Promise.all([
        api.get<Order[]>('/orders'), api.get<Deliverer[]>('/admin/deliverers')
      ])
      setOrders(orderResponse.data.filter(order => order.status === 'PACKED' || (order.status === 'DISPATCHED' && !order.assignedDelivererId)))
      setDeliverers(delivererResponse.data)
      setSelected(current => {
        const next = { ...current }
        for (const order of orderResponse.data) if (order.assignedDelivererId) next[order.id] = order.assignedDelivererId
        return next
      })
      setError('')
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const assign = async (orderId: string) => {
    const delivererId = selected[orderId]
    if (!delivererId) { setError('Select an active Deliverer account first.'); return }
    setBusyId(orderId); setError(''); setNotice('')
    try {
      await api.patch('/orders/' + encodeURIComponent(orderId) + '/assign-deliverer', { delivererId })
      setNotice('Deliverer assigned to shipment.')
      await load()
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusyId('') }
  }
  return <main className="dashboard-content delivery-assignment-page">
    <div className="page-intro"><div><span className="mono-label">FULFILLMENT / LAST MILE</span><h1 className="ops-heading">Delivery assignments</h1><p className="ops-copy">Assign packed shipments to invitation-approved Deliverer accounts.</p></div><button className="small-button" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button></div>
    {error && <div className="page-alert" role="alert">{error}</div>}
    {notice && <div className="page-notice" role="status">{notice}</div>}
    <section className="card-ops delivery-assignment-card">
      <div className="delivery-assignment-heading"><div><Truck size={18} /><div><h2>Ready for delivery</h2><p className="ops-copy">Only packed and dispatched orders can be assigned.</p></div></div><span className="status-pill">{orders.length} shipments</span></div>
      {loading ? <p className="ops-copy">Loading orders and Deliverer accounts…</p> :
        deliverers.length === 0 ? <div className="delivery-assignment-empty"><h3>No active Deliverer accounts</h3><p className="ops-copy">Generate a Deliverer invitation under Invitation keys, then have the recipient complete registration.</p></div> :
          orders.length === 0 ? <div className="delivery-assignment-empty"><h3>No shipments ready for delivery</h3><p className="ops-copy">An order becomes assignable after Operations advances it to Packed.</p></div> :
            <div className="table-wrap"><table className="dash-table delivery-assignment-table">
              <thead><tr><th>ORDER</th><th>DESTINATION</th><th>STATUS</th><th>DELIVERER</th><th>ACTION</th></tr></thead>
              <tbody>{orders.map(order => <tr key={order.id}>
                <td><strong>{order.code || order.id}</strong><small>{order.customerName || 'Buyer'}</small></td>
                <td>{order.city || order.shippingRegion || '—'}</td>
                <td><span className="status-pill">{order.status}</span></td>
                <td><select className="field delivery-assignee-select" aria-label={'Deliverer for ' + (order.code || order.id)} value={selected[order.id] || ''} onChange={event => setSelected(current => ({ ...current, [order.id]: event.target.value }))}>
                  <option value="">Select Deliverer</option>{deliverers.map(person => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}
                </select></td>
                <td><button className="small-button" type="button" disabled={busyId === order.id || !selected[order.id]} onClick={() => void assign(order.id)}>{busyId === order.id ? 'Saving…' : 'Assign'}</button></td>
              </tr>)}</tbody>
            </table></div>}
    </section>
    <p className="ops-copy delivery-assignment-note">Assignments are enforced by the API. A Deliverer can only read assigned orders and confirm delivery when the shipment is dispatched.</p>
  </main>
}
