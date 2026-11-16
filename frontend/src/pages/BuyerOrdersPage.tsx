import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, PackageCheck, RefreshCw } from 'lucide-react'
import { EditorialNavbar } from '../components/storefront/EditorialNavbar'
import { api, errorMessage } from '../lib/apiClient'
import type { Order } from '../types'

const money = new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })

function orderTotal(order: Order) {
  return order.price?.totalPkr ??
    (Number.isSafeInteger(order.totalMinor) ? Number(order.totalMinor) / 100 : Number(order.total || 0))
}
function statusClass(status: string) {
  const value = status.toUpperCase()
  if (['DELIVERED', 'CONFIRMED'].includes(value)) return 'status-pill status-positive'
  if (['DISPATCHED', 'PICKING', 'PACKED'].includes(value)) return 'status-pill status-warning'
  if (['CANCELLED', 'RETURNED'].includes(value)) return 'status-pill status-critical'
  return 'status-pill'
}

export function BuyerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get<Order[]>('/orders')
      setOrders(response.data)
      setError('')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  return <div className="editorial buyer-portal-page">
    <EditorialNavbar />
    <main className="wrap section buyer-portal-main">
      <div className="buyer-portal-heading">
        <div><span className="eyebrow">YOUR ACCOUNT</span><h1 className="section-title">Order tracking</h1><p className="muted">Your orders and their latest workspace status.</p></div>
        <div className="buyer-portal-actions">
          <Link className="button button-outline" to="/store/account">Account details</Link>
          <button type="button" className="button button-outline" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>
      {error && <div className="page-alert" role="alert">{error}</div>}
      {loading ? <div className="card-light buyer-empty">Loading your orders…</div> :
        orders.length === 0 ? <div className="card-light buyer-empty"><PackageCheck size={28} /><h2>No orders yet</h2><p className="muted">Orders placed with this account will appear here.</p><Link className="button button-dark" to="/store">Browse catalogue</Link></div> :
          <div className="card-light buyer-order-list">
            {orders.map((order) => <article className="buyer-order-row" key={order.id}>
              <div><span className="mono-label">ORDER REFERENCE</span><strong>{order.id}</strong><small>{order.createdAt ? new Date(order.createdAt).toLocaleString('en-PK') : 'Date not supplied'}</small></div>
              <div><span className="mono-label">STATUS</span><span className={statusClass(order.status)}>{order.status}</span></div>
              <div><span className="mono-label">FULFILLMENT HUB</span><strong>{order.warehouse_hub || 'Routing not assigned'}</strong><small>{order.city || order.shippingRegion || 'Delivery address on order'}</small></div>
              <div><span className="mono-label">ORDER TOTAL</span><strong className="mono">{money.format(orderTotal(order))}</strong></div>
              <Link className="buyer-order-open" to="/store/account" aria-label="Open account details"><ArrowUpRight size={15} /></Link>
            </article>)}
          </div>}
      <p className="buyer-data-note">Orders are scoped by the authenticated account. Carrier tracking details appear when a delivery provider is connected.</p>
    </main>
  </div>
}
