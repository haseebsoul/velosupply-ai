import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/apiClient'

type Estimate = {
  currency: 'PKR'
  monthlyRevenuePkr: number
  lostToStockoutsPkr: number
  recoveredPkr: number
  loadSheddingLossPkr: number
  savedByQueuePkr: number
  monthlyBenefitPkr: number
  hoursSaved: number
  paybackMonths: number | null
  assumptions: {
    stockoutRecoveryFactor: number
    loadSheddingSavingsFactor: number
    idleStaffCostPerHourPkr: number
    growthPlanPricePkr: number
  }
}

const formatPkr = (value: number) => `Rs ${Math.round(value).toLocaleString('en-PK')}`
const clamp = (value: number, minimum: number, maximum: number) =>
  Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum

export function RoiCalculator() {
  const [orders, setOrders] = useState(1200)
  const [averageOrder, setAverageOrder] = useState(85000)
  const [stockoutRate, setStockoutRate] = useState(8)
  const [loadSheddingHours, setLoadSheddingHours] = useState(3)
  const [hubs, setHubs] = useState(6)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [estimateError, setEstimateError] = useState('')
  const [calculating, setCalculating] = useState(false)

  useEffect(() => {
    let mounted = true
    const timer = window.setTimeout(() => {
      setCalculating(true)
      setEstimateError('')
      api.post<Estimate>('/public/roi', {
        orders,
        avgOrderValuePkr: averageOrder,
        stockoutRatePct: stockoutRate,
        hoursPerDay: loadSheddingHours,
        hubs
      }).then(({ data }) => {
        if (mounted) setEstimate(data)
      }).catch((reason) => {
        if (mounted) setEstimateError(errorMessage(reason))
      }).finally(() => {
        if (mounted) setCalculating(false)
      })
    }, 160)
    return () => {
      mounted = false
      window.clearTimeout(timer)
    }
  }, [orders, averageOrder, stockoutRate, loadSheddingHours, hubs])

  return <div className="roi-estimator">
    <div className="roi-intro">
      <span className="eyebrow">03 / THE NUMBERS</span>
      <h2 className="section-title">See what stockouts cost your operation.</h2>
      <p className="muted">Change the inputs to estimate monthly revenue recovered, time saved and payback in Pakistani rupees.</p>
      <div className="roi-inputs">
        <label className="roi-control"><span>Monthly orders</span>
          <input type="range" min="100" max="12000" step="100" value={orders} onChange={(event) => setOrders(clamp(Number(event.target.value), 100, 12000))} />
          <input className="field roi-number" aria-label="Monthly orders numeric value" type="number" min="100" max="12000" step="100" value={orders} onChange={(event) => setOrders(clamp(Number(event.target.value), 100, 12000))} />
        </label>
        <label className="roi-control"><span>Average order value · PKR</span>
          <input type="range" min="10000" max="500000" step="5000" value={averageOrder} onChange={(event) => setAverageOrder(clamp(Number(event.target.value), 10000, 500000))} />
          <input className="field roi-number" aria-label="Average order value in PKR" type="number" min="10000" max="500000" step="5000" value={averageOrder} onChange={(event) => setAverageOrder(clamp(Number(event.target.value), 10000, 500000))} />
        </label>
        <label className="roi-control"><span>Stockout rate · percent</span>
          <input type="range" min="0" max="35" step="1" value={stockoutRate} onChange={(event) => setStockoutRate(clamp(Number(event.target.value), 0, 35))} />
          <input className="field roi-number" aria-label="Stockout rate percentage" type="number" min="0" max="35" step="1" value={stockoutRate} onChange={(event) => setStockoutRate(clamp(Number(event.target.value), 0, 35))} />
        </label>
        <label className="roi-control"><span>Load-shedding hours per day</span>
          <input type="range" min="0" max="12" step="1" value={loadSheddingHours} onChange={(event) => setLoadSheddingHours(clamp(Number(event.target.value), 0, 12))} />
          <input className="field roi-number" aria-label="Load-shedding hours per day" type="number" min="0" max="12" step="1" value={loadSheddingHours} onChange={(event) => setLoadSheddingHours(clamp(Number(event.target.value), 0, 12))} />
        </label>
        <label className="roi-control"><span>Operating hubs</span>
          <input type="range" min="1" max="6" step="1" value={hubs} onChange={(event) => setHubs(clamp(Number(event.target.value), 1, 6))} />
          <input className="field roi-number" aria-label="Number of hubs" type="number" min="1" max="6" step="1" value={hubs} onChange={(event) => setHubs(clamp(Number(event.target.value), 1, 6))} />
        </label>
      </div>
    </div>
    <div className="roi-results" aria-live="polite">
      <span className="mono-label">MONTHLY ESTIMATE · PKR</span>
      <div className="roi-result-primary"><small>Revenue recovered</small><strong>{estimate ? formatPkr(estimate.recoveredPkr) : calculating ? 'Calculating…' : '—'}</strong></div>
      <div className="roi-result-row"><span>Revenue exposed to stockouts</span><strong>{estimate ? formatPkr(estimate.lostToStockoutsPkr) : '—'}</strong></div>
      <div className="roi-result-row"><span>Staff hours saved · estimate</span><strong>{estimate ? `${Math.round(estimate.hoursSaved).toLocaleString('en-PK')} hrs` : '—'}</strong></div>
      <div className="roi-result-row"><span>Growth plan payback</span><strong>{estimate?.paybackMonths == null ? '—' : `${estimate.paybackMonths.toFixed(1)} months`}</strong></div>
      {estimateError && <p role="alert" className="roi-disclaimer">Estimate unavailable: {estimateError}</p>}
      <p className="roi-disclaimer">The estimate uses workspace settings for the 65% stockout recovery factor, 40% load-shedding saving, Rs 350 idle staff cost per hour per hub and the Growth plan price. Results are estimates, not a guarantee.</p>
    </div>
  </div>
}
