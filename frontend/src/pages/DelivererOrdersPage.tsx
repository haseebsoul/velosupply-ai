import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, PackageCheck, RefreshCw, Truck } from 'lucide-react'
import { EditorialNavbar } from '../components/storefront/EditorialNavbar'
import { api, errorMessage } from '../lib/apiClient'
import type { Order } from '../types'

function statusClass(status: string) {
  return status === 'DELIVERED' ? 'status-pill status-positive'
    : status === 'DISPATCHED' ? 'status-pill status-warning' : 'status-pill'
}
export function DelivererOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get<Order[]>('/deliverer/orders')
      setOrders(response.data)
      setError('')
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const confirmDelivery = async (orderId: string) => {
    setBusyId(orderId); setError(''); setNotice('')
    try {
      await api.patch('/deliverer/orders/' + encodeURIComponent(orderId) + '/status', { status: 'DELIVERED' }, {
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      })
      setNotice('Delivery confirmed. The buyer order status is now updated.')
      await load()
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusyId('') }
  }
  return <div className="editorial delivery-portal-page">
    <EditorialNavbar />
    <main className="wrap section delivery-portal-main">
      <div className="buyer-portal-heading">
        <div><span className="eyebrow">DELIVERER WORKSPACE</span><h1 className="section-title">Assigned deliveries</h1><p className="muted">Only shipments assigned to your account appear here.</p></div>
        <button type="button" className="button button-outline" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
      </div>
      {error && <div className="page-alert" role="alert">{error}</div>}
      {notice && <div className="page-notice" role="status">{notice}</div>}
      {loading ? <div className="card-light buyer-empty">Loading assigned deliveries…</div> :
        orders.length === 0 ? <div className="card-light buyer-empty"><PackageCheck size={30} /><h2>No assigned deliveries</h2><p className="muted">Your administrator or operations team will assign packed shipments to this account.</p></div> :
          <div className="delivery-card-list">
            {orders.map(order => <article className="card-light delivery-order-card" key={order.id}>
              <div className="delivery-order-heading"><div><span className="mono-label">SHIPMENT REFERENCE</span><h2>{order.id}</h2></div><span className={statusClass(order.status)}>{order.status}</span></div>
              <div className="delivery-order-details">
                <div><span className="mono-label">RECIPIENT</span><strong>{order.customerName || 'Buyer'}</strong><small>{order.customerEmail || 'Email not supplied'}</small></div>
                <div><span className="mono-label">DESTINATION</span><strong>{order.city || order.shippingRegion || 'Address not supplied'}</strong><small>{order.address || 'See order fulfilment notes'}</small></div>
                <div><span className="mono-label">ITEMS</span><strong>{(order.items || []).reduce((sum, item) => sum + Number(item.qty || item.quantity || 0), 0)} units</strong><small>{(order.items || []).length} order lines</small></div>
              </div>
              {order.status === 'DISPATCHED' && <button type="button" className="button button-dark delivery-confirm-button" disabled={busyId === order.id} onClick={() => void confirmDelivery(order.id)}><CheckCircle2 size={16} /> {busyId === order.id ? 'Confirming…' : 'Confirm delivery'}</button>}
              {order.status === 'DELIVERED' && <p className="delivery-complete-note"><CheckCircle2 size={15} /> Delivery confirmed</p>}
            </article>)}
          </div>}
      <p className="buyer-data-note"><Truck size={14} /> Delivery access is limited to assigned shipments. You cannot view inventory, workspace users, or unassigned orders.</p>
    </main>
  </div>
}
