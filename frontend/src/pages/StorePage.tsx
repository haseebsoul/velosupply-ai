import { useEffect, useMemo, useState } from 'react'
import { Search, ShoppingBag } from 'lucide-react'
import { EditorialNavbar } from '../components/storefront/EditorialNavbar'
import { CartDrawer } from '../components/storefront/CartDrawer'
import { ProductCard } from '../components/storefront/ProductCard'
import { api, errorMessage } from '../lib/apiClient'
import { useCartStore } from '../store/useCartStore'
import type { Product } from '../types'

const categories = ['All', 'Edge Gateways', 'Smart Sensors', 'Server Racks', 'Power Modules']
export function StorePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [inStock, setInStock] = useState(false)
  const [sort, setSort] = useState('featured')
  const [error, setError] = useState('')
  const setOpen = useCartStore((state) => state.setOpen)
  useEffect(() => {
    api.get<Product[]>('/products').then(({ data }) => setProducts(data)).catch((reason: unknown) => setError(errorMessage(reason)))
  }, [])
  const filtered = useMemo(() => products.filter((product) =>
    (category === 'All' || product.category === category) &&
    (!inStock || product.stock > 0) &&
    `${product.name} ${product.sku} ${product.description}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((a, b) => sort === 'price-low' ? a.price - b.price : sort === 'price-high' ? b.price - a.price : sort === 'velocity' ? b.velocity_per_hr - a.velocity_per_hr : 0), [products, category, query, inStock, sort])
  return <div className="editorial"><EditorialNavbar /><main className="wrap section" style={{ minHeight: '80vh' }}>
    <div className="eyebrow">Warehouse-backed hardware</div><h1 className="section-title">The live catalog.</h1><p className="muted">Every unit is connected to real-time fulfillment inventory.</p>
    <div className="store-toolbar"><div style={{ flex: '1 1 240px', position: 'relative' }}><Search size={16} style={{ position: 'absolute', top: 14, left: 13 }} /><input aria-label="Search products" className="field" style={{ paddingLeft: 38 }} placeholder="Search SKU or product…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <select aria-label="Sort products" className="field" style={{ width: 'auto' }} value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="velocity">Velocity</option></select>
      <button className={`filter-chip ${inStock ? 'active' : ''}`} onClick={() => setInStock((value) => !value)}>In stock only</button>
      <button className="cart-pill" onClick={() => setOpen(true)}><ShoppingBag size={15} /> Cart</button>
    </div>
    <div className="store-toolbar">{categories.map((name) => <button key={name} className={`filter-chip ${category === name ? 'active' : ''}`} onClick={() => setCategory(name)}>{name}</button>)}</div>
    {error ? <div role="alert" className="danger-text">{error}</div> : products.length === 0 ? <p className="muted">Connecting to live catalog…</p> : filtered.length ? <div className="product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} />)}</div> : <p className="muted">No products match these filters.</p>}
  </main><CartDrawer /><footer className="site-footer"><div className="wrap footer-row"><span className="brand">VeloSupply AI</span><span className="muted">Connected inventory · 5 global hubs</span></div></footer></div>
}
