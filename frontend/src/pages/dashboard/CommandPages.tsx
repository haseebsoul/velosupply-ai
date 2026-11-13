import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Copy, Download, RefreshCw, ShieldCheck, Truck } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { api, errorMessage } from '../../lib/apiClient'
import { useWebSocket } from '../../lib/useWebSocket'
import { useAppStore } from '../../store/useAppStore'
import type { Metrics, Order, Product, User, UserRole, Warehouse } from '../../types'
import { StatCard } from '../../components/dashboard/StatCard'
import { ThreatRow } from '../../components/dashboard/ThreatRow'
import { TerminalPanel } from '../../components/dashboard/TerminalPanel'
import { TopologyCanvas } from '../../components/dashboard/TopologyCanvas'

const palette = ['var(--accent-ops-lime)', '#968B80', '#6C665F', '#494641', '#2E2B27']
const initialMetrics: Metrics = { gmv24h: 0, activeOrders: 0, fulfillmentHealth: 0, packetsPerSec: 0, avgLatencyMs: 0, threatsBlocked: 0, detectionTimeMs: 0, efficiencyScore: 0, hubCapacities: [] }

export function CommandPages() {
  const { pathname } = useLocation()
  const { user } = useAppStore()
  const { events, latest, connected } = useWebSocket()
  const [metrics, setMetrics] = useState(initialMetrics)
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [rewardOffers, setRewardOffers] = useState<Array<{ id: string; title: string; description: string; points: number; minimumScore: number }>>([])
  const [rewardClaims, setRewardClaims] = useState<Array<{ id: string; offerId: string; title: string; points: number; claimedAt: string }>>([])
  const [selectedHub, setSelectedHub] = useState<Warehouse | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [priorityMessageDismissed, setPriorityMessageDismissed] = useState(false)
  const [simulation, setSimulation] = useState({ safetyBuffer: 20, surgeMultiplier: 2, maxLatency: 50 })
  const [search, setSearch] = useState('')
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
  const productsAtRisk = useMemo(() => products.filter((product) => product.stock <= product.reorder_threshold), [products])
  const history = events.slice(-20).map((event, index) => ({ name: index.toString(), orders: event.metrics?.activeOrders ?? Math.max(0, metrics.activeOrders + (index % 5) - 2), throughput: event.metrics?.packetsPerSec ?? metrics.packetsPerSec }))
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
      <div className="drawer-head"><div><h1 className="ops-heading">Good morning, {user?.name ?? 'Operator'}.</h1><p className="ops-copy">Your global fulfillment network is in view.</p></div><span className="mono-label"><i className="live-dot" /> {connected ? 'TELEMETRY SYNC ACTIVE' : 'RECONNECTING'}</span></div>
      <div className="dash-grid"><StatCard title="24H GROSS MERCHANDISE VALUE" value={metrics.gmv24h} prefix="$" note="Real-time order value" /><StatCard title="ACTIVE ORDERS IN TRANSIT" value={metrics.activeOrders} note="Across all fulfillment nodes" /><StatCard title="GLOBAL FULFILLMENT HEALTH" value={metrics.fulfillmentHealth} suffix="%" note="Network-wide SLA performance" /></div>
      <div className="dash-two"><section className="card-ops dash-card capacity-card">
          <div className="capacity-card-heading"><div><span className="mono-label">WAREHOUSE CAPACITY</span><h3>Network utilization</h3></div><strong className="capacity-total">{Math.round(warehouses.reduce((sum, hub) => sum + hub.capacity, 0) / Math.max(warehouses.length, 1))}%</strong></div>
          <div className="capacity-meter-list">{warehouses.map((hub) => <div className="capacity-meter-row" key={hub.id}>
            <div className="capacity-meter-meta"><span>{hub.name}</span><span className="mono">{hub.capacity}%</span></div>
            <div className="capacity-meter-track"><span style={{ width: `${hub.capacity}%` }} /></div>
          </div>)}</div>
          <p className="ops-copy capacity-footnote">Live allocation across {warehouses.length} fulfillment nodes.</p>
        </section>
        <section className="card-ops dash-card"><span className="mono-label">LIVE ORDER &amp; FULFILLMENT VELOCITY</span><div style={{ height: 270 }}><ResponsiveContainer><AreaChart data={history}><defs><linearGradient id="velocityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent-ops-lime)" stopOpacity={.3} /><stop offset="95%" stopColor="var(--accent-ops-lime)" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--border-ops)" vertical={false} /><XAxis dataKey="name" hide /><YAxis stroke="var(--text-ops-muted)" /><Tooltip contentStyle={{ background: 'var(--bg-ops-card)', border: '1px solid var(--border-ops)' }} /><Area type="monotone" dataKey="orders" stroke="var(--accent-ops-lime)" fill="url(#velocityFill)" /></AreaChart></ResponsiveContainer></div></section></div>
      <section className="card-ops dash-card"><div className="drawer-head"><div><span className="mono-label">RECENT ACTIVITY</span><h3>Live orders &amp; SKU routing</h3></div><button className="small-button" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button></div><OrdersTable orders={orders.slice(0, 8)} routeOrder={(id) => request(() => api.post(`/orders/${id}/route`), 'Order route optimized.')} /></section>
    </>}

    {pathname === '/dashboard/topology' && <>
      <h1 className="ops-heading">Global network topology</h1><p className="ops-copy">Inspect node health and simulate supply chain conditions.</p>
      <div className="inline-actions" style={{ margin: '18px 0' }}>{[['port_congestion', 'Simulate port congestion'], ['demand_spike', 'Simulate demand spike'], ['auto_rebalance', 'AI auto-rebalance']].map(([scenario, label]) => <button key={scenario} className="small-button" onClick={() => request(() => api.post('/simulation/trigger', { scenario, params: simulation }), `${label} simulation started.`)}>{label}</button>)}</div>
      <div className="card-ops dash-card"><TopologyCanvas warehouses={warehouses} onSelect={setSelectedHub} /></div>
      {selectedHub && <div className="card-ops dash-card" style={{ marginTop: 12 }}><div className="drawer-head"><h3>{selectedHub.name}</h3><button className="small-button" onClick={() => setSelectedHub(null)}>Close</button></div><p className="ops-copy">{selectedHub.id} · {selectedHub.status} · {selectedHub.capacity}% capacity · {selectedHub.latency}ms latency</p></div>}
      <div className="dash-grid"><StatCard title="PACKETS / SEC" value={metrics.packetsPerSec} /><StatCard title="AVG LATENCY" value={metrics.avgLatencyMs} suffix="ms" /><StatCard title="THREATS BLOCKED" value={metrics.threatsBlocked} /></div>
    </>}

    {pathname === '/dashboard/threats' && <>
      <h1 className="ops-heading">Inventory threats</h1><p className="ops-copy">Proactive actions protect service levels and prevent lost sales.</p>
      {productsAtRisk.length === 0 && warehouses.every((hub) => hub.status === 'online') && <div className="card-ops dash-card success-text">All inventory and fulfillment nodes are healthy.</div>}
      {productsAtRisk.map((product) => <ThreatRow key={product.id} product={product} onResolve={() => request(() => api.post(`/inventory/restock/${product.id}`), `${product.sku} replenishment purchase order executed.`)} />)}
      {warehouses.filter((hub) => hub.status !== 'online').map((hub) => <ThreatRow key={hub.id} hub={hub} />)}
      <div className="dash-grid"><StatCard title="AI EFFICIENCY SCORE" value={metrics.efficiencyScore} suffix=" pts" /><StatCard title="DETECTION TIME" value={metrics.detectionTimeMs} suffix="ms" /><StatCard title="THREATS BLOCKED" value={metrics.threatsBlocked} /></div>
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
      <h1 className="ops-heading">Live system activity</h1><p className="ops-copy">Event stream and regional throughput update as telemetry arrives.</p>
      <div className="dash-two"><section className="card-ops dash-card"><span className="mono-label">NETWORK THROUGHPUT · PACKETS / SEC</span><div style={{ height: 360 }}><ResponsiveContainer><AreaChart data={history}><CartesianGrid stroke="var(--border-ops)" /><XAxis dataKey="name" hide /><YAxis stroke="var(--text-ops-muted)" /><Tooltip /><Area dataKey="throughput" stroke="var(--accent-ops-lime)" fill="var(--accent-ops-lime)" fillOpacity={.1} /></AreaChart></ResponsiveContainer></div></section><TerminalPanel events={events} /></div>
    </>}

    {pathname === '/dashboard/manage' && <>
      <h1 className="ops-heading">Inventory management</h1><p className="ops-copy">Tune simulation guardrails and manage live SKU availability.</p>
      <div className="dash-grid">{[['Safety stock buffer %', 'safetyBuffer', 5, 80], ['Order surge multiplier', 'surgeMultiplier', 1, 10], ['Max carrier latency SLA', 'maxLatency', 10, 200]].map(([label, key, min, max]) => <div className="card-ops dash-card" key={key}><span className="mono-label">{label}</span><div className="ops-form-row" style={{ marginTop: 12 }}><input className="field" type="range" min={Number(min)} max={Number(max)} value={simulation[key as keyof typeof simulation]} onChange={(event) => setSimulation((current) => ({ ...current, [key]: Number(event.target.value) }))} /><span className="mono">{simulation[key as keyof typeof simulation]}</span></div></div>)}</div>
      <div className="card-ops dash-card table-wrap"><table className="dash-table"><thead><tr><th>SKU / Item</th><th>Stock</th><th>Price</th><th>Warehouse</th><th>Actions</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td>{product.sku}<div className="ops-muted">{product.name}</div></td><td><input aria-label={`Stock for ${product.sku}`} className="field" type="number" min="0" defaultValue={product.stock} style={{ width: 90, padding: 8 }} id={`stock-${product.id}`} /></td><td><input aria-label={`Price for ${product.sku}`} className="field" type="number" min="0" step="0.01" defaultValue={product.price} style={{ width: 100, padding: 8 }} id={`price-${product.id}`} /></td><td>{product.warehouse_hub}</td><td><button className="small-button" onClick={() => { const stock = Number((document.getElementById(`stock-${product.id}`) as HTMLInputElement).value); const price = Number((document.getElementById(`price-${product.id}`) as HTMLInputElement).value); void request(() => api.patch(`/inventory/${product.id}`, { stock, price }), `${product.sku} inventory updated.`) }}>Save</button></td></tr>)}</tbody></table></div>
      <div style={{ marginTop: 15 }}><button className="small-button" onClick={() => request(() => api.post('/simulation/trigger', { scenario: 'auto_rebalance', params: simulation }), 'AI network rebalance started.')}>Run AI auto-rebalance</button></div>
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
      <div className="drawer-head"><div><h1 className="ops-heading">Operations reports</h1><p className="ops-copy">Executive view of network SLAs and inventory allocation.</p></div><button className="small-button" onClick={exportCsv}><Download size={14} /> Export CSV audit report</button></div>
      <div className="dash-grid"><StatCard title="FULFILLMENT HEALTH" value={metrics.fulfillmentHealth} suffix="%" /><StatCard title="AVERAGE ROUTING LATENCY" value={metrics.avgLatencyMs} suffix="ms" /><StatCard title="ACTIVE ORDERS" value={metrics.activeOrders} /></div>
      <div className="dash-two"><div className="card-ops dash-card"><span className="mono-label">CATEGORY INVENTORY CAPACITY</span>{['Edge Gateways', 'Smart Sensors', 'Server Racks', 'Power Modules'].map((category, index) => { const count = products.filter((product) => product.category === category).reduce((sum, product) => sum + product.stock, 0); const percent = Math.min(100, count / 10); return <div key={category} style={{ marginTop: 18 }}><div className="drawer-head"><span>{category}</span><span className="mono">{count} units</span></div><div style={{ height: 6, marginTop: 8, background: 'var(--border-ops)', borderRadius: 9 }}><div style={{ width: `${percent}%`, height: '100%', borderRadius: 9, background: palette[index] }} /></div></div> })}</div><div className="card-ops dash-card"><span className="mono-label">EXECUTIVE SUMMARY</span><h3>Distributed by design.</h3><p className="ops-copy">VeloSupply currently tracks {products.length} active SKUs across {warehouses.length} global hubs. {productsAtRisk.length} items require replenishment attention, while network fulfillment health is {metrics.fulfillmentHealth}%.</p><div className="ops-copy"><Truck size={15} /> Orders include both historical and live commerce data.</div></div></div>
    </>}

    {pathname === '/dashboard/account' && <AccountPanel />}

    {pathname === '/dashboard/admin' && <>
      <h1 className="ops-heading">User access management</h1><p className="ops-copy">Manage team roles and account access.</p>
      {user?.role !== 'admin' ? <div role="alert" className="card-ops dash-card danger-text">Administrator privileges are required to view users.</div> : <div className="card-ops dash-card table-wrap"><div style={{ maxWidth: 350, marginBottom: 16 }}><input className="field" placeholder="Search users…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><table className="dash-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>{users.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(search.toLowerCase())).map((item) => <UserRow key={item.id} account={item} isSelf={item.id === user.id} onRole={(role) => request(() => api.patch(`/admin/users/${item.id}`, { role }), `${item.name}'s role updated.`, () => api.get<User[]>('/admin/users').then(({ data }) => setUsers(data)))} onDelete={() => request(() => api.delete(`/admin/users/${item.id}`), `${item.name}'s account deleted.`, () => api.get<User[]>('/admin/users').then(({ data }) => setUsers(data)))} />)}</tbody></table></div>}
    </>}
  </main>
}

function OrdersTable({ orders, routeOrder }: { orders: Order[]; routeOrder: (id: string) => void }) {
  return <div className="table-wrap"><table className="dash-table"><thead><tr><th>Order</th><th>Customer</th><th>Fulfillment</th><th>Status</th><th>Total</th><th>Action</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td className="mono">{order.id}</td><td>{order.customerName}<div className="ops-muted">{order.shippingRegion}</div></td><td>{order.warehouse_hub ?? 'Routing'}</td><td><span className="status-pill">{order.status}</span></td><td className="mono">${(order.total ?? 0).toLocaleString()}</td><td><button className="small-button" onClick={() => routeOrder(order.id)}>Auto-route</button></td></tr>)}</tbody></table>{orders.length === 0 && <p className="ops-copy">No orders are available.</p>}</div>
}

function UserRow({ account, isSelf, onRole, onDelete }: { account: User; isSelf: boolean; onRole: (role: UserRole) => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return <tr><td>{account.name}</td><td>{account.email}</td><td><select className="field" value={account.role} onChange={(event) => onRole(event.target.value as UserRole)} style={{ width: 125, padding: 8 }}><option value="admin">admin</option><option value="operator">operator</option><option value="user">user</option></select></td><td>{isSelf ? <span className="ops-muted">Current user</span> : confirm ? <span className="inline-actions"><button className="small-button danger-text" onClick={onDelete}>Confirm delete</button><button className="small-button" onClick={() => setConfirm(false)}>Cancel</button></span> : <button className="small-button" onClick={() => setConfirm(true)}>Delete</button>}</td></tr>
}

function AccountPanel() {
  const [copied, setCopied] = useState(false)
  const [test, setTest] = useState('')
  const [testing, setTesting] = useState(false)
  const token = useAppStore((state) => state.token)
  const testConnection = async () => {
    setTesting(true)
    const start = performance.now()
    try {
      await api.get('/health')
      setTest(`Backend healthy · ${Math.round(performance.now() - start)}ms round trip`)
    } catch (error) { setTest(errorMessage(error)) }
    finally { setTesting(false) }
  }
  return <>
    <h1 className="ops-heading">Account &amp; system</h1><p className="ops-copy">Connection configuration and session controls.</p>
    <div className="dash-two"><section className="card-ops dash-card"><span className="mono-label">API ENDPOINT</span><div className="ops-form-row" style={{ marginTop: 15 }}><input className="field mono" readOnly value={`${location.origin}/api`} /><button className="small-button" onClick={() => navigator.clipboard.writeText(`${location.origin}/api`).then(() => setCopied(true)).catch((error: unknown) => setTest(errorMessage(error)))}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</button></div><button className="small-button" style={{ marginTop: 16 }} disabled={testing} onClick={() => void testConnection()}>{testing ? 'Testing…' : 'Test backend & WS connection'}</button>{test && <p className="ops-copy">{test}</p>}</section>
      <section className="card-ops dash-card"><span className="mono-label">ACTIVE SESSION</span><p className="ops-copy">Authenticated session token is {token ? 'present' : 'not available'}. Your operations access is protected by a signed bearer token.</p><button className="small-button" onClick={() => { useAppStore.getState().logout(); window.location.assign('/login') }}>Sign out of all activity</button></section></div>
  </>
}
