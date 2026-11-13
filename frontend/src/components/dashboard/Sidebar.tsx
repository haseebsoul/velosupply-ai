import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, Bell, Boxes, ChevronDown, ChevronLeft, ChevronRight, Menu, X,
  CircleGauge, FileText, Gift, LayoutDashboard, LogOut, Network,
  Package, Shield, Store, Users
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAppStore } from '../../store/useAppStore'

type NavItem = { to: string; label: string; icon: LucideIcon; adminOnly?: boolean }
const groups: Array<{ title: string; items: NavItem[] }> = [
  { title: 'Workspace', items: [
    { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { to: '/dashboard/activity', label: 'Activity', icon: Activity },
    { to: '/dashboard/messages', label: 'Messages', icon: Bell }
  ] },
  { title: 'Operations', items: [
    { to: '/dashboard/topology', label: 'Network map', icon: Network },
    { to: '/dashboard/threats', label: 'Inventory alerts', icon: Shield },
    { to: '/dashboard/manage', label: 'Manage inventory', icon: Package }
  ] },
  { title: 'Workspace tools', items: [
    { to: '/dashboard/rewards', label: 'Program', icon: Gift },
    { to: '/dashboard/reports', label: 'Reports', icon: FileText },
    { to: '/dashboard/account', label: 'Account', icon: CircleGauge },
    { to: '/dashboard/admin', label: 'User access', icon: Users, adminOnly: true }
  ] }
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, logout } = useAppStore()
  const navigate = useNavigate()

  const closeMobile = () => setMobileOpen(false)

  return <>
    {mobileOpen && <button className="sidebar-overlay" aria-label="Close navigation" onClick={closeMobile} />}
    <motion.aside
      className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      animate={{ width: collapsed ? 82 : 252 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div className="sidebar-brand">
        <Link to="/" className="brand sidebar-brand-link" onClick={closeMobile}>
          <span className="brand-mark">V</span>
          <span className="sidebar-wordmark"><strong>VeloSupply</strong><small>Operations</small></span>
        </Link>
        <button className="sidebar-collapse" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <div className="sidebar-workspace">
        <span className="workspace-mark">VS</span>
        <span className="workspace-copy"><strong>Global workspace</strong><small>Production environment</small></span>
        <ChevronDown size={14} className="workspace-chevron" />
      </div>

      <nav aria-label="Operations navigation" className="sidebar-navigation">
        {groups.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || user?.role === 'admin')
          return <div className="sidebar-group" key={group.title}>
            <p className="sidebar-section-title">{group.title}</p>
            {items.map(({ to, label, icon: Icon }) => <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              title={collapsed ? label : undefined}
              onClick={closeMobile}
              className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
            >
              {({ isActive }) => <>
                {isActive && <motion.span layoutId="dashboard-active-nav" className="nav-active-indicator" transition={{ duration: 0.18 }} />}
                <Icon size={17} strokeWidth={1.8} />
                <span className="side-label">{label}</span>
              </>}
            </NavLink>)}
          </div>
        })}
      </nav>

      <div className="sidebar-bottom">
        <Link className="side-link storefront-link" to="/store" onClick={closeMobile}><Store size={17} strokeWidth={1.8} /><span className="side-label">Public storefront</span></Link>
        <div className="sidebar-user">
          <span className="sidebar-user-avatar">{user?.name?.slice(0, 1).toUpperCase() ?? 'V'}</span>
          <span className="sidebar-user-copy"><strong>{user?.name ?? 'Operator'}</strong><small>{user?.role === 'admin' ? 'Administrator' : user?.role === 'operator' ? 'Operations team' : 'Buyer'}</small></span>
        </div>
        <button className="side-link sidebar-logout" onClick={() => { logout(); navigate('/login') }}><LogOut size={17} strokeWidth={1.8} /><span className="side-label">Sign out</span></button>
      </div>
    </motion.aside>
    <button className="sidebar-mobile-toggle" type="button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMobileOpen((value) => !value)}>
      {mobileOpen ? <X size={18} /> : <Menu size={18} />}
    </button>
  </>
}
