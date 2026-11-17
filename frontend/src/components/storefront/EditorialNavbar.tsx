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
          <a href="/#platform">Home</a><a href="/#network">Network</a><a href="/#roi">ROI</a><a href="/#catalog">Hardware</a><a href="/#access">Access</a>
        </nav>
        <div className="nav-actions">
          <button className="cart-pill" onClick={() => setOpen(true)} aria-label={`Open cart, ${count} items`}><ShoppingBag size={15} /> Cart <span className="mono">{count}</span></button>
          <Link className="login-link" to="/login">Sign in</Link>
          <Link className="button button-dark nav-cta" to="/register">Get full access <ArrowUpRight size={15} /></Link>
        </div>
      </div>
    </header>
  )
}
