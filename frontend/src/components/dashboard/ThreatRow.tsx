import { AlertTriangle, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import type { Product, Warehouse } from '../../types'

export function ThreatRow({ product, hub, onResolve, resolved = false }: { product?: Product; hub?: Warehouse; onResolve?: () => void; resolved?: boolean }) {
  if (resolved) return <article className="card-ops dash-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="success-text"><CheckCircle2 size={16} /> Resolved · {product?.name ?? hub?.name}</span><span className="mono-label">RESTOCK PO EXECUTED</span></article>
  return <article className="card-ops dash-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', marginBottom: 10 }}>
    <div style={{ display: 'flex', gap: 13, alignItems: 'center' }}><AlertTriangle size={18} color="var(--status-warning)" /><div><strong>{product?.name ?? hub?.name}</strong><div className="ops-muted mono-label" style={{ marginTop: 5 }}>{product?.sku ?? hub?.id} · {product ? `${product.stock} units · threshold ${product.reorder_threshold}` : `Capacity ${hub?.capacity}% · ${hub?.latency}ms`}</div></div></div>
    {product ? <button className="small-button" onClick={onResolve}>Execute AI Restock PO <ArrowUpRight size={13} /></button> : <span className="status-pill status-warning">{hub?.status}</span>}
  </article>
}
