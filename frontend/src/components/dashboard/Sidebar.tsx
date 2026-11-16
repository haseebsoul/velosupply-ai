import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, Bell, ChevronLeft, ChevronRight, CircleGauge, FileText, Gift,
  LayoutDashboard, Menu, Network, Package, Shield, ShieldCheck, Store, Users,
  KeyRound, Truck, X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { api } from '../../lib/apiClient'
import { useAppStore } from '../../store/useAppStore'
import { BrandEmblem } from '../BrandEmblem'
import type { Warehouse } from '../../types'

type NavItem = { to: string; label: string; icon: LucideIcon; adminOnly?: boolean }
const groups: Array<{ title: string; items: NavItem[] }> = [
  { title: 'Workspace', items: [
    { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { to: '/dashboard/activity', label: 'Activity', icon: Activity },
    { to: '/dashboard/reliability', label: 'Reliability', icon: ShieldCheck, adminOnly: true },
    { to: '/dashboard/messages', label: 'Messages', icon: Bell, adminOnly: true }
  ] },
  { title: 'Operations', items: [
    { to: '/dashboard/topology', label: 'Network map', icon: Network },
    { to: '/dashboard/threats', label: 'Inventory alerts', icon: Shield },
    { to: '/dashboard/manage', label: 'Manage inventory', icon: Package },
    { to: '/dashboard/deliveries', label: 'Delivery assignments', icon: Truck }
  ] },
  { title: 'Workspace tools', items: [
    { to: '/dashboard/rewards', label: 'Program', icon: Gift, adminOnly: true },
    { to: '/dashboard/reports', label: 'Reports', icon: FileText },
    { to: '/dashboard/account', label: 'Account', icon: CircleGauge, adminOnly: true },
    { to: '/dashboard/admin', label: 'User access', icon: Users, adminOnly: true },
    { to: '/dashboard/access', label: 'Invitation keys', icon: KeyRound, adminOnly: true }
  ] }
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hubs, setHubs] = useState<Warehouse[] | null>(null)
  const user = useAppStore((state) => state.user)
  const closeMobile = () => setMobileOpen(false)

  useEffect(() => {
    let active = true
    api.get<Warehouse[]>('/warehouses')
      .then(({ data }) => { if (active) setHubs(data) })
      .catch(() => { if (active) setHubs(null) })
    return () => { active = false }
  }, [])

  const onlineCount = hubs?.filter((hub) => hub.status === 'online').length ?? 0
  const totalCount = hubs?.length ?? 0
  const hubLabel = hubs
    ? totalCount > 0 && onlineCount === totalCount
      ? `${onlineCount} / ${totalCount} hubs online`
      : `${onlineCount} / ${totalCount} hubs online`
    : 'Hub status unavailable'

  return <>
    {mobileOpen && <button className="sidebar-overlay" aria-label="Close navigation" onClick={closeMobile} />}
    <motion.aside
      className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      animate={{ width: collapsed ? 72 : 240 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <div className="sidebar-brand">
        <Link to="/store" className="brand sidebar-brand-link" onClick={closeMobile}>
          <BrandEmblem />
          <span className="sidebar-wordmark"><strong>VeloSupply</strong><small>AUTONOMOUS OPS</small></span>
        </Link>
        <button className="sidebar-collapse" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <div className="sidebar-workspace">
        <span className="workspace-mark">VS</span>
        <span className="workspace-copy"><strong>Pakistan workspace</strong><small>{user?.role === 'admin' ? 'Administrator' : 'Operations team'}</small></span>
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
        <Link className="side-link storefront-link" to="/store" onClick={closeMobile}>
          <Store size={17} strokeWidth={1.8} /><span className="side-label">Public storefront</span>
        </Link>
        <div className="sidebar-system-pill" title={hubs ? `${onlineCount} of ${totalCount} hubs reporting online` : 'Hub status not available'}>
          <span className={`sidebar-system-dot ${hubs && totalCount > 0 && onlineCount === totalCount ? 'healthy' : 'unknown'}`} />
          <span className="side-label">{hubLabel}</span>
        </div>
      </div>
    </motion.aside>
    <button className="sidebar-mobile-toggle" type="button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMobileOpen((value) => !value)}>
      {mobileOpen ? <X size={18} /> : <Menu size={18} />}
    </button>
  </>
}
