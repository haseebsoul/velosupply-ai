import { FormEvent, useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, Boxes, CircleDot, Network, ShieldCheck, PackageCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { EditorialNavbar } from '../components/storefront/EditorialNavbar'
import { CartDrawer } from '../components/storefront/CartDrawer'
import { ProductCard } from '../components/storefront/ProductCard'
import { RoiCalculator } from '../components/storefront/RoiCalculator'
import { useWebSocket } from '../lib/useWebSocket'
import { api, errorMessage } from '../lib/apiClient'
import type { Metrics, Product, TelemetryEvent } from '../types'

const newsletterSchema = z.string().email('Enter a valid email address')
const steps = [
  ['01', 'Connect product and stock records', 'Bring catalog, inventory and warehouse records into one workspace.'],
  ['02', 'Coordinate fulfillment workflows', 'Review hub status, orders and operational events from a shared console.'],
  ['03', 'Plan replenishment with context', 'Use stock movement history and reorder signals to prepare purchase orders.']
]
const capabilities = [
  { title: 'Catalog & inventory', copy: 'Search the available product records, stock levels and hub assignments.', icon: Boxes },
  { title: 'Warehouse network', copy: 'Review the warehouse records and their reported status and capacity.', icon: Network },
  { title: 'Operations workspace', copy: 'Work with orders, purchase orders, alerts, reports and account access.', icon: ShieldCheck }
]
const money = new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })

type ApiHealth = { status?: string; dataMode?: 'demo' | 'production' | 'unclassified' | string; storage?: string }

export function LandingPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [apiReachable, setApiReachable] = useState<boolean | null>(null)
  const [newsletterMessage, setNewsletterMessage] = useState('')
  const [newsletterBusy, setNewsletterBusy] = useState(false)
  const { events } = useWebSocket()

  useEffect(() => {
    let active = true
    api.get<Metrics>('/metrics').then(({ data }) => {
      if (active) setMetrics(data)
    }).catch(() => undefined)
    api.get<Product[]>('/products').then(({ data }) => {
      if (active) setProducts(Array.isArray(data) ? data.slice(0, 6) : [])
    }).catch(() => undefined)
    api.get<ApiHealth>('/health').then(({ data }) => {
      if (active) {
        setHealth(data)
        setApiReachable(true)
      }
    }).catch(() => {
      if (active) setApiReachable(false)
    })
    return () => { active = false }
  }, [])

  const latest = useMemo(() => [...events].reverse()
    .filter((event: TelemetryEvent) => Boolean(event.message || event.type))
    .slice(0, 4), [events])
  const hubs = metrics?.hubCapacities ?? []
  const dataModeLabel = health?.dataMode === 'demo'
    ? 'SYNTHETIC DEMO DATA'
    : health?.dataMode === 'production'
      ? 'PRODUCTION STORAGE MODE'
      : health?.dataMode === 'unclassified'
        ? 'DATA MODE NEEDS REVIEW'
        : health ? 'DATA MODE NOT REPORTED' : 'CHECKING DATA MODE'
  const fulfillmentHealth = metrics ? Math.min(100, Math.max(0, Number(metrics.fulfillmentHealth) || 0)) : 0

  const subscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const parsed = newsletterSchema.safeParse(form.get('email'))
    if (!parsed.success) {
      setNewsletterMessage(parsed.error.issues[0]?.message ?? 'Enter a valid email address')
      return
    }
    setNewsletterBusy(true)
    try {
      await api.post('/newsletter', { email: parsed.data })
      setNewsletterMessage('You are on the list.')
      formElement.reset()
    } catch (reason) {
      setNewsletterMessage(errorMessage(reason))
    } finally {
      setNewsletterBusy(false)
    }
  }

  return <div className="editorial">
    <EditorialNavbar />
    <main>
      <section className="wrap hero" id="platform">
        <div>
          <span className="eyebrow">Autonomous commerce infrastructure</span>
          <h1>The supply chain workspace that keeps <em className="serif-italic">work in motion.</em></h1>
          <p className="hero-copy">Inventory records, warehouse visibility and fulfillment workflows—brought together in one clear operating view.</p>
          <div className="hero-actions">
            <Link className="button button-dark" to="/store">Browse hardware store <ArrowRight size={16} /></Link>
            <Link className="button button-outline" to="/dashboard">Open operations workspace <ArrowUpRight size={15} /></Link>
          </div>
          <div className="social-proof">CATALOG · STOCK · HUBS · ORDERS · REPORTS</div>
        </div>

        <div className="telemetry-preview">
          <div className="preview-top">
            <span className="mono-label">WORKSPACE SNAPSHOT</span>
            <span className={`workspace-api-state ${apiReachable ? 'available' : apiReachable === false ? 'unavailable' : 'checking'}`}><i className="live-dot" /> {apiReachable ? 'API REACHABLE' : apiReachable === false ? 'API UNAVAILABLE' : 'CHECKING API'}</span>
          </div>
          <div className="workspace-data-mode">{dataModeLabel}</div>
          <div className="preview-metrics">
            <div className="preview-metric"><span className="mono-label">24H GMV · PKR</span><strong>{metrics ? money.format(metrics.gmv24h) : '—'}</strong><small>Recorded order value, trailing 24 hours</small></div>
            <div className="preview-metric"><span className="mono-label">ACTIVE ORDERS</span><strong>{metrics ? metrics.activeOrders.toLocaleString() : '—'}</strong><small>Orders not yet closed</small></div>
          </div>
          <div className="workspace-capacity-heading"><span className="mono-label">HUBS REPORTING ONLINE</span><strong>{metrics ? `${metrics.fulfillmentHealth}%` : '—'}</strong></div>
          <div className="bar-line"><span style={{ width: `${fulfillmentHealth}%` }} /></div>
          <div className="workspace-hub-list">
            {hubs.length ? hubs.slice(0, 6).map((hub) => {
              const capacity = Math.min(100, Math.max(0, Number(hub.capacity) / 100 || 0))
              return <div className="workspace-hub-row" key={hub.name}>
                <span><CircleDot size={11} /> {hub.name}</span><strong>{capacity.toFixed(0)}% capacity</strong>
              </div>
            }) : <p className="workspace-empty">Hub metrics will appear when the API returns warehouse capacity records.</p>}
          </div>
        </div>
      </section>

      <div className="marquee"><div className="marquee-inner">{['Inventory ledger','Warehouse routing','Order management','Purchase orders','System activity','Operations reporting'].map((item) => <span key={item}>{item}</span>)}</div></div>

      <section className="wrap section">
        <span className="eyebrow">One connected operating system</span>
        <h2 className="section-title">Bring every operational signal into view.</h2>
        <div className="workflow-grid">
          {capabilities.map(({ title, copy, icon: Icon }) => <article className="workflow-card" key={title}>
            <span className="workflow-number">VELOSUPPLY / WORKSPACE</span>
            <div className="workflow-icon"><Icon size={20} /></div>
            <h3>{title}</h3><p className="muted">{copy}</p>
          </article>)}
        </div>
      </section>

      <section className="wrap section" id="catalog">
        <span className="eyebrow">Warehouse-connected hardware</span>
        <h2 className="section-title">Browse the current catalog.</h2>
        <p className="muted">Product availability and prices are displayed from the catalog API. The source environment identifies demo data where applicable.</p>
        {products.length
          ? <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div>
          : <div className="catalog-empty"><PackageCheck size={20} /><p>Catalog records will appear here when the product API is available.</p></div>}
        <div style={{ textAlign: 'center', marginTop: 28 }}><Link className="button button-outline" to="/store">Explore the full catalog <ArrowRight size={15} /></Link></div>
      </section>

      <section className="wrap section">
        <span className="eyebrow">From reactive to coordinated</span>
        <h2 className="section-title">Make the operating picture easier to act on.</h2>
        <div className="compare">
          <article className="compare-card">
            <div className="mono-label">FRAGMENTED WORKFLOWS</div>
            <div className="compare-value">Disconnected</div>
            <p>Inventory, orders and warehouse context split across separate records and tools.</p>
          </article>
          <article className="compare-card featured">
            <div className="mono-label" style={{ color: 'var(--accent-ops-lime)' }}>VELOSUPPLY WORKSPACE</div>
            <div className="compare-value">Connected</div>
            <p>One place to inspect catalog, stock, fulfillment, alerts and system activity.</p>
          </article>
        </div>
        <div style={{ marginTop: 15 }}><Link className="button button-dark" to="/dashboard">Explore the workspace <ArrowRight size={14} /></Link></div>
      </section>

      <section className="wrap section" id="telemetry">
        <div className="telemetry-feature">
          <div>
            <span className="mono-label">ACTIVITY / EVENT FEED</span>
            <h2 className="section-title">See what the workspace has recorded.</h2>
            <p className="muted">The event panel reflects telemetry received by this browser session. It does not imply packet inspection or external threat detection.</p>
            <Link className="button button-dark" to="/dashboard/activity">Open activity <ArrowUpRight size={15} /></Link>
          </div>
          <div className="telemetry-feed">
            <div className="telemetry-feed-heading"><span className="mono-label">RECENT EVENTS</span><span className="mono-label">{events.length} BUFFERED</span></div>
            {latest.length ? latest.map((event, index) => <div className="log-line" key={`${event.timestamp ?? event.type}-${index}`}>
              <span className="telemetry-event-time">{event.timestamp ? new Date(event.timestamp).toLocaleTimeString('en-PK') : 'Timestamp unavailable'}</span>
              <span>{event.message ?? event.type}</span>
            </div>) : <p className="workspace-empty">No telemetry events have been received in this session yet.</p>}
          </div>
        </div>
      </section>

      <section className="wrap section" id="pricing">
        <RoiCalculator />
        <div className="pricing-grid">
          {[
            ['Local demo', 'Explore', 'Review the catalog, sample inventory and role-based workspace.'],
            ['Pilot review', 'Discuss', 'Confirm real facilities, data sources and operational owners before a pilot.'],
            ['Enterprise review', 'Scope', 'Assess identity, integrations, access controls and deployment requirements.']
          ].map(([plan, action, copy]) => <article className="price-card" key={plan}>
            <span className="eyebrow">WORKSPACE / {plan.toUpperCase()}</span>
            <h3>{plan}</h3><div className="mono pricing-action">{action}</div>
            <p className="muted">{copy}</p>
            <Link className="button button-outline" to={plan === 'Local demo' ? '/register' : '/login'}>{plan === 'Local demo' ? 'Create account' : 'Workspace sign in'}</Link>
          </article>)}
        </div>
      </section>
    </main>

    <footer className="site-footer">
      <div className="wrap footer-row">
        <div><Link className="brand" to="/"><span className="brand-mark"><Boxes size={16} /></span> VeloSupply AI</Link><p className="muted">A connected workspace for supply chain operations.</p></div>
        <div style={{ display: 'grid', gap: 10 }}>
          <form onSubmit={subscribe} style={{ display: 'flex', gap: 8 }}><input aria-label="Newsletter email" name="email" type="email" required className="field" placeholder="Email for field notes" style={{ width: 220 }} /><button className="button button-dark" disabled={newsletterBusy}>{newsletterBusy ? 'Submitting…' : 'Subscribe'}</button></form>
          <small role="status" className="muted">{newsletterMessage}</small>
        </div>
        <div style={{ display: 'flex', gap: 20 }}><Link to="/store">Catalog</Link><Link to="/dashboard">Operations</Link><Link to="/login">Account</Link></div>
        <span className={apiReachable ? 'success-text' : apiReachable === false ? 'danger-text' : 'muted'}><i className="live-dot" style={{ marginRight: 8 }} />{apiReachable === null ? 'Checking API' : apiReachable ? 'API reachable' : 'API unavailable'}</span>
      </div>
    </footer>
    <CartDrawer />
  </div>
}
