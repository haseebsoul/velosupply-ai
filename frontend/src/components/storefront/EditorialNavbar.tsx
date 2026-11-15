import { Link } from 'react-router-dom'
import { ArrowUpRight, ShoppingBag } from 'lucide-react'
import { BrandEmblem } from '../BrandEmblem'
import { useAppStore } from '../../store/useAppStore'
import { useCartStore } from '../../store/useCartStore'

export function EditorialNavbar() {
  const count = useCartStore((state) => state.lines.reduce((sum, line) => sum + line.quantity, 0))
  const setOpen = useCartStore((state) => state.setOpen)
  const user = useAppStore((state) => state.user)
  return (
    <header className="editorial-nav">
      <div className="wrap nav-inner">
        <Link className="brand" to="/">
          <BrandEmblem /> VeloSupply AI
        </Link>
        <nav className="nav-links" aria-label="Main navigation">
          <a href="/#platform">Platform</a><a href="/#catalog">Live Catalog</a><a href="/#telemetry">Telemetry</a><a href="/#pricing">ROI &amp; Pricing</a>
        </nav>
        <div className="nav-actions">
          <button className="cart-pill" onClick={() => setOpen(true)} aria-label={`Open cart, ${count} items`}><ShoppingBag size={15} /> Cart <span className="mono">{count}</span></button>
          {user?.role === 'buyer' || user?.role === 'user'
            ? <><Link className="login-link" to="/store/orders">My orders</Link><Link className="login-link" to="/store/account">Account</Link></>
            : user ? <Link className="login-link" to="/dashboard">Workspace</Link>
              : <Link className="login-link" to="/login">Sign in</Link>}
          <Link className="button button-dark nav-cta" to={user?.role === 'buyer' || user?.role === 'user' ? '/store/orders' : user ? '/dashboard' : '/register'}>
            {user?.role === 'buyer' || user?.role === 'user' ? 'Track orders' : user ? 'Command Center' : 'Create account'}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </header>
  )
}
