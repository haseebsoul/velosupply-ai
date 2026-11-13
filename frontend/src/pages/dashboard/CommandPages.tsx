import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Copy, Download, RefreshCw, ShieldCheck, Truck, MessageSquareText } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { api, errorMessage } from '../../lib/apiClient'
import { useWebSocket } from '../../lib/useWebSocket'
import { useAppStore } from '../../store/useAppStore'
import type { Metrics, Order, Product, User, UserRole, Warehouse } from '../../types'
import { StatCard } from '../../components/dashboard/StatCard'
import { ThreatRow } from '../../components/dashboard/ThreatRow'
import { TerminalPanel } from '../../components/dashboard/TerminalPanel'
import { TopologyCanvas } from '../../components/dashboard/TopologyCanvas'

const palette = ['var(--accent-ops-lime)', 'var(--status-positive)', 'var(--status-warning)', 'var(--status-critical)', 'var(--text-ops-muted)']
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
  const [selectedHub, setSelectedHub] = useState<Warehouse | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [simulation, setSimulation] = useState({ safetyBuffer: 20, surgeMultiplier: 2, maxLatency: 50 })
  const [search, setSearch] = useState('')
  const [priorityDismissed, setPriorityDismissed] = useState(false)
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
    if (pathname === '/dashboard/admin' && user?.role === 'admin') api.get<User[]>('/admin/users').then(({ data }) => setUsers(data)).catch((reason: unknown) => setError(errorMessage(reason)))
  }, [pathname, user?.role])
  const productsAtRisk = useMemo(() => products.filter((product) => product.stock <= product.reorder_threshold), [products])
  const data = warehouses.map((hub) => ({ name: hub.id.replace('HUB-', ''), capacity: hub.capacity }))
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
      <div className="drawer-head"><div><h1 className="ops-heading">Operations overview</h1><p className="ops-copy">Orders, inventory and fulfillment health across your network</p></div><span className="mono-label"><i className="live-dot" /> {connected ? 'TELEMETRY SYNC ACTIVE' : 'RECONNECTING'}</span></div>
      <div className="dash-grid"><StatCard title="Gross merchandise value · 24h" value={metrics.gmv24h} prefix="$" note="Real-time order value" /><StatCard title="Active orders in transit" value={metrics.activeOrders} note="Across all fulfillment nodes" /><StatCard title="Global fulfillment health" value={metrics.fulfillmentHealth} suffix="%" note="Network-wide SLA performance" /></div>
      <div className="dash-two"><section className="card-ops dash-card"><span className="mono-label">Warehouse capacity allocation</span><div style={{ height: 245 }}><ResponsiveContainer><PieChart><Pie data={data} dataKey="capacity" nameKey="name" innerRadius={62} outerRadius={94} paddingAngle={4}>{data.map((entry, index) => <Cell key={entry.name} fill={palette[index % palette.length]} />)}</Pie><Tooltip contentStyle={{ background: 'var(--bg-ops-card)', border: '1px solid var(--border-ops)', color: 'white' }} /></PieChart></ResponsiveContainer></div>{warehouses.map((hub, i) => <span className="mono-label" key={hub.id} style={{ marginRight: 10, color: palette[i % palette.length] }}>{hub.id.replace('HUB-', '')} {hub.capacity}%</span>)}</section>
        <section className="card-ops dash-card"><span className="mono-label">Order and fulfillment velocity</span><div style={{ height: 270 }}><ResponsiveContainer><AreaChart data={history}><defs><linearGradient id="velocityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent-ops-lime)" stopOpacity={.3} /><stop offset="95%" stopColor="var(--accent-ops-lime)" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--border-ops)" vertical={false} /><XAxis dataKey="name" hide /><YAxis stroke="var(--text-ops-muted)" /><Tooltip contentStyle={{ background: 'var(--bg-ops-card)', border: '1px solid var(--border-ops)' }} /><Area type="monotone" dataKey="orders" stroke="var(--accent-ops-lime)" fill="url(#velocityFill)" /></AreaChart></ResponsiveContainer></div></section></div>
      <section className="card-ops dash-card"><div className="drawer-head"><div><span className="mono-label">Recent activity</span><h3>Live orders &amp; SKU routing</h3></div><button className="small-button" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button></div><OrdersTable orders={orders.slice(0, 8)} routeOrder={(id) => request(() => api.post(`/orders/${id}/route`), 'Order route optimized.')} /></section>
    </>}

    {pathname === '/dashboard/topology' && <>
      <h1 className="ops-heading">Global network topology</h1><p className="ops-copy">Inspect node health and simulate supply chain conditions.</p>
      <div className="inline-actions" style={{ margin: '18px 0' }}>{[['port_congestion', 'Simulate port congestion'], ['demand_spike', 'Simulate demand spike'], ['auto_rebalance', 'AI auto-rebalance']].map(([scenario, label]) => <button key={scenario} className="small-button" onClick={() => request(() => api.post('/simulation/trigger', { scenario, params: simulation }), `${label} simulation started.`)}>{label}</button>)}</div>
      <div className="card-ops dash-card"><TopologyCanvas warehouses={warehouses} onSelect={setSelectedHub} /></div>
      {selectedHub && <div className="card-ops dash-card" style={{ marginTop: 12 }}><div className="drawer-head"><h3>{selectedHub.name}</h3><button className="small-button" onClick={() => setSelectedHub(null)}>Close</button></div><p className="ops-copy">{selectedHub.id} · {selectedHub.status} · {selectedHub.capacity}% capacity · {selectedHub.latency}ms latency</p></div>}
      <div className="dash-grid"><StatCard title="Packets per second" value={metrics.packetsPerSec} /><StatCard title="Average latency" value={metrics.avgLatencyMs} suffix="ms" /><StatCard title="Threats blocked" value={metrics.threatsBlocked} /></div>
    </>}

    {pathname === '/dashboard/threats' && <>
      <h1 className="ops-heading">Inventory threats</h1><p className="ops-copy">Proactive actions protect service levels and prevent lost sales.</p>
      {productsAtRisk.length === 0 && warehouses.every((hub) => hub.status === 'online') && <div className="card-ops dash-card success-text">All inventory and fulfillment nodes are healthy.</div>}
      {productsAtRisk.map((product) => <ThreatRow key={product.id} product={product} onResolve={() => request(() => api.post(`/inventory/restock/${product.id}`), `${product.sku} replenishment purchase order executed.`)} />)}
      {warehouses.filter((hub) => hub.status !== 'online').map((hub) => <ThreatRow key={hub.id} hub={hub} />)}
      <div className="dash-grid"><StatCard title="Efficiency score" value={metrics.efficiencyScore} suffix=" pts" /><StatCard title="Detection time" value={metrics.detectionTimeMs} suffix="ms" /><StatCard title="Threats blocked" value={metrics.threatsBlocked} /></div>
    </>}

    {pathname === '/dashboard/activity' && <>
      <h1 className="ops-heading">Live system activity</h1><p className="ops-copy">Event stream and regional throughput update as telemetry arrives.</p>
      <div className="dash-two"><section className="card-ops dash-card"><span className="mono-label">NETWORK THROUGHPUT · Packets per second</span><div style={{ height: 360 }}><ResponsiveContainer><AreaChart data={history}><CartesianGrid stroke="var(--border-ops)" /><XAxis dataKey="name" hide /><YAxis stroke="var(--text-ops-muted)" /><Tooltip /><Area dataKey="throughput" stroke="var(--accent-ops-lime)" fill="var(--accent-ops-lime)" fillOpacity={.1} /></AreaChart></ResponsiveContainer></div></section><TerminalPanel events={events} /></div>
    </>}

    {pathname === '/dashboard/manage' && <>
      <h1 className="ops-heading">Inventory management</h1><p className="ops-copy">Tune simulation guardrails and manage live SKU availability.</p>
      <div className="dash-grid">{[['Safety stock buffer %', 'safetyBuffer', 5, 80], ['Order surge multiplier', 'surgeMultiplier', 1, 10], ['Max carrier latency SLA', 'maxLatency', 10, 200]].map(([label, key, min, max]) => <div className="card-ops dash-card" key={key}><span className="mono-label">{label}</span><div className="ops-form-row" style={{ marginTop: 12 }}><input className="field" type="range" min={Number(min)} max={Number(max)} value={simulation[key as keyof typeof simulation]} onChange={(event) => setSimulation((current) => ({ ...current, [key]: Number(event.target.value) }))} /><span className="mono">{simulation[key as keyof typeof simulation]}</span></div></div>)}</div>
      <div className="card-ops dash-card table-wrap"><table className="dash-table"><thead><tr><th>SKU / Item</th><th>Stock</th><th>Price</th><th>Warehouse</th><th>Actions</th></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td>{product.sku}<div className="ops-muted">{product.name}</div></td><td><input aria-label={`Stock for ${product.sku}`} className="field" type="number" min="0" defaultValue={product.stock} style={{ width: 90, padding: 8 }} id={`stock-${product.id}`} /></td><td><input aria-label={`Price for ${product.sku}`} className="field" type="number" min="0" step="0.01" defaultValue={product.price} style={{ width: 100, padding: 8 }} id={`price-${product.id}`} /></td><td>{product.warehouse_hub}</td><td><button className="small-button" onClick={() => { const stock = Number((document.getElementById(`stock-${product.id}`) as HTMLInputElement).value); const price = Number((document.getElementById(`price-${product.id}`) as HTMLInputElement).value); void request(() => api.patch(`/inventory/${product.id}`, { stock, price }), `${product.sku} inventory updated.`) }}>Save</button></td></tr>)}</tbody></table></div>
      <div style={{ marginTop: 15 }}><button className="small-button" onClick={() => request(() => api.post('/simulation/trigger', { scenario: 'auto_rebalance', params: simulation }), 'AI network rebalance started.')}>Run AI auto-rebalance</button></div>
    </>}

    {pathname === '/dashboard/rewards' && <>
      <div className="card-ops program-hero"><span className="mono-label">VeloSupply efficiency program</span><h1>Every smart move counts</h1><div className="mono" style={{ fontSize: 30 }}>{metrics.efficiencyScore} <span style={{ fontSize: 14 }}>/ 1,000 PTS</span></div><div className="program-progress"><div style={{ width: `${Math.min(metrics.efficiencyScore / 10, 100)}%` }} /></div></div>
      <h2>Unlocked network perks</h2><div className="dash-grid">{[['Priority carrier allocation', 'Expedited capacity during regional peaks'], ['Supplier early access', 'Preferred replenishment windows'], ['Resilience insights', 'Advanced predictive demand analytics']].map(([title, copy]) => <div className="card-ops dash-card" key={title}><ShieldCheck color="var(--accent-ops-lime)" /><h3>{title}</h3><p className="ops-copy">{copy}</p><span className="status-pill">UNLOCKED</span></div>)}</div>
      <div className="card-ops dash-card"><span className="mono-label">Points history</span><p className="ops-copy">AI restock POs and resilience actions add efficiency points to your account.</p></div>
    </>}

    {pathname === '/dashboard/reports' && <>
      <div className="drawer-head"><div><h1 className="ops-heading">Operations reports</h1><p className="ops-copy">Executive view of network SLAs and inventory allocation.</p></div><button className="small-button" onClick={exportCsv}><Download size={14} /> Export CSV audit report</button></div>
      <div className="dash-grid"><StatCard title="FULFILLMENT HEALTH" value={metrics.fulfillmentHealth} suffix="%" /><StatCard title="AVERAGE ROUTING LATENCY" value={metrics.avgLatencyMs} suffix="ms" /><StatCard title="ACTIVE ORDERS" value={metrics.activeOrders} /></div>
      <div className="dash-two"><div className="card-ops dash-card"><span className="mono-label">CATEGORY INVENTORY CAPACITY</span>{['Edge Gateways', 'Smart Sensors', 'Server Racks', 'Power Modules'].map((category, index) => { const count = products.filter((product) => product.category === category).reduce((sum, product) => sum + product.stock, 0); const percent = Math.min(100, count / 10); return <div key={category} style={{ marginTop: 18 }}><div className="drawer-head"><span>{category}</span><span className="mono">{count} units</span></div><div style={{ height: 6, marginTop: 8, background: 'var(--border-ops)', borderRadius: 9 }}><div style={{ width: `${percent}%`, height: '100%', borderRadius: 9, background: palette[index] }} /></div></div> })}</div><div className="card-ops dash-card"><span className="mono-label">EXECUTIVE SUMMARY</span><h3>Distributed by design.</h3><p className="ops-copy">VeloSupply currently tracks {products.length} active SKUs across {warehouses.length} global hubs. {productsAtRisk.length} items require replenishment attention, while network fulfillment health is {metrics.fulfillmentHealth}%.</p><div className="ops-copy"><Truck size={15} /> Orders include both historical and live commerce data.</div></div></div>
    </>}

    {pathname === '/dashboard/messages' && <>
      <div className="page-intro"><h1 className="ops-heading">Messages</h1><p className="ops-copy">System notices and support guidance for this workspace</p></div>
      {!priorityDismissed && <section className="card-ops priority-card">
        <div className="priority-card-head"><div className="priority-icon"><MessageSquareText size={18} /></div><div><span className="priority-kicker">Priority support</span><h2>Keep fulfilment issues easy to trace</h2></div></div>
        <p className="ops-copy">When reporting an order delay or warehouse issue, include the order reference and affected hub so the operations team can trace the route.</p>
        <div className="inline-actions"><button className="small-button" onClick={() => setPriorityDismissed(true)}>Dismiss</button><button className="small-button accent-button" onClick={() => setPriorityDismissed(true)}>Mark as read</button></div>
      </section>}
      <section className="card-ops dash-card message-history">
        <div className="section-heading"><div><h2>Recent system notices</h2><p className="ops-copy">Live events from the VeloSupply operations stream</p></div><span className="mono-label">{events.length} events</span></div>
        {events.slice(-8).reverse().map((event, index) => <div className="message-row" key={`${event.timestamp ?? event.type}-${index}`}>
          <span className={`event-marker ${event.level === 'CRITICAL' ? 'critical' : event.level === 'WARN' ? 'warning' : ''}`} />
          <div className="message-copy"><strong>{event.message ?? event.type}</strong><span className="ops-muted">{event.type} · {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'Just now'}</span></div>
        </div>)}
        {events.length === 0 && <p className="ops-copy">No system notices have arrived yet</p>}
      </section>
    </>}

    {pathname === '/dashboard/account' && <AccountPanel />}

    {pathname === '/dashboard/admin' && <>
      <h1 className="ops-heading">User access management</h1><p className="ops-copy">Manage team roles and account access.</p>
      {user?.role !== 'admin' ? <div role="alert" className="card-ops dash-card danger-text">Administrator privileges are required to view users.</div> : <>
      <AdminCreateForm onCreate={async (values) => {
        try {
          const { data } = await api.post<{ user: User }>('/admin/users', values)
          setUsers((current) => [data.user, ...current])
          setNotice('Stakeholder account created')
          setError('')
          return true
        } catch (reason) {
          setError(errorMessage(reason))
          return false
        }
      }} />
      <div className="card-ops dash-card table-wrap"><div style={{ maxWidth: 350, marginBottom: 16 }}><input className="field" placeholder="Search users…" value={search} onChange={(event) => setSearch(event.target.value)} /></div><table className="dash-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>{users.filter((item) => `${item.name} ${item.email}`.toLowerCase().includes(search.toLowerCase())).map((item) => <UserRow key={item.id} account={item} isSelf={item.id === user.id} onRole={(role) => request(() => api.patch(`/admin/users/${item.id}`, { role }), `${item.name}'s role updated.`, () => api.get<User[]>('/admin/users').then(({ data }) => setUsers(data)))} onDelete={() => request(() => api.delete(`/admin/users/${item.id}`), `${item.name}'s account deleted.`, () => api.get<User[]>('/admin/users').then(({ data }) => setUsers(data)))} />)}</tbody></table></div></>}
    </>}
  </main>
}

function OrdersTable({ orders, routeOrder }: { orders: Order[]; routeOrder: (id: string) => void }) {
  return <div className="table-wrap"><table className="dash-table"><thead><tr><th>Order</th><th>Customer</th><th>Fulfillment</th><th>Status</th><th>Total</th><th>Action</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td className="mono">{order.id}</td><td>{order.customerName}<div className="ops-muted">{order.shippingRegion}</div></td><td>{order.warehouse_hub ?? 'Routing'}</td><td><span className="status-pill">{order.status}</span></td><td className="mono">${(order.total ?? 0).toLocaleString()}</td><td><button className="small-button" onClick={() => routeOrder(order.id)}>Auto-route</button></td></tr>)}</tbody></table>{orders.length === 0 && <p className="ops-copy">No orders are available.</p>}</div>
}

function UserRow({ account, isSelf, onRole, onDelete }: { account: User; isSelf: boolean; onRole: (role: UserRole) => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return <tr><td>{account.name}</td><td>{account.email}</td><td><select className="field" value={account.role} onChange={(event) => onRole(event.target.value as UserRole)} style={{ width: 125, padding: 8 }}><option value="admin">Administrator</option><option value="operator">Operations</option><option value="user">Buyer</option></select></td><td>{isSelf ? <span className="ops-muted">Current user</span> : confirm ? <span className="inline-actions"><button className="small-button danger-text" onClick={onDelete}>Confirm delete</button><button className="small-button" onClick={() => setConfirm(false)}>Cancel</button></span> : <button className="small-button" onClick={() => setConfirm(true)}>Delete</button>}</td></tr>
}

type AdminUserValues = { name: string; email: string; password: string; role: UserRole }

function AdminCreateForm({ onCreate }: { onCreate: (values: AdminUserValues) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    setSaving(true)
    const created = await onCreate({ name, email, password, role })
    setSaving(false)
    if (created) {
      setName('')
      setEmail('')
      setPassword('')
      setRole('user')
      setOpen(false)
    } else {
      setFormError('The account could not be created. Check the details and try again')
    }
  }

  return <section className="card-ops dash-card admin-create">
    <div className="section-heading"><div><h2>Create stakeholder account</h2><p className="ops-copy">Add a buyer, operations partner or administrator</p></div><button className="small-button" type="button" onClick={() => setOpen((value) => !value)}>{open ? 'Close form' : 'Add account'}</button></div>
    {open && <form className="admin-create-form" onSubmit={submit}>
      <label className="form-field">Full name<input className="field" required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="form-field">Email address<input className="field" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="form-field">Temporary password<input className="field" type="password" required minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label className="form-field">Stakeholder type<select className="field" value={role} onChange={(event) => setRole(event.target.value as UserRole)}><option value="user">Buyer</option><option value="operator">Operations</option><option value="admin">Administrator</option></select></label>
      {formError && <p className="danger-text" role="alert">{formError}</p>}
      <button className="small-button accent-button" disabled={saving}>{saving ? 'Creating…' : 'Create account'}</button>
    </form>}
  </section>
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
