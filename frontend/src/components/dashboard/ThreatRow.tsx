import { AlertTriangle, ArrowUpRight, CheckCircle2 } from 'lucide-react'
import type { InventoryThreat, Product, Warehouse } from '../../types'

function severityFor(threat?: InventoryThreat) {
  if (!threat) return 'MEDIUM'
  return String(threat.severity || (threat.level === 'WARN' ? 'medium' : threat.level)).toUpperCase()
}
function severityClass(severity: string) {
  if (severity === 'CRITICAL') return 'threat-severity critical'
  if (severity === 'HIGH') return 'threat-severity high'
  return 'threat-severity medium'
}

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
  const severity = severityFor(threat)
  const available = threat?.available ?? item?.available ?? item?.stock ?? 0
  const cover = Number.isFinite(threat?.daysOfCover) ? Number(threat?.daysOfCover).toFixed(1) : '—'
  const daily = Number.isFinite(threat?.avgDaily) ? Number(threat?.avgDaily).toFixed(2) : '0.00'
  const capacity = location ? Math.min(100, Math.max(0, Number(location.capacity || 0) / 100)) : 0

  if (resolved) return <article className="card-ops dash-card threat-row resolved">
    <span className="success-text"><CheckCircle2 size={16} /> Resolved · {title}</span>
    <span className="mono-label">STOCK RECEIPT RECORDED</span>
  </article>

  return <article className={`card-ops threat-row severity-${severity.toLowerCase()}`}>
    <span className="threat-severity-rail" aria-hidden="true" />
    <div className="threat-row-main">
      <div className="threat-row-title-line">
        <span className="threat-alert-icon"><AlertTriangle size={16} /></span>
        <strong>{title}</strong>
        <span className={severityClass(severity)}>{severity}</span>
      </div>
      <div className="threat-row-reference">
        {item ? <><code>{item.sku}</code><span>{available} available</span><span>{cover} days cover</span></> : location ? <><code>{location.id}</code><span>{capacity.toFixed(0)}% capacity</span><span>{location.latency}ms recorded latency</span></> : null}
      </div>
      {threat?.type === 'inventory' && <div className="threat-metrics">
        <span>Demand <strong>{daily}/day</strong></span>
        <span>On order <strong>{threat.onOrder ?? 0}</strong></span>
        <span>Reorder point <strong>{threat.reorderPoint ?? 0}</strong></span>
        <span>Recommended PO <strong>{threat.recommendQty ?? 0} units</strong></span>
        <span>Supplier <strong>{threat.supplier?.name ?? 'Not assigned'}</strong>{threat.supplier?.reliabilityScore != null ? ` · ${threat.supplier.reliabilityScore}% rel.` : ''}</span>
      </div>}
      {threat?.message && <p className="threat-row-message">{threat.message}</p>}
    </div>
    <div className="threat-row-action">
      {item && threat?.type === 'inventory' && (threat.recommendQty ?? 0) > 0
        ? <button className={severity === 'CRITICAL' ? 'button button-dark threat-create-po' : 'small-button threat-create-po'} onClick={onResolve}>Create draft PO <ArrowUpRight size={13} /></button>
        : location ? <span className={`status-pill ${location.status === 'online' ? 'status-positive' : 'status-warning'}`}>{location.status}</span> : null}
    </div>
  </article>
}
