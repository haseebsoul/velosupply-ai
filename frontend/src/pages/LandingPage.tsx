import { FormEvent, useEffect, useState } from 'react'
import { ArrowRight, ArrowUpRight, Boxes, CircleDot, Network, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { EditorialNavbar } from '../components/storefront/EditorialNavbar'
import { CartDrawer } from '../components/storefront/CartDrawer'
import { ProductCard } from '../components/storefront/ProductCard'
import { RoiCalculator } from '../components/storefront/RoiCalculator'
import { useWebSocket } from '../lib/useWebSocket'
import { api, errorMessage } from '../lib/apiClient'
import type { Metrics, Product, TelemetryEvent } from '../types'

const partners = ['Buyer checkout', 'Inventory ledger', 'Manual COD', 'Operator dispatch', 'Return inspection', 'Audit trail']
const newsletterSchema = z.string().email('Enter a valid email address')
const steps = [
  ['01', 'Multi-channel order ingestion', 'A single order stream synchronizes stock across every channel.'],
  ['02', 'Sub-20ms nearest-hub routing', 'Orders route to the healthiest node with the fastest delivery path.'],
  ['03', 'Predictive supplier restock POs', 'Demand signals trigger replenishment before shelves run dry.'],
]

export function LandingPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [healthy, setHealthy] = useState<boolean | null>(null)
  const [legacy, setLegacy] = useState(false)
  const [newsletterMessage, setNewsletterMessage] = useState('')
  const { events } = useWebSocket()
  useEffect(() => {
    api.get<Metrics>('/metrics').then(({ data }) => setMetrics(data)).catch(() => undefined)
    api.get<Product[]>('/products').then(({ data }) => setProducts(data.slice(0, 6))).catch(() => undefined)
    api.get('/health').then(() => setHealthy(true)).catch(() => setHealthy(false))
  }, [])
  const latest = [...events].reverse().filter((event: TelemetryEvent) => event.message).slice(0, 4)
  const subscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const parsed = newsletterSchema.safeParse(form.get('email'))
    if (!parsed.success) {
      setNewsletterMessage(parsed.error.issues[0]?.message ?? 'Enter a valid email address')
      return
    }
    try {
      await api.post('/newsletter', { email: parsed.data })
      setNewsletterMessage('You are on the list.')
      formElement.reset()
    } catch (reason) {
      setNewsletterMessage(errorMessage(reason))
    }
  }
  return <div className="editorial">
    <EditorialNavbar />
    <main>
      <section className="wrap hero" id="platform">
        <div><span className="eyebrow">Autonomous commerce infrastructure</span><h1>The autonomous supply chain that <em className="serif-italic">never sleeps.</em></h1>
          <p className="hero-copy">A product and operations workflow preview. Catalogue, stock, hub, and telemetry values in this demo are synthetic and do not represent verified facilities or live fulfillment.</p>
          <div className="hero-actions"><Link className="button button-dark" to="/store">Browse hardware store <ArrowRight size={16} /></Link><Link className="button button-outline" to="/dashboard">Open operations demo <ArrowUpRight size={15} /></Link></div>
          <div className="social-proof">SYNTHETIC DEMO DATA · NO VERIFIED FACILITY, INVENTORY OR LIVE OPERATIONS CLAIM</div>
        </div>
        <div className="telemetry-preview">
          <div className="preview-top"><span className="mono-label" style={{ color: 'var(--text-ops-secondary)' }}>SYNTHETIC DEMO · NOT LIVE FACILITY STATUS</span><span className="mono-label" style={{ color: 'var(--text-ops-secondary)' }}>SAMPLE DATA</span></div>
          <div className="preview-metrics"><div className="preview-metric"><span className="mono-label">DEMO GMV</span><strong>{metrics ? `${metrics.gmv24h.toLocaleString()}` : '—'}</strong></div><div className="preview-metric"><span className="mono-label">DEMO ORDERS</span><strong>{metrics ? metrics.activeOrders : '—'}</strong></div></div>
          <div className="mono-label" style={{ color: 'var(--text-ops-secondary)' }}>SAMPLE APPLICATION METRIC · NOT PHYSICAL FULFILLMENT</div><div className="bar-line" style={{ width: `${Math.max(0, Math.min(100, metrics?.fulfillmentHealth ?? 0))}%` }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}><span className="mono-label" style={{ color: 'var(--text-ops-secondary)' }}>HUB-KHI · PROPOSED CANDIDATE · NOT VERIFIED</span></div>
        </div>
      </section>
      <div className="marquee"><div className="marquee-inner">{partners.map((partner) => <span key={partner}>{partner}</span>)}</div></div>
      <section className="wrap section">
        <span className="eyebrow">Illustrative workflow comparison · not measured performance</span><h2 className="section-title">A clearer path from order to fulfillment.</h2>
        <div className="compare"><div className={`compare-card ${legacy ? 'featured' : ''}`}><div className="mono-label">MANUAL WORKFLOW · EXAMPLE</div><div className="compare-value">Demo</div><div>operator-managed steps</div><p style={{ color: legacy ? 'var(--text-ops-secondary)' : 'var(--text-editorial-secondary)' }}>Illustrative workflow only · no measured baseline supplied</p></div><div className={`compare-card ${legacy ? '' : 'featured'}`}><div className="mono-label" style={{ color: 'var(--accent-ops-lime)' }}>VELOSUPPLY WORKFLOW PREVIEW</div><div className="compare-value">Demo</div><div>connected application steps</div><p style={{ color: 'var(--text-ops-secondary)' }}>No independently verified routing, fill-rate or automation performance is claimed</p></div></div>
        <button className="filter-chip" style={{ marginTop: 15 }} onClick={() => setLegacy((value) => !value)}>{legacy ? 'Show VeloSupply advantage' : 'Compare legacy workflow'} <ArrowRight size={13} /></button>
      </section>
      <section className="wrap section" id="catalog"><span className="eyebrow">Synthetic demo catalogue</span><h2 className="section-title">Sample products for workflow testing.</h2><p className="muted">Catalogue and stock values are synthetic application data; no physical stock or fulfillment is verified.</p>
        <div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div><div style={{ textAlign: 'center', marginTop: 28 }}><Link className="button button-outline" to="/store">Browse sample catalogue <ArrowRight size={15} /></Link></div>
      </section>
      <section className="wrap section"><span className="eyebrow">One connected operating system</span><h2 className="section-title">From signal to shipment.</h2><div className="workflow-grid">{steps.map(([number, title, copy], i) => <article className="workflow-card" key={number}><span className="workflow-number">{number} / SYSTEM</span><div style={{ marginTop: 27, color: 'var(--accent-editorial-primary)' }}>{[<Boxes key="a" />, <Network key="b" />, <ShieldCheck key="c" />][i]}</div><h3>{title}</h3><p className="muted">{copy}</p></article>)}</div></section>
      <section className="wrap section" id="telemetry"><div className="dark-sandbox"><div><span className="mono-label" style={{ color: 'var(--accent-ops-lime)' }}>SYNTHETIC DEMO TELEMETRY · NOT LIVE OPERATIONS</span><h2 className="section-title" style={{ color: 'var(--text-ops-primary)', fontSize: 40 }}>Every node. Every signal.</h2><p style={{ color: 'var(--text-ops-secondary)' }}>Synthetic events only. This preview does not monitor physical devices, warehouse capacity, couriers or live supply-chain operations.</p><Link className="button ops-button" to="/dashboard">Open demo operations console</Link></div><div>{(latest.length ? latest : [{ message: 'Synthetic demo heartbeat', timestamp: new Date().toISOString() }, { message: 'Illustrative order workflow event', timestamp: new Date().toISOString() }, { message: 'Demo inventory ledger refreshed', timestamp: new Date().toISOString() }]).map((event, i) => <div className="log-line" key={`${event.timestamp}-${i}`}><i className="live-dot" style={{ marginRight: 10 }} /> {event.message}</div>)}<div className="preview-metrics" style={{ marginBottom: 0 }}><div className="mono-label" style={{ color: 'var(--text-ops-secondary)' }}>HUB-KHI · PROPOSED · PHYSICAL SITE NOT VERIFIED</div></div></div></div></section>
      <section className="wrap section" id="pricing"><RoiCalculator /><div className="pricing-grid">{[['Growth', '$499', 'For teams building resilient fulfillment.'], ['Scale', '$1,499', 'For multi-node commerce at velocity.'], ['Enterprise', 'Custom', 'For global orchestration at any scale.']].map(([plan, price, copy]) => <article className={`price-card ${plan === 'Scale' ? 'highlight' : ''}`} key={plan}><span className="eyebrow">{plan === 'Scale' ? 'MOST POPULAR' : 'PLAN'}</span><h3>{plan}</h3><div className="mono" style={{ fontSize: 30 }}>{price}<small style={{ font: '13px Inter' }}>{price !== 'Custom' ? '/mo' : ''}</small></div><p className="muted">{copy}</p><Link className="button button-outline" to="/login">Talk to our team</Link></article>)}</div></section>
    </main>
    <footer className="site-footer"><div className="wrap footer-row"><div><Link className="brand" to="/"><span className="brand-mark"><Boxes size={16} /></span> VeloSupply AI</Link><p className="muted">Demo workflow preview · operational claims not independently verified.</p></div><div style={{ display: 'grid', gap: 10 }}><form onSubmit={subscribe} style={{ display: 'flex', gap: 8 }}><input aria-label="Newsletter email" name="email" type="email" required className="field" placeholder="Email for field notes" style={{ width: 220 }} /><button className="button button-dark">Subscribe</button></form><small role="status" className="muted">{newsletterMessage}</small></div><div style={{ display: 'flex', gap: 20 }}><Link to="/store">Catalog</Link><Link to="/dashboard">Operations</Link><Link to="/login">Account</Link></div><span className={healthy ? 'success-text' : 'muted'}><i className="live-dot" style={{ marginRight: 8 }} />{healthy === null ? 'Checking demo API' : healthy ? 'API health endpoint responding · pilot not verified' : 'API endpoint unavailable'}</span></div></footer>
    <CartDrawer />
  </div>
}
