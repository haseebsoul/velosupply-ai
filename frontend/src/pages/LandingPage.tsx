import { FormEvent, useEffect, useState } from 'react'
import {
  ArrowRight, ArrowUpRight, Boxes, CircleDot, Network, Package, ShieldCheck,
  ShoppingBag, Truck, Warehouse, Router, Zap, Cpu
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { EditorialNavbar } from '../components/storefront/EditorialNavbar'
import { CartDrawer } from '../components/storefront/CartDrawer'
import { ProductCard } from '../components/storefront/ProductCard'
import { RoiCalculator } from '../components/storefront/RoiCalculator'
import { api, errorMessage } from '../lib/apiClient'
import type { Product } from '../types'

type PublicStats = {
  currency: 'PKR'
  dataMode: string
  unitsTracked: number
  activeOrders: number
  ordersFulfilledThisMonth: number
  onTimeDispatchRate: number | null
  warehouses: Array<{ code: string; name: string; city?: string; status: string; capacity: number | null }>
  activity: Array<{ id: string; message: string; at: string | null }>
}

const newsletterSchema = z.string().email('Enter a valid email address')
const stripItems: Array<{ label: string; className: string; icon: LucideIcon }> = [
  { label: 'Solar energy', className: 'strip-a', icon: Zap },
  { label: 'Power systems', className: 'strip-b', icon: Cpu },
  { label: 'Network hardware', className: 'strip-c', icon: Router },
  { label: 'Warehouse systems', className: 'strip-d', icon: Warehouse },
  { label: 'Industrial equipment', className: 'strip-e', icon: Boxes },
  { label: 'Secure logistics', className: 'strip-f', icon: ShieldCheck },
  { label: 'Connected commerce', className: 'strip-g', icon: Package },
  { label: 'Last-mile delivery', className: 'strip-h', icon: Truck }
]
const categoryItems: Array<{ name: string; detail: string; icon: LucideIcon }> = [
  { name: 'Industrial', detail: 'Power and infrastructure', icon: Warehouse },
  { name: 'Electronics', detail: 'Networking and computing', icon: Router },
  { name: 'Packaging', detail: 'Retail and fulfilment', icon: Package },
  { name: 'Logistics', detail: 'Warehouse and tracking', icon: Truck }
]
const cityHubs = [
  { code: 'HUB-KHI', city: 'Karachi', x: 232, y: 292 },
  { code: 'HUB-LHE', city: 'Lahore', x: 390, y: 130 },
  { code: 'HUB-ISB', city: 'Islamabad', x: 412, y: 88 },
  { code: 'HUB-FSD', city: 'Faisalabad', x: 350, y: 157 },
  { code: 'HUB-PEW', city: 'Peshawar', x: 333, y: 66 },
  { code: 'HUB-UET', city: 'Quetta', x: 154, y: 170 }
]
const plans = [
  { name: 'Starter', price: 'Rs 14,900', note: 'For a single operating hub', items: ['Live catalog and stock view', 'Order visibility', 'Core inventory alerts', 'Monthly operating report'] },
  { name: 'Growth', price: 'Rs 39,900', note: 'For teams coordinating multiple hubs', items: ['Everything in Starter', 'Multi-hub inventory control', 'Purchase order workflow', 'Reliability and audit reports'], featured: true },
  { name: 'Network', price: 'Rs 89,000', note: 'For established fulfilment networks', items: ['Everything in Growth', 'Advanced workspace controls', 'Operational runbooks', 'Priority onboarding'] }
]
const formatCount = (value?: number | null) => value === null || value === undefined ? '—' : Math.round(value).toLocaleString('en-PK')

export function LandingPage() {
  const [stats, setStats] = useState<PublicStats | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState('')
  const [health, setHealth] = useState<'checking' | 'online' | 'degraded'>('checking')
  const [newsletterMessage, setNewsletterMessage] = useState('')
  const [newsletterBusy, setNewsletterBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    api.get<PublicStats>('/public/stats')
      .then(({ data }) => { if (mounted) setStats(data) })
      .catch(() => { if (mounted) setStats(null) })
    api.get<Product[]>('/products?featured=true')
      .then(({ data }) => {
        if (!mounted) return
        setProducts(data.slice(0, 6))
        setProductsLoading(false)
      })
      .catch((reason) => {
        if (!mounted) return
        setProductsError(errorMessage(reason))
        setProductsLoading(false)
      })
    api.get<{ status?: string }>('/health')
      .then(({ data }) => { if (mounted) setHealth(data.status === 'ok' ? 'online' : 'degraded') })
      .catch(() => { if (mounted) setHealth('degraded') })
    return () => { mounted = false }
  }, [])

  const subscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const parsed = newsletterSchema.safeParse(new FormData(formElement).get('email'))
    if (!parsed.success) {
      setNewsletterMessage(parsed.error.issues[0]?.message ?? 'Enter a valid email address')
      return
    }
    setNewsletterBusy(true)
    setNewsletterMessage('')
    try {
      await api.post('/newsletter', { email: parsed.data })
      setNewsletterMessage('Subscription recorded.')
      formElement.reset()
    } catch (reason) {
      setNewsletterMessage(errorMessage(reason))
    } finally {
      setNewsletterBusy(false)
    }
  }

  const hubLookup = new Map((stats?.warehouses || []).map((hub) => [hub.code, hub]))
  const hubs = cityHubs.map((hub) => ({ ...hub, live: hubLookup.get(hub.code) || null }))

  return <div className="editorial pakistan-landing">
    <EditorialNavbar />
    <main className="landing-scroll">
      <section className="landing-scroll-section landing-hero" id="platform">
        <div className="wrap landing-hero-content">
          <div className="landing-hero-copy">
            <span className="eyebrow">01 / HARDWARE LOGISTICS FOR PAKISTAN</span>
            <h1>Hardware that ships before <em className="serif-italic">you run out.</em></h1>
            <p>VeloSupply AI tracks stock across Pakistan’s warehouse hubs, gives teams a shared view of fulfilment, and shows buyers the full price in rupees.</p>
            <div className="hero-actions">
              <Link className="button button-dark" to="/store">Shop hardware <ArrowRight size={16} /></Link>
              <a className="button button-outline" href="#network">See the network <ArrowUpRight size={15} /></a>
            </div>
            <div className="hero-proof">
              <div><strong>{formatCount(stats?.unitsTracked)}</strong><span>UNITS TRACKED</span></div>
              <div><strong>{formatCount(stats?.ordersFulfilledThisMonth)}</strong><span>FULFILLED THIS MONTH</span></div>
              <div><strong>{stats?.onTimeDispatchRate == null ? '—' : `${stats.onTimeDispatchRate}%`}</strong><span>ON-TIME DISPATCH</span></div>
            </div>
          </div>
          <aside className="workspace-snapshot">
            <div className="snapshot-heading">
              <span className="mono-label">WORKSPACE SNAPSHOT</span>
              <span className={`snapshot-status ${health}`}><i />{health === 'checking' ? 'Checking' : health === 'online' ? 'Service online' : 'Service degraded'}</span>
            </div>
            <div className="snapshot-primary">
              <span className="mono-label">ACTIVE ORDERS</span>
              <strong>{formatCount(stats?.activeOrders)}</strong>
              <small>Current orders in progress</small>
            </div>
            <div className="snapshot-secondary">
              <div><span className="mono-label">24H GMV · PKR</span><strong>—</strong><small>Shown after live order totals are available</small></div>
              <div><span className="mono-label">HUBS REPORTING</span><strong>{formatCount(stats?.warehouses.length)}</strong><small>Configured warehouse hubs</small></div>
            </div>
            <div className="snapshot-footer"><span>DATA SOURCE</span><strong>{stats?.dataMode === 'production' ? 'ATLAS PRODUCTION' : stats?.dataMode === 'demo' ? 'LOCAL DEMO DATA' : 'NOT AVAILABLE'}</strong></div>
          </aside>
        </div>
        <div className="wrap showcase-wrap">
          <div className="showcase-strip" aria-label="VeloSupply logistics and hardware showcase">
            {stripItems.map((item) => <div className={`showcase-panel ${item.className}`} key={item.src}>
              <div className="showcase-art"><item.icon size={29} strokeWidth={1.35} /></div>
              <span>{item.label}</span>
            </div>)}
          </div>
        </div>
        <div className="pakistan-marquee" aria-label="Pakistan hubs and carriers">
          <div className="marquee-inner"><span>Karachi</span><span>Lahore</span><span>Islamabad</span><span>Faisalabad</span><span>Peshawar</span><span>Quetta</span><span>TCS</span><span>Leopards</span><span>M&amp;P</span><span>Trax</span><span>BlueEx</span></div>
        </div>
      </section>

      <section className="landing-scroll-section landing-network" id="network">
        <div className="wrap">
          <div className="section-heading-row">
            <div><span className="eyebrow">02 / THE NETWORK</span><h2 className="section-title">Six hubs. One view of every unit.</h2></div>
            <p className="muted">A connected view of the warehouse network. Hub figures are shown only when the workspace has live records.</p>
          </div>
          <div className="network-layout">
            <div className="hub-list">
              {hubs.map((hub) => <article className="hub-row" key={hub.code}>
                <span className="hub-code">{hub.code}</span>
                <div><strong>{hub.live?.name || hub.city + ' hub'}</strong><small>{hub.live?.city || hub.city}</small></div>
                <span className={`hub-indicator ${hub.live?.status === 'online' ? 'online' : 'unknown'}`} />
              </article>)}
              {!stats?.warehouses.length && <p className="empty-note">Warehouse information will appear when hubs are configured in the workspace.</p>}
            </div>
            <div className="network-map-card">
              <div className="network-map-label"><span className="mono-label">PAKISTAN · HUB ROUTING MAP</span><span className="mono-label">SCHEMATIC VIEW</span></div>
              <svg className="pakistan-network-map" viewBox="0 0 560 350" role="img" aria-label="Schematic map showing the six VeloSupply Pakistan hub locations">
                <path className="map-outline" d="M142 27 L211 40 L252 24 L300 56 L344 49 L381 82 L423 92 L451 133 L426 166 L438 207 L403 236 L383 279 L344 292 L328 327 L286 309 L252 331 L222 307 L190 316 L157 287 L128 282 L106 249 L76 233 L92 199 L75 164 L106 137 L93 100 L119 78 Z" />
                {[[232,292,390,130],[390,130,412,88],[390,130,350,157],[350,157,333,66],[154,170,232,292],[154,170,350,157],[333,66,412,88]].map(([x1,y1,x2,y2],i)=><line key={i} className="map-route" x1={x1} y1={y1} x2={x2} y2={y2} />)}
                {hubs.map((hub) => <g key={hub.code} className="map-hub">
                  <circle cx={hub.x} cy={hub.y} r="9" className={hub.live ? 'map-marker-live' : 'map-marker'} />
                  <circle cx={hub.x} cy={hub.y} r="3" className="map-marker-core" />
                  <text x={hub.x + 13} y={hub.y - 9}>{hub.city}</text>
                </g>)}
              </svg>
              <div className="network-map-footer"><span><i className="map-legend-dot" /> Configured hub</span><span><i className="map-legend-line" /> Network link</span></div>
            </div>
          </div>
          <div className="network-activity">
            <div className="activity-head"><span className="eyebrow">WORKSPACE ACTIVITY</span><span className="mono-label">PUBLIC MILESTONES</span></div>
            {stats?.activity.length ? stats.activity.map((entry) => <div className="activity-entry" key={entry.id}><CircleDot size={14} /><span>{entry.message}</span><time>{entry.at ? new Date(entry.at).toLocaleDateString('en-PK') : ''}</time></div>) : <p className="empty-note">No workspace activity recorded yet.</p>}
          </div>
        </div>
      </section>

      <section className="landing-scroll-section landing-roi" id="roi">
        <div className="wrap">
          <RoiCalculator />
        </div>
      </section>

      <section className="landing-scroll-section landing-catalog" id="catalog">
        <div className="wrap">
          <div className="section-heading-row">
            <div><span className="eyebrow">04 / IN STOCK NOW</span><h2 className="section-title">Hardware ready for Pakistan’s businesses.</h2></div>
            <Link className="text-link" to="/store">Browse full catalog <ArrowRight size={15} /></Link>
          </div>
          <div className="category-strip">
            {categoryItems.map((item) => <article className="category-tile" key={item.name}>
              <div className="category-art"><item.icon size={25} strokeWidth={1.4} /></div>
              <div><strong>{item.name}</strong><span>{item.detail}</span></div>
            </article>)}
          </div>
          {productsLoading && <div className="catalog-state">Loading featured hardware…</div>}
          {!productsLoading && productsError && <div className="catalog-state catalog-error" role="alert">Featured products could not be loaded. {productsError}</div>}
          {!productsLoading && !productsError && products.length > 0 && <div className="product-grid">
            {products.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>}
          {!productsLoading && !productsError && products.length === 0 && <div className="catalog-empty">
            <Package size={25} />
            <div><strong>Catalog is currently empty</strong><p>Administrators can publish the first products inside the workspace.</p></div>
            <Link className="button button-outline" to="/login">Open workspace <ArrowRight size={15} /></Link>
          </div>}
          <div className="catalog-footnote">Product availability and prices are retrieved from the VeloSupply catalog. Prices are displayed in Pakistani rupees.</div>
        </div>
      </section>

      <section className="landing-scroll-section landing-plans" id="access">
        <div className="plans-backdrop">
          <div className="wrap plans-content">
            <div className="section-heading-row plans-heading">
              <div><span className="eyebrow">05 / PLANS AND RELIABILITY</span><h2 className="section-title">One platform. Three ways to work.</h2></div>
              <p>Role-based access keeps each team focused on the work it owns.</p>
            </div>
            <div className="access-workflow">
              <article><span>01</span><ShieldCheck size={21} /><h3>Administrator governance</h3><p>Set up hubs, publish inventory, manage people and review audit activity.</p></article>
              <article><span>02</span><Truck size={21} /><h3>Operations and fulfilment</h3><p>Adjust stock, coordinate orders, receive replenishment and manage delivery checkpoints.</p></article>
              <article><span>03</span><ShoppingBag size={21} /><h3>Buyer procurement</h3><p>Browse available hardware, place orders in PKR and follow delivery progress.</p></article>
            </div>
            <div className="plans-divider" />
            <div className="section-heading-row plans-heading">
              <div><span className="eyebrow">WORKSPACE PLANS</span><h2 className="section-title">Choose a plan for your network.</h2></div>
              <Link className="button button-orange" to="/register">Get started <ArrowRight size={15} /></Link>
            </div>
            <div className="pricing-grid">
              {plans.map((plan) => <article className={`price-card ${plan.featured ? 'highlight' : ''}`} key={plan.name}>
                <span className="eyebrow">{plan.featured ? 'MOST CHOSEN' : 'MONTHLY PLAN'}</span>
                <h3>{plan.name}</h3>
                <strong className="price-value">{plan.price}<small> / month</small></strong>
                <p>{plan.note}</p>
                <ul>{plan.items.map((item) => <li key={item}>{item}</li>)}</ul>
                <Link className={`button ${plan.featured ? 'button-orange' : 'button-outline'}`} to="/register">Select {plan.name}</Link>
              </article>)}
            </div>
            <div className="reliability-strip">
              <div><span className="mono-label">API STATUS</span><strong>{health === 'checking' ? 'Checking' : health === 'online' ? 'Responding' : 'Degraded'}</strong></div>
              <div><span className="mono-label">FULFILLED THIS MONTH</span><strong>{formatCount(stats?.ordersFulfilledThisMonth)}</strong></div>
              <div><span className="mono-label">ACTIVE ORDERS</span><strong>{formatCount(stats?.activeOrders)}</strong></div>
              <div><span className="mono-label">ON-TIME DISPATCH</span><strong>{stats?.onTimeDispatchRate == null ? 'Not measured' : `${stats.onTimeDispatchRate}%`}</strong></div>
            </div>
            <div className="invitation-cta">
              <div><span className="eyebrow">ALREADY PART OF A WORKSPACE?</span><strong>Have an invitation key?</strong><p>Redeem your Operations access key and join your team.</p></div>
              <Link className="button button-orange" to="/register">Redeem invitation key <ArrowRight size={15} /></Link>
            </div>
          </div>
          <footer className="site-footer plans-footer">
            <div className="wrap footer-row">
              <div><Link className="brand" to="/"><span className="brand-mark"><Boxes size={16} /></span> VeloSupply AI</Link><p>Hardware commerce and fulfilment for Pakistan.</p></div>
              <form className="footer-subscribe" onSubmit={subscribe}>
                <label htmlFor="newsletter-email">Field notes from the network</label>
                <div><input id="newsletter-email" name="email" type="email" required className="field" placeholder="Email address" /><button className="button button-orange" disabled={newsletterBusy}>{newsletterBusy ? 'Saving…' : 'Subscribe'}</button></div>
                <small role="status">{newsletterMessage}</small>
              </form>
              <div className="footer-links"><Link to="/store">Catalog</Link><Link to="/login">Sign in</Link><Link to="/register">Create account</Link></div>
              <span className="footer-health"><i className={health === 'online' ? 'health-dot' : 'health-dot muted-dot'} />{health === 'online' ? 'API responding' : health === 'checking' ? 'Checking API' : 'API unavailable'}</span>
            </div>
            <div className="wrap footer-legal"><span>© {new Date().getFullYear()} VeloSupply AI</span><span>Service availability and estimates are based on the current workspace data.</span></div>
          </footer>
        </div>
      </section>
    </main>
    <CartDrawer />
  </div>
}
