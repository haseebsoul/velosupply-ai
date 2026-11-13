import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, Boxes, ChevronLeft, ChevronRight, CircleGauge, FileText, Gift,
  LayoutDashboard, LogOut, MessageSquareText, Network, Settings, ShieldAlert, Store, UsersRound
} from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/useAppStore'

const primaryLinks = [
  ['/dashboard', 'Overview', LayoutDashboard],
  ['/dashboard/activity', 'Activity', Activity],
  ['/dashboard/manage', 'Manage', Settings],
  ['/dashboard/rewards', 'Program', Gift],
  ['/dashboard/messages', 'Messages', MessageSquareText],
  ['/dashboard/account', 'Account', CircleGauge],
  ['/dashboard/reports', 'Reports', FileText],
] as const

const operationsLinks = [
  ['/dashboard/topology', 'Network topology', Network],
  ['/dashboard/threats', 'Inventory alerts', ShieldAlert],
] as const

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const { user, logout } = useAppStore()
  const navigate = useNavigate()
  const roleLabel = user?.role === 'admin' ? 'Administrator' : user?.role === 'operator' ? 'Operations' : 'Buyer'

  return <motion.aside
    className={`sidebar ${collapsed ? 'collapsed' : ''}`}
    animate={{ width: collapsed ? 76 : 248, flexBasis: collapsed ? 76 : 248 }}
    transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}
  >
    <div className="sidebar-brand">
      <Link to="/" className="brand" title="VeloSupply home">
        <span className="brand-mark">V</span>
        <span className="sidebar-wordmark">VeloSupply</span>
      </Link>
    </div>

    <nav className="sidebar-navigation" aria-label="Dashboard navigation">
      <div className="side-section">
        <span className="side-section-label">Workspace</span>
        {primaryLinks.map(([to, label, Icon]) => <NavLink
          key={to}
          to={to}
          end={to === '/dashboard'}
          title={collapsed ? label : undefined}
          className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
        >
          <Icon size={17} strokeWidth={1.7} />
          <span className="side-label">{label}</span>
          {label === 'Messages' && <span className="side-unread" aria-label="One unread notice">1</span>}
        </NavLink>)}
      </div>

      <div className="side-section side-operations">
        <span className="side-section-label">Operations</span>
        {operationsLinks.map(([to, label, Icon]) => <NavLink
          key={to}
          to={to}
          title={collapsed ? label : undefined}
          className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
        >
          <Icon size={17} strokeWidth={1.7} />
          <span className="side-label">{label}</span>
        </NavLink>)}
      </div>

      {user?.role === 'admin' && <div className="side-section side-admin">
        <span className="side-section-label">Administration</span>
        <NavLink to="/dashboard/admin" className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`} title={collapsed ? 'Stakeholders' : undefined}>
          <UsersRound size={17} strokeWidth={1.7} />
          <span className="side-label">Stakeholders</span>
        </NavLink>
      </div>}
    </nav>

    <div className="side-bottom">
      <Link className="side-link" to="/store" title={collapsed ? 'Storefront' : undefined}>
        <Store size={17} strokeWidth={1.7} /><span className="side-label">Public storefront</span>
      </Link>
      <div className="side-profile">
        <span className="side-avatar">{user?.name?.slice(0, 1).toUpperCase() ?? 'V'}</span>
        <span className="side-profile-copy"><strong>{user?.name ?? 'VeloSupply user'}</strong><small>{roleLabel}</small></span>
      </div>
      <button className="side-link" onClick={() => { logout(); navigate('/login') }}>
        <LogOut size={17} strokeWidth={1.7} /><span className="side-label">Sign out</span>
      </button>
      <button className="side-link side-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((value) => !value)}>
        {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}<span className="side-label">{collapsed ? 'Expand' : 'Collapse sidebar'}</span>
      </button>
    </div>
  </motion.aside>
}
