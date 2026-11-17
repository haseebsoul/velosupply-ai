import { useMemo, useState } from 'react'

const formatPkr = (value: number) => `Rs ${Math.round(value).toLocaleString('en-PK')}`

export function RoiCalculator() {
  const [orders, setOrders] = useState(1200)
  const [averageOrder, setAverageOrder] = useState(85000)
  const [stockoutRate, setStockoutRate] = useState(8)
  const [loadSheddingHours, setLoadSheddingHours] = useState(3)
  const [hubs, setHubs] = useState(6)

  const estimate = useMemo(() => {
    const monthlyRevenue = orders * averageOrder
    const lostToStockouts = monthlyRevenue * stockoutRate / 100
    const recovered = lostToStockouts * .65
    const loadSheddingLoss = loadSheddingHours * 30 * 350 * hubs
    const savedByQueue = loadSheddingLoss * .4
    const monthlyBenefit = recovered + savedByQueue
    return {
      lostToStockouts,
      recovered,
      hoursSaved: loadSheddingHours * 30 * hubs * .4,
      paybackMonths: monthlyBenefit > 0 ? 39900 / monthlyBenefit : null
    }
  }, [orders, averageOrder, stockoutRate, loadSheddingHours, hubs])

  return <div className="roi-estimator">
    <div className="roi-intro">
      <span className="eyebrow">03 / THE NUMBERS</span>
      <h2 className="section-title">See what stockouts cost your operation.</h2>
      <p className="muted">Adjust the inputs to estimate monthly value recovered by better stock visibility and a resilient operating workflow.</p>
      <div className="roi-inputs">
        <label className="roi-control"><span>Monthly orders <strong>{orders.toLocaleString('en-PK')}</strong></span>
          <input type="range" min="100" max="12000" step="100" value={orders} onChange={(event) => setOrders(Number(event.target.value))} />
        </label>
        <label className="roi-control"><span>Average order value <strong>{formatPkr(averageOrder)}</strong></span>
          <input type="range" min="10000" max="500000" step="5000" value={averageOrder} onChange={(event) => setAverageOrder(Number(event.target.value))} />
        </label>
        <label className="roi-control"><span>Stockout rate <strong>{stockoutRate}%</strong></span>
          <input type="range" min="0" max="35" step="1" value={stockoutRate} onChange={(event) => setStockoutRate(Number(event.target.value))} />
        </label>
        <label className="roi-control"><span>Load-shedding per day <strong>{loadSheddingHours}h</strong></span>
          <input type="range" min="0" max="12" step="1" value={loadSheddingHours} onChange={(event) => setLoadSheddingHours(Number(event.target.value))} />
        </label>
        <label className="roi-control"><span>Operating hubs <strong>{hubs}</strong></span>
          <input type="range" min="1" max="6" step="1" value={hubs} onChange={(event) => setHubs(Number(event.target.value))} />
        </label>
      </div>
    </div>
    <div className="roi-results">
      <span className="mono-label">MONTHLY ESTIMATE · PKR</span>
      <div className="roi-result-primary"><small>Revenue recovered</small><strong>{formatPkr(estimate.recovered)}</strong></div>
      <div className="roi-result-row"><span>Revenue exposed to stockouts</span><strong>{formatPkr(estimate.lostToStockouts)}</strong></div>
      <div className="roi-result-row"><span>Staff hours saved</span><strong>{Math.round(estimate.hoursSaved).toLocaleString('en-PK')} hrs</strong></div>
      <div className="roi-result-row"><span>Growth plan payback</span><strong>{estimate.paybackMonths === null ? '—' : `${estimate.paybackMonths.toFixed(1)} months`}</strong></div>
      <p className="roi-disclaimer">Estimate formula uses a 65% stockout recovery factor, 40% load-shedding workflow saving and Rs 350 per idle staff hour per hub. Results are estimates, not a guarantee.</p>
    </div>
  </div>
}
