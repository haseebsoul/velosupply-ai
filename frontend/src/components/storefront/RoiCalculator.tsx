import { useState } from 'react'

export function RoiCalculator() {
  const [orders, setOrders] = useState(25000)
  const recovered = Math.round(orders * 0.142 * 186)
  return <div className="roi-grid">
    <div>
      <span className="eyebrow">ROI estimator</span><h3 className="section-title" style={{ fontSize: 38 }}>Turn missed demand into recovered revenue.</h3>
      <p className="muted">Estimate annualized revenue protected by proactively preventing stockouts.</p>
      <label className="mono-label" htmlFor="order-volume">Monthly order volume · {orders.toLocaleString()}</label>
      <input id="order-volume" className="field" type="range" min="1000" max="250000" step="1000" value={orders} onChange={(event) => setOrders(Number(event.target.value))} />
    </div>
    <div className="card-light"><div className="mono-label">Estimated recovered demand</div><div className="mono" style={{ fontSize: 38, margin: '12px 0', color: 'var(--accent-editorial-primary)' }}>${recovered.toLocaleString()}</div><div className="muted">Annualized estimate based on a 14.2% stockout baseline and $186 average order value.</div></div>
  </div>
}
