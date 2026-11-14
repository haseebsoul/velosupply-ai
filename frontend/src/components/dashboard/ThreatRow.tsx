import { AlertTriangle, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import type { InventoryThreat, Product, Warehouse } from '../../types'

export function ThreatRow({ threat, product, hub, onResolve, resolved = false }: {
  threat?: InventoryThreat
  product?: Product
  hub?: Warehouse
  onResolve?: () => void
  resolved?: boolean
}) {
  const item = threat?.product ?? product
  const location = threat?.warehouse ?? hub
  const title = item?.name ?? location?.name ?? 'Inventory alert'
  if (resolved) return <article className="card-ops dash-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span className="success-text"><CheckCircle2 size={16} /> Resolved · {title}</span>
    <span className="mono-label">STOCK RECEIPT RECORDED</span>
  </article>

  return <article className="card-ops dash-card" style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', marginBottom: 10 }}>
    <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start', minWidth: 0 }}>
      <AlertTriangle size={18} color="var(--status-warning)" />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{title}</strong>
          {threat?.level && <span className="status-pill status-warning">{threat.level}</span>}
        </div>
        <div className="ops-muted mono-label" style={{ marginTop: 5 }}>
          {item ? `${item.sku} · ${threat?.available ?? item.available ?? item.stock} available · ${threat?.daysOfCover?.toFixed(1) ?? '—'} days cover`
            : `${location?.id} · Capacity ${location?.capacity}% · ${location?.latency}ms latency`}
        </div>
        {threat?.type === 'inventory' && <div className="ops-copy" style={{ marginTop: 7, fontSize: 12 }}>
          Average demand: {threat.avgDaily?.toFixed(2) ?? '0.00'} units/day · On order: {threat.onOrder ?? 0} · Reorder point: {threat.reorderPoint ?? 0}
          <br />
          Recommended PO: {threat.recommendQty ?? 0} units
          {threat.supplier ? ` · Supplier: ${threat.supplier.name} (${threat.supplier.reliabilityScore ?? '—'} reliability)` : ' · Supplier not assigned'}
        </div>}
        {threat?.message && <div className="ops-muted" style={{ marginTop: 5, fontSize: 12 }}>{threat.message}</div>}
      </div>
    </div>
    {item && threat?.type === 'inventory' && (threat.recommendQty ?? 0) > 0
      ? <button className="small-button" onClick={onResolve}>Create draft PO <ArrowUpRight size={13} /></button>
      : location ? <span className="status-pill status-warning">{location.status}</span> : null}
  </article>
}
