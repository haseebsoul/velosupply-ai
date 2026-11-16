import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Boxes, Copy, Download, RefreshCw, ShieldCheck, Truck, Search, Filter, Database } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { api, errorMessage } from '../../lib/apiClient'
import { useWebSocket } from '../../lib/useWebSocket'
import { useAppStore } from '../../store/useAppStore'
import type { InventoryThreat, Metrics, Order, Product, PurchaseOrder, User, UserRole, Warehouse } from '../../types'
import { StatCard } from '../../components/dashboard/StatCard'
import { ThreatRow } from '../../components/dashboard/ThreatRow'
import { TerminalPanel } from '../../components/dashboard/TerminalPanel'
import { TopologyCanvas } from '../../components/dashboard/TopologyCanvas'

const palette = ['var(--hex-c84b11)', 'var(--hex-a93d0b)', 'var(--hex-78716c)', 'var(--hex-d6d0c4)', 'var(--hex-f3efe6)']
const initialMetrics: Metrics = { gmv24h: 0, activeOrders: 0, fulfillmentHealth: 0, packetsPerSec: 0, avgLatencyMs: 0, threatsBlocked: 0, detectionTimeMs: 0, efficiencyScore: 0, hubCapacities: [] }

function orderStatusClass(status: string) {
  const value = status.toUpperCase()
  if (['DELIVERED', 'CONFIRMED'].includes(value)) return 'status-pill status-positive'
  if (['DISPATCHED', 'PICKING', 'PACKED'].includes(value)) return 'status-pill status-warning'
  if (value === 'PLACED') return 'status-pill status-info'
  if (['CANCELLED', 'RETURNED'].includes(value)) return 'status-pill status-critical'
  return 'status-pill status-muted'
}
function purchaseStatusClass(status: PurchaseOrder['status']) {
  return status === 'received' ? 'status-pill status-positive'
    : status === 'shipped' ? 'status-pill status-warning'
      : status === 'approved' ? 'status-pill status-info'
        : 'status-pill status-muted'
}

export function CommandPages() {
  const { pathname } = useLocation()
  const { user } = useAppStore()
  const { events, latest, connected } = useWebSocket()
  const [metrics, setMetrics] = useState(initialMetrics)
  const [products, setProducts] = useState<Product[]>([])
  const [threats, setThreats] = useState<InventoryThreat[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [rewardOffers, setRewardOffers] = useState<Array<{ id: string; title: string; description: string; points: number; minimumScore: number }>>([])
  const [rewardClaims, setRewardClaims] = useState<Array<{ id: string; offerId: string; title: string; points: number; claimedAt: string }>>([])
  const [selectedHub, setSelectedHub] = useState<Warehouse | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [priorityMessageDismissed, setPriorityMessageDismissed] = useState(false)
  const [simulation, setSimulation] = useState({ safetyBuffer: 20, surgeMultiplier: 2, maxLatency: 50 })
  const [search, setSearch] = useState('')
  const [threatFilter, setThreatFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM'>('ALL')
  const [inventoryQuery, setInventoryQuery] = useState('')
  const [inventoryHub, setInventoryHub] = useState('ALL')
  const refresh = useCallback(async () => {
    try {
      const [m, p, o, h] = await Promise.all([api.get<Metrics>('/metrics'), api.get<Product[]>('/products'), api.get<Order[]>('/orders'), api.get<Warehouse[]>('/warehouses')])
      setMetrics(m.data); setProducts(p.data); setOrders(o.data); setWarehouses(h.data); setError('')
    } catch (reason) { setError(errorMessage(reason)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (latest?.metrics) setMetrics(latest.metrics)
    if (latest?.warehouses) setWarehouses(latest.warehouses)
    if (latest?.type === 'ORDER_CREATED' || latest?.type === 'THREAT_RESOLVED') void refresh()
  }, [latest, refresh])
  const refreshPurchaseOrders = useCallback(async () => {
    if (!['admin', 'operator'].includes(user?.role ?? '')) {
      setPurchaseOrders([])
      return
    }
    try {
      const { data } = await api.get<PurchaseOrder[]>('/purchase-orders')
      setPurchaseOrders(data)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [user?.role])
  useEffect(() => {
    if (pathname === '/dashboard/manage') void refreshPurchaseOrders()
  }, [pathname, refreshPurchaseOrders])

  const refreshThreats = useCallback(async () => {
    if (!['admin', 'operator'].includes(user?.role ?? '')) {
      setThreats([])
      return
    }
    try {
      const { data } = await api.get<InventoryThreat[]>('/threats')
      setThreats(data)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [user?.role])
  useEffect(() => {
    if (pathname === '/dashboard/threats') void refreshThreats()
  }, [pathname, refreshThreats])

  useEffect(() => {
    if (pathname === '/dashboard/rewards') {
      api.get<{ offers: typeof rewardOffers; claims: typeof rewardClaims }>('/rewards')
        .then(({ data }) => { setRewardOffers(data.offers); setRewardClaims(data.claims) })
        .catch((reason: unknown) => setError(errorMessage(reason)))
    }
  }, [pathname])

  useEffect(() => {
    if (pathname === '/dashboard/admin' && user?.role === 'admin') api.get<User[]>('/admin/users').then(({ data }) => setUsers(data)).catch((reason: unknown) => setError(errorMessage(reason)))
  }, [pathname, user?.role])
  // Reorder attention is based on sellable units, not on-hand units that may already be reserved.
  const productsAtRisk = useMemo(() => products.filter((product) => {
    const available = Number.isFinite(product.available)
      ? product.available as number
      : product.stock - (product.reserved ?? 0)
    return Number.isFinite(available) &&
      Number.isFinite(product.reorder_threshold) &&
      available <= product.reorder_threshold
  }), [products])
  const history = events.slice(-24).filter((event) => Boolean(event.timestamp)).map((event) => ({ name: new Date(event.timestamp!).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }), orders: Number(event.metrics?.activeOrders ?? 0), throughput: Number(event.metrics?.packetsPerSec ?? 0) }))
  const capacityPercent = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value / 100 : 0))
  const networkUtilization = warehouses.length ? Math.round(warehouses.reduce((sum, hub) => sum + capacityPercent(hub.capacity), 0) / warehouses.length) : 0
  const threatSeverity = (threat: InventoryThreat) => (threat.severity || (threat.level === 'WARN' ? 'medium' : threat.level)).toUpperCase()
  const threatCounts = { CRITICAL: threats.filter((item) => threatSeverity(item) === 'CRITICAL').length, HIGH: threats.filter((item) => threatSeverity(item) === 'HIGH').length, MEDIUM: threats.filter((item) => threatSeverity(item) === 'MEDIUM').length }
  const visibleThreats = threats.filter((item) => threatFilter === 'ALL' || threatSeverity(item) === threatFilter)
  const inventoryProducts = products.filter((product) => (inventoryHub === 'ALL' || product.warehouse_hub === inventoryHub) && `${product.sku} ${product.name} ${product.warehouse_hub}`.toLowerCase().includes(inventoryQuery.trim().toLowerCase()))
  const categories = ['Power', 'Networking', 'Security', 'Infrastructure', 'Retail', 'Computing'].map((category) => ({ category, units: products.filter((product) => product.category === category).reduce((sum, product) => sum + Number(product.stock || 0), 0) }))
  const maxCategoryUnits = Math.max(1, ...categories.map((item) => item.units))
  const request = async (operation: () => Promise<unknown>, success: string, then?: () => void) => {
    try { await operation(); setNotice(success); setError(''); then?.(); await refresh() }
    catch (reason) { setError(errorMessage(reason)) }
  }
  const exportCsv = () => {
    const header = ['order_id', 'customer', 'email', 'region', 'status', 'hub', 'total', 'created_at']
    const rows = orders.map((order) => [order.id, order.customerName, order.customerEmail, order.shippingRegion, order.status, order.warehouse_hub ?? '', order.total ?? '', order.createdAt ?? ''])
    const csv = [header, ...rows].map((row) => row.map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'velosupply-audit-report.csv'; link.click(); URL.revokeObjectURL(url)
  }

  if (error && !products.length && !warehouses.length) return <main className="dashboard-content"><div role="alert" className="danger-text">{error}</div><button className="small-button" onClick={() => void refresh()}>Retry</button></main>
  return <main className="dashboard-content">
    {error && <div role="alert" className="danger-text" style={{ marginBottom: 15 }}>{error}</div>}
    {notice && <div role="status" className="success-text" style={{ marginBottom: 15 }}>{notice}</div>}

    {pathname === '/dashboard' && <>
      <div className="page-intro">
        <div><span className="mono-label">PAKISTAN EDITION / OVERVIEW</span><h1 className="ops-heading">Welcome back, {user?.name ?? 'Operator'}.</h1><p className="ops-copy">A concise view of the orders, inventory and hubs recorded in this workspace.</p></div>
        <span className={`telemetry-state ${connected ? 'connected' : 'disconnected'}`}><i className="live-dot" /> {connected ? 'TELEMETRY CONNECTED' : 'TELEMETRY OFFLINE'}</span>
      </div>
      <div className="dash-grid">
        <StatCard title="24H GROSS MERCHANDISE VALUE" value={metrics.gmv24h} prefix="Rs " note="Recorded order value · trailing 24 hours" />
        <StatCard title="ACTIVE ORDERS" value={metrics.activeOrders} note="Orders not yet closed" />
        <StatCard title="FULFILLMENT HEALTH" value={metrics.fulfillmentHealth} suffix="%" note="Share of hubs reporting online" />
      </div>
      <div className="dash-two">
        <section className="card-ops dash-card capacity-card">
          <div className="capacity-card-heading"><div><span className="mono-label">HUB CAPACITY</span><h3>Network utilization</h3></div><strong className="capacity-total">{networkUtilization}%</strong></div>
          <div className="capacity-meter-list">{warehouses.map((hub) => {
            const percent = capacityPercent(hub.capacity)
            return <div className="capacity-meter-row" key={hub.id}>
              <div className="capacity-meter-meta"><span>{hub.name}</span><span className="mono">{percent.toFixed(0)}%</span></div>
              <div className="capacity-meter-track"><span style={{ width: `${percent}%` }} /></div>
            </div>
          })}</div>
          <p className="ops-copy capacity-footnote">Capacity values normalized from the source hub records; hub availability is shown separately.</p>
        </section>
        <section className="card-ops dash-card">
          <div className="drawer-head"><div><span className="mono-label">RECORDED EVENT TELEMETRY</span><h3>Order activity</h3></div><span className="mono-label">{history.length} samples</span></div>
          {history.length > 0
            ? <div style={{ height: 270 }}><ResponsiveContainer><AreaChart data={history}><defs><linearGradient id="velocityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--hex-c84b11)" stopOpacity={.22} /><stop offset="95%" stopColor="var(--hex-c84b11)" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(17,24,39,.08)" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="name" stroke="var(--hex-78716c)" tick={{ fontSize: 10 }} minTickGap={20} /><YAxis stroke="var(--hex-78716c)" tick={{ fontSize: 10 }} allowDecimals={false} /><Tooltip contentStyle={{ background: 'var(--hex-ffffff)', border: '1px solid var(--hex-e6e1d8)', borderRadius: 10, color: 'var(--hex-111827)' }} /><Area type="monotone" dataKey="orders" name="Active orders" stroke="var(--hex-c84b11)" strokeWidth={2} fill="url(#velocityFill)" /></AreaChart></ResponsiveContainer></div>
            : <div className="chart-empty-state">Chart samples will appear here when timestamped telemetry events are received.</div>}
        </section>
      </div>
      <section className="card-ops dash-card"><div className="drawer-head"><div><span className="mono-label">RECENT ACTIVITY</span><h3>Live orders &amp; SKU routing</h3></div><button className="small-button" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button></div><OrdersTable orders={orders.slice(0, 8)} routeOrder={(id) => request(() => api.post(`/orders/${id}/route`), 'Order route optimized.')} /></section>
    </>}

    {pathname === '/dashboard/topology' && <>
      <h1 className="ops-heading">Global network topology</h1><p className="ops-copy">Inspect node health and simulate supply chain conditions.</p>
      <div className="inline-actions" style={{ margin: '18px 0' }}>{[['port_congestion', 'Simulate port congestion'], ['demand_spike', 'Simulate demand spike'], ['auto_rebalance', 'AI auto-rebalance']].map(([scenario, label]) => <button key={scenario} className="small-button" onClick={() => request(() => api.post('/simulation/trigger', { scenario, params: simulation }), `${label} simulation started.`)}>{label}</button>)}</div>
      <div className="card-ops dash-card"><TopologyCanvas warehouses={warehouses} onSelect={setSelectedHub} /></div>
      {selectedHub && <div className="card-ops dash-card hub-inspector" style={{ marginTop: 12 }}><div className="drawer-head"><div><span className="mono-label">SELECTED HUB</span><h3>{selectedHub.name}</h3></div><button className="small-button" onClick={() => setSelectedHub(null)}>Close</button></div><p className="ops-copy">{selectedHub.id} · {selectedHub.status} · {capacityPercent(selectedHub.capacity).toFixed(0)}% capacity · {selectedHub.latency}ms recorded latency</p></div>}
      <div className="dash-grid"><StatCard title="PACKETS / SEC" value={metrics.packetsPerSec} /><StatCard title="AVG LATENCY" value={metrics.avgLatencyMs} suffix="ms" /><StatCard title="THREATS BLOCKED" value={metrics.threatsBlocked} /></div>
    </>}

    {pathname === '/dashboard/threats' && <>
      <div className="page-intro"><div><span className="mono-label">STOCK / EXCEPTIONS</span><h1 className="ops-heading">Inventory threats</h1><p className="ops-copy">Review reorder risk and warehouse signals calculated from the stock movement ledger.</p></div><span className="status-pill">{threats.length} recorded alerts</span></div>
      <div className="dash-grid">
        <StatCard title="EFFICIENCY SCORE" value={metrics.efficiencyScore} suffix=" pts" note="Workspace metric from API" />
        <StatCard title="DETECTION TIME" value={metrics.detectionTimeMs} suffix="ms" note="Recorded SRE metric" />
        <StatCard title="THREATS BLOCKED" value={metrics.threatsBlocked} note="Recorded counter" />
      </div>
      <div className="threat-filter-bar" role="group" aria-label="Filter inventory threats">
        {([{ value: 'ALL', label: `All (${threats.length})` }, { value: 'CRITICAL', label: `Critical (${threatCounts.CRITICAL})` }, { value: 'HIGH', label: `High (${threatCounts.HIGH})` }, { value: 'MEDIUM', label: `Medium (${threatCounts.MEDIUM})` }] as const).map((tab) => <button key={tab.value} type="button" className={`threat-filter-tab ${threatFilter === tab.value ? 'active' : ''}`} aria-pressed={threatFilter === tab.value} onClick={() => setThreatFilter(tab.value)}>{tab.label}</button>)}
      </div>
      {!['admin', 'operator'].includes(user?.role ?? '') ? <div className="card-ops dash-card danger-text">Administrator or operator access is required to view inventory threats.</div>
        : visibleThreats.length === 0 ? <div className="card-ops dash-card threat-empty-state">No {threatFilter === 'ALL' ? '' : threatFilter.toLowerCase() + ' '}inventory or warehouse threats currently meet the source thresholds.</div>
        : <div className="threat-list">{visibleThreats.map((threat) => <ThreatRow key={threat.id} threat={threat} onResolve={() => threat.product && request(
          () => api.post(`/inventory/restock/${threat.product!.id}`, { quantity: threat.recommendQty }, {
            headers: { 'Idempotency-Key': crypto.randomUUID() }
          }),
          `Draft purchase order requested for ${threat.product!.sku}.`,
          () => { void refreshThreats() }
        )} />)}</div>}
    </>}

    {pathname === '/dashboard/messages' && <>
      <div className="page-intro">
        <div><span className="mono-label">INBOX / SUPPORT</span><h1 className="ops-heading">Messages</h1><p className="ops-copy">Important updates for your operations workspace.</p></div>
        <span className="status-pill">1 priority update</span>
      </div>
      {!priorityMessageDismissed ? <section className="card-ops dash-card message-priority">
        <div className="message-priority-mark"><ShieldCheck size={19} /></div>
        <div className="message-priority-copy">
          <div className="drawer-head"><span className="mono-label">PRIORITY SUPPORT · ACCOUNT NOTICE</span><span className="status-pill status-warning">Action available</span></div>
          <h2>Priority support is ready for your workspace</h2>
          <p className="ops-copy">Your workspace has priority support access for the next 30 days. Contact your account administrator to review carrier coverage and service eligibility.</p>
          <div className="inline-actions"><button className="button ops-button" onClick={() => setPriorityMessageDismissed(true)}>Mark as resolved</button><button className="small-button" onClick={() => setPriorityMessageDismissed(true)}>Dismiss</button></div>
        </div>
      </section> : <section className="card-ops dash-card empty-messages"><h3>You're all caught up</h3><p className="ops-copy">No unread priority messages at the moment.</p><button className="small-button" onClick={() => setPriorityMessageDismissed(false)}>Restore message</button></section>}
      <section className="card-ops dash-card"><span className="mono-label">RECENT UPDATES</span><div className="message-list-row"><span className="message-bullet" /><div><strong>Network report is available</strong><p className="ops-copy">Your latest operations summary can be downloaded from Reports.</p></div><span className="mono-label">Today</span></div><div className="message-list-row"><span className="message-bullet muted-bullet" /><div><strong>Warehouse synchronization completed</strong><p className="ops-copy">All active nodes have reported their latest inventory snapshots.</p></div><span className="mono-label">Yesterday</span></div></section>
    </>}

    {pathname === '/dashboard/activity' && <>
      <div className="page-intro"><div><span className="mono-label">OBSERVABILITY / EVENTS</span><h1 className="ops-heading">Live system activity</h1><p className="ops-copy">Timestamped network and order events received by this browser session.</p></div><span className={`telemetry-state ${connected ? 'connected' : 'disconnected'}`}><i className="live-dot" /> {connected ? 'STREAM CONNECTED' : 'STREAM OFFLINE'}</span></div>
      <div className="dash-two">
        <section className="card-ops dash-card activity-chart-card">
          <div className="drawer-head"><div><span className="mono-label">NETWORK THROUGHPUT</span><h3>Packets per second</h3></div><strong className="activity-current-metric">{metrics.packetsPerSec.toLocaleString()}</strong></div>
          {history.length > 0
            ? <div style={{ height: 315 }}><ResponsiveContainer><AreaChart data={history}><defs><linearGradient id="activityThroughputFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--hex-c84b11)" stopOpacity={.2} /><stop offset="100%" stopColor="var(--hex-c84b11)" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(17,24,39,.08)" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="name" stroke="var(--hex-78716c)" tick={{ fontSize: 10 }} minTickGap={22} /><YAxis stroke="var(--hex-78716c)" tick={{ fontSize: 10 }} allowDecimals={false} /><Tooltip contentStyle={{ background: 'var(--hex-ffffff)', border: '1px solid var(--hex-e6e1d8)', borderRadius: 10, color: 'var(--hex-111827)' }} /><Area type="monotone" dataKey="throughput" name="Packets / sec" stroke="var(--hex-c84b11)" strokeWidth={2} fill="url(#activityThroughputFill)" /></AreaChart></ResponsiveContainer></div>
            : <div className="chart-empty-state">Waiting for timestamped telemetry samples. The graph will populate from received events.</div>}
        </section>
        <TerminalPanel events={events} />
      </div>
    </>}

    {pathname === '/dashboard/manage' && <>
      <div className="page-intro"><div><span className="mono-label">STOCK / REPLENISHMENT</span><h1 className="ops-heading">Inventory management</h1><p className="ops-copy">Manage the product records and replenishment orders available to this workspace.</p></div><button className="button button-dark" onClick={() => request(() => api.post('/simulation/trigger', { scenario: 'auto_rebalance', params: simulation }), 'AI rebalance simulation requested.')}><RefreshCw size={14} /> Run AI auto-rebalance</button></div>
      <div className="dash-grid">{[['Safety stock buffer %', 'safetyBuffer', 5, 80], ['Order surge multiplier', 'surgeMultiplier', 1, 10], ['Max carrier latency SLA', 'maxLatency', 10, 200]].map(([label, key, min, max]) => <div className="card-ops dash-card" key={key}><span className="mono-label">{label}</span><div className="guardrail-readout"><strong>{simulation[key as keyof typeof simulation]}{key === 'safetyBuffer' ? '%' : key === 'surgeMultiplier' ? 'x' : ' ms'}</strong></div><input className="field guardrail-slider" type="range" min={Number(min)} max={Number(max)} value={simulation[key as keyof typeof simulation]} onChange={(event) => setSimulation((current) => ({ ...current, [key]: Number(event.target.value) }))} /></div>)}</div>
      <div className="inventory-toolbar">
        <label className="inventory-search"><Search size={15} /><input className="field" placeholder="Filter by SKU, item, or hub…" value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} /></label>
        <label className="inventory-hub-filter"><Filter size={14} /><select className="field" value={inventoryHub} onChange={(event) => setInventoryHub(event.target.value)}><option value="ALL">All hubs</option>{warehouses.map((hub) => <option key={hub.id} value={hub.code || hub.id}>{hub.code || hub.id}</option>)}</select></label>
        <span className="mono-label">{inventoryProducts.length} / {products.length} SKUs</span>
      </div>
      <div className="card-ops dash-card table-wrap"><table className="dash-table inventory-table"><thead><tr><th>SKU / ITEM</th><th>STOCK</th><th>PRICE · PKR</th><th>WAREHOUSE</th><th>ADJUSTMENT REASON</th><th>ACTIONS</th></tr></thead><tbody>{inventoryProducts.map((product) => <tr key={product.id}><td><code className="sku-code">{product.sku}</code><div className="inventory-product-name">{product.name}</div></td><td><input aria-label={`Stock for ${product.sku}`} className="field inventory-cell-input" type="number" min="0" defaultValue={product.stock} id={`stock-${product.id}`} /></td><td><input aria-label={`Price for ${product.sku}`} className="field inventory-cell-input price-cell" type="number" min="0" step="1" defaultValue={product.priceExGstPkr ?? product.price} id={`price-${product.id}`} /></td><td><span className="hub-code-pill">{product.warehouse_hub}</span></td><td><select aria-label={`Adjustment reason for ${product.sku}`} className="field inventory-cell-input reason-select" defaultValue="cycle_count" id={`reason-${product.id}`}><option value="cycle_count">cycle_count</option><option value="damaged_stock">damaged_stock</option><option value="restock_receipt">restock_receipt</option><option value="audit_correction">audit_correction</option></select></td><td><button className="small-button" onClick={() => { const stock = Number((document.getElementById(`stock-${product.id}`) as HTMLInputElement).value); const price = Number((document.getElementById(`price-${product.id}`) as HTMLInputElement).value); const reason = (document.getElementById(`reason-${product.id}`) as HTMLSelectElement).value; const idempotencyKey = crypto.randomUUID(); void request(() => api.patch(`/inventory/${product.id}`, { stock, price, reason }, { headers: { 'Idempotency-Key': idempotencyKey } }), `${product.sku} inventory updated.`) }}>Save</button></td></tr>)}</tbody></table>{inventoryProducts.length === 0 && <p className="ops-copy inventory-empty">No SKU records match this search and hub filter.</p>}</div>
      <section style={{ marginTop: 28 }}>
        <div className="drawer-head"><div><h2 className="ops-heading" style={{ fontSize: 19 }}>Purchase orders</h2><p className="ops-copy">Draft, approve, ship and receive replenishment orders. Inventory changes only on receipt.</p></div><span className="status-pill">{purchaseOrders.length} records</span></div>
        <div className="card-ops dash-card table-wrap" style={{ marginTop: 12 }}>
          <table className="dash-table"><thead><tr><th>PO / Supplier</th><th>Lines</th><th>Hub</th><th>Total</th><th>Status</th><th>Next action</th></tr></thead>
            <tbody>{purchaseOrders.map((po) => {
              const nextStatus = po.status === 'draft' ? 'approved' : po.status === 'approved' ? 'shipped' : po.status === 'shipped' ? 'received' : null
              const adminApprovalNeeded = po.status === 'draft' && po.totalPkr > 2000000 && user?.role !== 'admin'
              return <tr key={po.id}>
                <td><strong>{po.code}</strong><div className="ops-muted">{po.supplierName || po.supplierId}</div></td>
                <td>{po.lines.map((line) => `${line.sku} × ${line.qty}`).join(', ')}</td>
                <td>{po.hubCode}</td>
                <td className="mono">{new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(po.totalPkr)}</td>
                <td><span className={purchaseStatusClass(po.status)}>{po.status.toUpperCase()}</span></td>
                <td>{nextStatus ? <button className="small-button" disabled={adminApprovalNeeded} title={adminApprovalNeeded ? 'Administrator approval is required above Rs 2,000,000' : undefined} onClick={() => void request(
                  () => api.patch(`/purchase-orders/${po.id}/status`, { status: nextStatus }, { headers: { 'Idempotency-Key': crypto.randomUUID() } }),
                  nextStatus === 'received' ? `${po.code} received; stock ledger updated.` : `${po.code} marked ${nextStatus}.`,
                  () => { void refreshPurchaseOrders() }
                )}>{adminApprovalNeeded ? 'Admin approval required' : nextStatus === 'received' ? 'Receive goods' : nextStatus === 'shipped' ? 'Mark shipped' : 'Approve'}</button> : <span className="ops-muted">Complete</span>}</td>
              </tr>
            })}</tbody>
          </table>
          {purchaseOrders.length === 0 && <p className="ops-muted">No purchase orders yet. Create a draft from an inventory threat recommendation.</p>}
        </div>
      </section>
    </>}

    {pathname === '/dashboard/rewards' && <>
      <div className="page-intro"><div><span className="mono-label">PROGRAM / EFFICIENCY</span><h1 className="ops-heading">VeloSupply program</h1><p className="ops-copy">Recognition for the decisions that keep your network moving.</p></div><span className="status-pill">Active member</span></div>
      <section className="rewards-hero">
        <div className="rewards-hero-copy"><span className="mono-label">YOUR NETWORK SCORE</span><h2>{metrics.efficiencyScore.toLocaleString()} <span>/ 1,000 points</span></h2><p>Points reflect replenishment, routing and resilience activity across your workspace.</p><div className="rewards-progress"><span style={{ width: `${Math.min(metrics.efficiencyScore / 10, 100)}%` }} /></div><div className="rewards-progress-meta"><span>{Math.min(metrics.efficiencyScore, 1000).toLocaleString()} points earned</span><span>{Math.max(0, 1000 - metrics.efficiencyScore).toLocaleString()} to next tier</span></div></div>
        <div className="rewards-tier"><span className="mono-label">CURRENT TIER</span><strong>{metrics.efficiencyScore >= 800 ? 'Momentum' : metrics.efficiencyScore >= 500 ? 'Connected' : 'Foundation'}</strong><small>{metrics.efficiencyScore >= 800 ? 'Priority network status' : metrics.efficiencyScore >= 500 ? 'Growing network status' : 'Member network status'}</small></div>
      </section>

      <div className="rewards-section-heading"><div><span className="mono-label">AVAILABLE BENEFITS</span><h2>Offers for your workspace</h2></div><span className="ops-copy">{rewardOffers.length} current offers</span></div>
      <div className="rewards-offer-grid">{rewardOffers.map((offer) => {
        const claimed = rewardClaims.some((claim) => claim.offerId === offer.id)
        const eligible = metrics.efficiencyScore >= offer.minimumScore
        return <article className="card-ops rewards-offer-card" key={offer.id}>
          <div className="rewards-offer-top"><span className="rewards-offer-icon"><ShieldCheck size={17} /></span><span className="mono-label">{offer.points} POINTS</span></div>
          <h3>{offer.title}</h3><p className="ops-copy">{offer.description}</p>
          <div className="rewards-offer-footer"><span className={eligible ? 'reward-eligible' : 'reward-locked'}>{claimed ? 'Claimed' : eligible ? 'Available to claim' : `Unlock at ${offer.minimumScore} pts`}</span>
            <button className="small-button" disabled={claimed || !eligible} onClick={() => {
              void request(() => api.post(`/rewards/${offer.id}/claim`), `${offer.title} added to your account.`, () => {
                api.get<{ offers: typeof rewardOffers; claims: typeof rewardClaims }>('/rewards').then(({ data }) => { setRewardOffers(data.offers); setRewardClaims(data.claims) })
              })
            }}>{claimed ? 'Claimed' : 'Claim offer'}</button>
          </div>
        </article>
      })}</div>

      <div className="dash-two rewards-lower-grid">
        <section className="card-ops dash-card"><div className="rewards-section-heading compact"><div><span className="mono-label">TIER BENEFITS</span><h2>Unlocked for your team</h2></div></div>
          <div className="reward-benefit-row"><ShieldCheck size={17} /><div><strong>Priority carrier allocation</strong><p className="ops-copy">Expedited capacity during regional demand peaks</p></div><span className="status-pill">Included</span></div>
          <div className="reward-benefit-row"><Boxes size={17} /><div><strong>Supplier early access</strong><p className="ops-copy">Preferred replenishment windows from partners</p></div><span className="status-pill">Included</span></div>
          <div className="reward-benefit-row"><Truck size={17} /><div><strong>Resilience insights</strong><p className="ops-copy">Advanced inventory and warehouse risk analytics</p></div><span className="status-pill">Included</span></div>
        </section>
        <section className="card-ops dash-card"><div className="rewards-section-heading compact"><div><span className="mono-label">ACCOUNT HISTORY</span><h2>Recent claims</h2></div></div>
          {rewardClaims.length ? rewardClaims.slice().sort((a,b) => b.claimedAt.localeCompare(a.claimedAt)).slice(0,5).map((claim) => <div className="reward-history-row" key={claim.id}><span><strong>{claim.title}</strong><small>{new Date(claim.claimedAt).toLocaleDateString()}</small></span><span className="mono">+{claim.points} pts</span></div>) : <p className="ops-copy rewards-history-empty">Offers you claim for this account will appear here.</p>}
        </section>
      </div>
    </>}

    {pathname === '/dashboard/reports' && <>
      <div className="drawer-head"><div><span className="mono-label">ANALYTICS / SUMMARY</span><h1 className="ops-heading">Operations reports</h1><p className="ops-copy">A summary of recorded fulfillment, routing and inventory data.</p></div><button className="button button-outline" onClick={exportCsv}><Download size={14} /> Export CSV audit report</button></div>
      <div className="dash-grid"><StatCard title="FULFILLMENT HEALTH" value={metrics.fulfillmentHealth} suffix="%" note="Current API metric" /><StatCard title="AVERAGE ROUTING LATENCY" value={metrics.avgLatencyMs} suffix="ms" note="Recorded hub latency" /><StatCard title="ACTIVE ORDERS" value={metrics.activeOrders} note="Orders not yet closed" /></div>
      <div className="dash-two">
        <div className="card-ops dash-card"><span className="mono-label">CATEGORY INVENTORY CAPACITY</span>{categories.map(({ category, units }, index) => { const percent = Math.round((units / maxCategoryUnits) * 100); return <div key={category} className="report-capacity-row"><div className="drawer-head"><span>{category}</span><span className="mono">{units.toLocaleString()} units</span></div><div className="report-capacity-track"><span style={{ width: `${percent}%`, background: palette[index % palette.length] }} /></div></div> })}</div>
        <div className="card-ops dash-card executive-summary-card"><div><span className="mono-label">EXECUTIVE SUMMARY</span><h3>Distributed by design.</h3><p className="ops-copy">The current workspace catalogue contains {products.length} product records across {warehouses.length} hub records. {productsAtRisk.length} products currently meet the inventory attention thresholds. Fulfillment health is {metrics.fulfillmentHealth}% from the backend health metric.</p></div><div className="executive-summary-footer"><Database size={15} /><span>Source: stored product, hub and order records</span></div></div>
      </div>
    </>}

    {pathname === '/dashboard/account' && <AccountPanel />}

    {pathname === '/dashboard/admin' && <>
      <h1 className="ops-heading">User access management</h1><p className="ops-copy">Manage team roles and account access.</p>
      {user?.role !== 'admin' ? <div role="alert" className="card-ops dash-card danger-text">Administrator privileges are required to view users.</div> : <div className="card-ops dash-card table-wrap"><div style={{ maxWidth: 350, marginBottom: 16 }}><input className="field" placeholder="Search users…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><table className="dash-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>{users.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(search.toLowerCase())).map((item) => <UserRow key={item.id} account={item} isSelf={item.id === user.id} onRole={(role) => request(() => api.patch(`/admin/users/${item.id}`, { role }), `${item.name}'s role updated.`, () => api.get<User[]>('/admin/users').then(({ data }) => setUsers(data)))} onDelete={() => request(() => api.delete(`/admin/users/${item.id}`), `${item.name}'s account deleted.`, () => api.get<User[]>('/admin/users').then(({ data }) => setUsers(data)))} />)}</tbody></table></div>}
    </>}
  </main>
}

function OrdersTable({ orders, routeOrder }: { orders: Order[]; routeOrder: (id: string) => void }) {
  return <div className="table-wrap"><table className="dash-table"><thead><tr><th>Order</th><th>Customer</th><th>Fulfillment</th><th>Status</th><th>Total</th><th>Action</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td className="mono">{order.id}</td><td>{order.customerName}<div className="ops-muted">{order.shippingRegion}</div></td><td>{order.warehouse_hub ?? 'Routing'}</td><td><span className={orderStatusClass(order.status)}>{order.status}</span></td><td className="mono">{new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(order.total ?? order.price?.totalPkr ?? 0)}</td><td><button className="small-button" onClick={() => routeOrder(order.id)}>Auto-route</button></td></tr>)}</tbody></table>{orders.length === 0 && <p className="ops-copy">No orders are available.</p>}</div>
}

function UserRow({ account, isSelf, onRole, onDelete }: { account: User; isSelf: boolean; onRole: (role: UserRole) => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return <tr><td>{account.name}</td><td>{account.email}</td><td><select className="field" value={account.role} onChange={(event) => onRole(event.target.value as UserRole)} style={{ width: 125, padding: 8 }}><option value="admin">admin</option><option value="operator">operator</option><option value="buyer">buyer</option><option value="deliverer">deliverer</option></select></td><td>{isSelf ? <span className="ops-muted">Current user</span> : confirm ? <span className="inline-actions"><button className="small-button danger-text" onClick={onDelete}>Confirm delete</button><button className="small-button" onClick={() => setConfirm(false)}>Cancel</button></span> : <button className="small-button" onClick={() => setConfirm(true)}>Delete</button>}</td></tr>
}

function AccountPanel() {
  const [copied, setCopied] = useState(false)
  const [test, setTest] = useState('')
  const [testing, setTesting] = useState(false)
  const token = useAppStore((state) => state.token)
  const user = useAppStore((state) => state.user)
  const endpoint = `${window.location.origin}/api`
  const testConnection = async () => {
    setTesting(true)
    const start = performance.now()
    try {
      const response = await api.get('/health')
      const elapsed = Math.round(performance.now() - start)
      setTest(`${response.status} OK · ${elapsed}ms`)
    } catch (reason) {
      setTest(errorMessage(reason))
    } finally {
      setTesting(false)
    }
  }
  const copyEndpoint = async () => {
    try {
      await navigator.clipboard.writeText(endpoint)
      setCopied(true)
    } catch (reason) {
      setTest(errorMessage(reason))
    }
  }
  return <>
    <div className="page-intro"><div><span className="mono-label">WORKSPACE / SETTINGS</span><h1 className="ops-heading">Account &amp; system</h1><p className="ops-copy">Connection configuration, operator identity and session controls.</p></div></div>
    <div className="dash-two">
      <section className="card-ops dash-card account-panel-card">
        <div className="drawer-head"><span className="mono-label">API ENDPOINT</span><span className="status-pill">LOCAL API</span></div>
        <div className="ops-form-row account-endpoint-group"><input className="field mono account-endpoint-input" readOnly value={endpoint} /><button className="small-button" onClick={() => void copyEndpoint()}><Copy size={14} /> {copied ? 'Copied ✓' : 'Copy'}</button></div>
        <button className="button button-outline account-test-button" disabled={testing} onClick={() => void testConnection()}>{testing ? 'Testing…' : 'Test backend connection'}</button>
        {test && <p className={`account-test-result ${test.includes('OK') ? 'success-text' : 'danger-text'}`} role="status">{test}</p>}
      </section>
      <section className="card-ops dash-card account-panel-card">
        <div className="drawer-head"><span className="mono-label">ACTIVE SESSION</span><span className="mono-label">SIGNED BEARER TOKEN</span></div>
        <div className="account-session-strip"><span className="account-session-avatar">{(user?.name || 'VS').split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase()}</span><span><strong>{user?.name || 'Workspace user'}</strong><small>{user?.role === 'admin' ? 'Administrator' : 'Operations team'} · VeloSupply workspace</small></span><span className="status-pill status-positive">ACTIVE</span></div>
        <p className="ops-copy account-session-copy">Your session is authenticated with a signed bearer token. API requests use the current account role for server-side authorization.</p>
        {user?.role === 'admin' && <Link className="account-invitation-link" to="/dashboard/access"><ShieldCheck size={15} /> Manage invitation keys <span>Open</span></Link>}
        <button className="button button-outline account-signout" onClick={() => { useAppStore.getState().logout(); window.location.assign('/login') }}>Sign out of all activity</button>
        <p className="ops-muted account-session-token-note">{token ? 'Session token present in this browser.' : 'No active session token.'}</p>
      </section>
    </div>
  </>
}
