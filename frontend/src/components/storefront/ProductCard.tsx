import { motion } from 'framer-motion'
import { Cpu, Plus, Radio, Server, Zap } from 'lucide-react'
import { useCartStore } from '../../store/useCartStore'
import type { Product } from '../../types'

const icons = [Cpu, Radio, Server, Zap]
const pkr = new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 })
export function ProductCard({ product }: { product: Product }) {
  const Icon = icons[Math.abs(product.category.length + product.name.length) % icons.length]
  const add = useCartStore((state) => state.add)
  return <motion.article className="card-light product-card" whileHover={{ scale: 1.01, y: -2 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
    <div className="product-art"><Icon /></div>
    <div className="mono-label" style={{ marginTop: 16 }}>{product.sku} · {product.category}</div>
    <h3>{product.name}</h3>
    <p className="muted" style={{ fontSize: 13, minHeight: 40 }}>{product.description}</p>
    <div className="product-meta"><span className="mono" style={{ fontSize: 18 }}>{Number.isSafeInteger(product.priceExGstPkr) ? pkr.format(product.priceExGstPkr as number) : 'PKR price unavailable'}</span><span className="status-pill">{product.available ?? product.stock} available</span></div>
    <div className="product-meta" style={{ marginTop: 16 }}><span className="mono-label">{product.warehouse_hub} · {product.leadDays ?? '—'} day lead</span><motion.button className="button button-dark" whileTap={{ scale: .97 }} disabled={(product.available ?? product.stock) < 1} onClick={() => add(product)}><Plus size={15} /> Add</motion.button></div>
  </motion.article>
}
