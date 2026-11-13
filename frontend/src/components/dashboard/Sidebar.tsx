import { useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Boxes, ChevronLeft, ChevronRight, CircleGauge, FileText, Gift, LayoutDashboard, LogOut, Network, Settings, Shield, Store, Users } from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/useAppStore'

const links = [
  ['/dashboard', 'Overview', LayoutDashboard], ['/dashboard/topology', 'Topology', Network],
  ['/dashboard/threats', 'Threats', Shield], ['/dashboard/activity', 'Activity', Activity],
  ['/dashboard/manage', 'Manage', Settings], ['/dashboard/rewards', 'Rewards', Gift],
  ['/dashboard/reports', 'Reports', FileText], ['/dashboard/account', 'Account', CircleGauge],
  ['/dashboard/admin', 'Admin', Users],
] as const

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const { user, logout } = useAppStore()
  const navigate = useNavigate()
  return <motion.aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} animate={{ flexBasis: collapsed ? 76 : 250 }} transition={{ type: 'spring', stiffness: 400, damping: 40 }}>
    <div className="sidebar-brand"><Link to="/" className="brand" style={{ color: 'var(--text-ops-primary)' }}><span className="brand-mark"><Boxes size={16} /></span><span className="sidebar-wordmark">VeloSupply</span></Link></div>
    <nav aria-label="Operations navigation">{links.map(([to, label, Icon]) => label === 'Admin' && user?.role !== 'admin' ? null : <NavLink key={to} to={to} end={to === '/dashboard'} title={collapsed ? label : undefined} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}><Icon size={17} /><span className="side-label">{label}</span></NavLink>)}</nav>
    <div className="side-bottom"><Link className="side-link" to="/store"><Store size={17} /><span className="side-label">Public storefront</span></Link>
      <div className="side-link" style={{ borderTop: '1px solid var(--border-ops)', borderRadius: 0, marginTop: 8, paddingTop: 18 }}><span className="brand-mark">{user?.name.slice(0, 1) ?? 'V'}</span><span className="side-label">{user?.name ?? 'Operator'}</span></div>
      <button className="side-link" onClick={() => { logout(); navigate('/login') }}><LogOut size={17} /><span className="side-label">Logout</span></button>
      <button className="side-link" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}<span className="side-label">{collapsed ? 'Expand' : 'Collapse'}</span></button>
    </div>
  </motion.aside>
}
