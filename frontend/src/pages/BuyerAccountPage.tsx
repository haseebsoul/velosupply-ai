import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LogOut, ShieldCheck } from 'lucide-react'
import { EditorialNavbar } from '../components/storefront/EditorialNavbar'
import { useAppStore } from '../store/useAppStore'

export function BuyerAccountPage() {
  const user = useAppStore((state) => state.user)
  const logout = useAppStore((state) => state.logout)
  const navigate = useNavigate()
  const initials = (user?.name || 'Buyer').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

  return <div className="editorial buyer-portal-page">
    <EditorialNavbar />
    <main className="wrap section buyer-portal-main">
      <Link className="buyer-back-link" to="/store/orders"><ArrowLeft size={15} /> Back to orders</Link>
      <div className="buyer-portal-heading">
        <div><span className="eyebrow">YOUR ACCOUNT</span><h1 className="section-title">Account details</h1><p className="muted">Your buyer profile and session controls.</p></div>
      </div>
      <section className="card-light buyer-account-card">
        <div className="buyer-account-identity">
          <span className="buyer-account-avatar">{initials}</span>
          <div><h2>{user?.name || 'Buyer account'}</h2><p className="muted">{user?.email || 'Email unavailable'}</p></div>
          <span className="status-pill status-positive">BUYER ACCOUNT</span>
        </div>
        <div className="buyer-account-info">
          <div><span className="mono-label">NAME</span><strong>{user?.name || '—'}</strong></div>
          <div><span className="mono-label">EMAIL ADDRESS</span><strong>{user?.email || '—'}</strong></div>
          <div><span className="mono-label">ACCESS ROLE</span><strong>Buyer</strong></div>
        </div>
        <div className="buyer-account-footer">
          <p className="buyer-data-note"><ShieldCheck size={14} /> Your buyer account can view only the orders associated with your signed-in identity.</p>
          <button type="button" className="button button-outline" onClick={() => { logout(); navigate('/login', { replace: true }) }}><LogOut size={15} /> Sign out</button>
        </div>
      </section>
    </main>
  </div>
}
