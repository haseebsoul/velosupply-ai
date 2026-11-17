import { Link } from 'react-router-dom'
import { ArrowUpRight, ShoppingBag } from 'lucide-react'
import { VeloSupplyLogo } from '../VeloSupplyLogo'
import { useCartStore } from '../../store/useCartStore'

export function EditorialNavbar() {
  const count = useCartStore((state) => state.lines.reduce((sum, line) => sum + line.quantity, 0))
  const setOpen = useCartStore((state) => state.setOpen)
  return (
    <header className="editorial-nav">
      <div className="wrap nav-inner">
        <VeloSupplyLogo />
        <nav className="nav-links" aria-label="Main navigation">
          <a href="/#platform">Platform</a><a href="/#catalog">Live Catalog</a><a href="/#telemetry">Telemetry</a><a href="/#pricing">ROI &amp; Pricing</a>
        </nav>
        <div className="nav-actions">
          <button className="cart-pill" onClick={() => setOpen(true)} aria-label={`Open cart, ${count} items`}><ShoppingBag size={15} /> Cart <span className="mono">{count}</span></button>
          <Link className="login-link" to="/login">Sign in</Link>
          <Link className="button button-dark nav-cta" to="/dashboard">Command Center <ArrowUpRight size={15} /></Link>
        </div>
      </div>
    </header>
  )
}
