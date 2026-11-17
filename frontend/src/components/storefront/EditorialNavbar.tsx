import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Menu, ShoppingBag, X } from 'lucide-react'
import { VeloSupplyLogo } from '../VeloSupplyLogo'
import { useCartStore } from '../../store/useCartStore'

const navItems = [
  ['Home', '/#platform'],
  ['Network', '/#network'],
  ['ROI', '/#roi'],
  ['Hardware', '/#catalog'],
  ['Access', '/#access']
]

export function EditorialNavbar() {
  const count = useCartStore((state) => state.lines.reduce((sum, line) => sum + line.quantity, 0))
  const setOpen = useCartStore((state) => state.setOpen)
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeMobile = () => setMobileOpen(false)

  return (
    <header className="editorial-nav">
      <div className="wrap nav-inner">
        <VeloSupplyLogo />
        <nav className="nav-links" aria-label="Main navigation">
          {navItems.map(([label, href]) => <a href={href} key={href}>{label}</a>)}
        </nav>
        <div className="nav-actions">
          <button className="cart-pill" onClick={() => setOpen(true)} aria-label={`Open cart, ${count} items`}><ShoppingBag size={15} /> Cart <span className="mono">{count}</span></button>
          <Link className="login-link" to="/login">Sign in</Link>
          <Link className="button button-dark nav-cta" to="/register">Get full access <ArrowUpRight size={15} /></Link>
        </div>
        <button className="nav-mobile-toggle" type="button" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} onClick={() => setMobileOpen((value) => !value)}>
          {mobileOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
      {mobileOpen && <nav className="mobile-nav-panel" aria-label="Mobile navigation">
        {navItems.map(([label, href]) => <a href={href} key={href} onClick={closeMobile}>{label}</a>)}
        <div className="mobile-nav-actions">
          <button className="cart-pill" onClick={() => { closeMobile(); setOpen(true) }}><ShoppingBag size={15} /> Cart <span className="mono">{count}</span></button>
          <Link className="button button-outline" to="/login" onClick={closeMobile}>Sign in</Link>
          <Link className="button button-dark" to="/register" onClick={closeMobile}>Get full access <ArrowUpRight size={15} /></Link>
        </div>
      </nav>}
    </header>
  )
}
