import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Search, ShoppingBag, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EditorialNavbar } from '../components/storefront/EditorialNavbar'
import { CartDrawer } from '../components/storefront/CartDrawer'
import { ProductCard } from '../components/storefront/ProductCard'
import { api, errorMessage } from '../lib/apiClient'
import { useCartStore } from '../store/useCartStore'
import type { Product } from '../types'

const categories = ['All', 'Power', 'Networking', 'Security', 'Infrastructure', 'Retail', 'Computing']

export function StorePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [inStock, setInStock] = useState(false)
  const [sort, setSort] = useState('featured')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const setOpen = useCartStore((state) => state.setOpen)

  const loadProducts = () => {
    setLoading(true)
    setError('')
    api.get<Product[]>('/products')
      .then(({ data }) => setProducts(data))
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadProducts() }, [])

  const filtered = useMemo(() => products.filter((product) =>
    (category === 'All' || product.category === category) &&
    (!inStock || (product.available ?? product.stock) > 0) &&
    `${product.name} ${product.sku} ${product.description}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((a, b) => sort === 'price-low'
    ? (a.priceExGstPkr ?? Number.MAX_SAFE_INTEGER) - (b.priceExGstPkr ?? Number.MAX_SAFE_INTEGER)
    : sort === 'price-high'
      ? (b.priceExGstPkr ?? 0) - (a.priceExGstPkr ?? 0)
      : sort === 'velocity'
        ? (a.leadDays ?? 999) - (b.leadDays ?? 999)
        : Number(Boolean(b.featured)) - Number(Boolean(a.featured))),
  [products, category, query, inStock, sort])

  return <div className="editorial">
    <EditorialNavbar />
    <main className="wrap section store-page" style={{ minHeight: '80vh' }}>
      <div className="eyebrow">VELOSUPPLY CATALOG · PAKISTAN</div>
      <div className="section-heading-row">
        <div><h1 className="section-title">Hardware for your operations.</h1><p className="muted">Browse catalog records, compare PKR prices and check availability by the fulfilment network.</p></div>
        <button className="cart-pill" onClick={() => setOpen(true)}><ShoppingBag size={15} /> Open cart</button>
      </div>
      <div className="store-toolbar">
        <div className="store-search"><Search size={16} /><input aria-label="Search products" className="field" placeholder="Search SKU or product…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <select aria-label="Sort products" className="field store-sort" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="velocity">Shortest lead time</option>
        </select>
        <button className={`filter-chip ${inStock ? 'active' : ''}`} onClick={() => setInStock((value) => !value)}><SlidersHorizontal size={13} /> In stock only</button>
      </div>
      <div className="store-toolbar store-categories" aria-label="Product categories">
        {categories.map((name) => <button key={name} className={`filter-chip ${category === name ? 'active' : ''}`} onClick={() => setCategory(name)}>{name}</button>)}
      </div>
      {loading && <div className="store-state" aria-live="polite"><span className="store-state-kicker">CATALOG</span><strong>Loading product records…</strong><p>Fetching current catalog and availability from the workspace.</p></div>}
      {!loading && error && <div className="store-state store-error" role="alert"><AlertCircle size={21} /><div><strong>Catalog could not be loaded</strong><p>{error}</p></div><button className="button button-outline" onClick={loadProducts}>Try again</button></div>}
      {!loading && !error && products.length === 0 && <div className="store-state"><span className="store-state-kicker">NO PUBLISHED PRODUCTS</span><strong>Catalog is currently empty.</strong><p>Published product records will appear here when an Administrator adds them to the workspace.</p><Link className="button button-outline" to="/login">Open workspace</Link></div>}
      {!loading && !error && products.length > 0 && filtered.length > 0 && <><div className="store-result-count">{filtered.length} {filtered.length === 1 ? 'product' : 'products'} shown · PKR pricing</div><div className="product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} />)}</div></>}
      {!loading && !error && products.length > 0 && filtered.length === 0 && <div className="store-state"><strong>No products match these filters.</strong><p>Try a different search, category or stock filter.</p><button className="button button-outline" onClick={() => { setQuery(''); setCategory('All'); setInStock(false) }}>Clear filters</button></div>}
    </main>
    <CartDrawer />
    <footer className="site-footer"><div className="wrap footer-row"><span className="brand">VeloSupply AI</span><span className="muted">Pakistan hardware catalogue · live workspace records</span></div></footer>
  </div>
}
